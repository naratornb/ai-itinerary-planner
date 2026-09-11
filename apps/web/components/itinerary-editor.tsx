"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import CopilotPanel from "./copilot/copilot-panel";
import { formatHotelStarRating, HOTEL_OPTIONS, type HotelOption, type HotelRoomOption } from "./hotel-catalog";
import RouteMap, { type RouteStop } from "./route-map";
import { createCopilotClient } from "../lib/copilot-client";
import {
  appendItemToDay,
  buildDaysFromPackage,
  computePackagePrice,
  copilotSuggestionToTimelineItem,
  daySubtitle,
  getEndTime,
  insertItemInDay,
  removeDay,
  timezoneForIata,
  type BuilderDay,
  type DayPhoto,
  type IconName,
  type TimelineItem,
} from "../lib/itinerary-builder";
import type { CopilotSuggestionV1 } from "../lib/copilot";
import {
  deletePackageMedia,
  listPackageMedia,
  updatePackage,
  uploadPackageMedia,
  type CreatorHotelDetail,
  type CreatorPackageDetail,
} from "../lib/creator-api";
import { supabase } from "../lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    plane: <><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></>,
    star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
    hotel: <><path d="M3 20V7m18 13V11a2 2 0 0 0-2-2h-7v11M3 14h18M7 10h2" /><path d="M3 20h18" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    alert: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v4m0 3h.01" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    pin: <><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const AVAILABLE_FLIGHTS = [
  { id: "qf25", airline: "Qantas", number: "QF25", from: "Sydney (SYD)", to: "Tokyo Haneda (HND)", departure: "20:55", arrival: "05:55", duration: "10h", price: 850 },
  { id: "jl52", airline: "Japan Airlines", number: "JL52", from: "Sydney (SYD)", to: "Tokyo Haneda (HND)", departure: "08:15", arrival: "17:05", duration: "9h 50m", price: 920 },
  { id: "qf79", airline: "Qantas", number: "QF79", from: "Melbourne (MEL)", to: "Tokyo Narita (NRT)", departure: "09:25", arrival: "18:45", duration: "10h 20m", price: 780 },
];

const ACTIVITY_CATEGORIES = ["Activity", "Restaurant", "Shopping", "Attraction", "Other"];
const DURATION_OPTIONS = ["30", "60", "90", "120", "180"];
const NEW_DAY_OPTION_ID = "__new-day__";

type AddFlowStep = "type" | "activities" | "create" | "flight" | "hotel" | "creator";
type ActivityDraft = { title: string; price: string; address: string; startTime: string; duration: string; notes: string };
type CreatorDraft = { title: string; category: string; address: string; time: string; duration: string; price: string; reason: string };
type HotelDayOption = { id: string; index: number; title: string };

function hotelNights(hotel: CreatorHotelDetail) {
  if (!hotel.check_in_date || !hotel.check_out_date) return null;
  const checkIn = Date.parse(`${hotel.check_in_date}T00:00:00Z`);
  const checkOut = Date.parse(`${hotel.check_out_date}T00:00:00Z`);
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut <= checkIn) return null;
  return Math.round((checkOut - checkIn) / 86_400_000);
}

const REAL_TIME_PATTERN = /^\d{1,2}:\d{2}/;

// The inverse of getEndTime(): how far back a stop's start time has to move
// so it still finishes exactly at a given clock time.
function subtractMinutes(time: string, durationMinutes: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (((hours * 60 + minutes) - Number(durationMinutes)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// A stop can only be scheduled after the previous one has actually ended,
// and must itself end before the next one starts — duration is fixed, so
// only the start time can move, and moving it can't create an overlap.
// Both messages are phrased around the start time, since that's the only
// thing the user can actually change here. A neighbor only counts if its
// own displayed time is a real clock time — a hotel stop shows "Check-in" /
// "Check-out" / "Overnight stay" instead (bookings only carry a date, never
// a time), so it naturally never enters either side of this check.
export function findTimeConflict(items: TimelineItem[], editingId: number, time: string, duration: string): string | null {
  const index = items.findIndex((item) => item.id === editingId);
  if (index === -1) return null;

  const previous = items[index - 1];
  if (previous && REAL_TIME_PATTERN.test(previous.time)) {
    const previousEnds = getEndTime(previous.time, previous.duration ?? "0");
    if (time < previousEnds) return `Must start at or after ${previous.title} ends, at ${previousEnds}`;
  }

  const next = items[index + 1];
  if (next && REAL_TIME_PATTERN.test(next.time)) {
    const thisEnds = getEndTime(time, duration);
    if (thisEnds > next.time) {
      const latestStart = subtractMinutes(next.time, duration);
      return `Must start by ${latestStart}, so it ends before ${next.title} starts at ${next.time}`;
    }
  }

  return null;
}

// "$776/night" has no space to wrap at, so a narrow price column broke it
// mid-word ("$776/n" / "ight"). Rendering the "/night" unit smaller frees up
// enough width that it no longer needs to wrap; the <wbr/> is a fallback
// for anything still too narrow.
function withWrapBeforeSlash(text: string) {
  const index = text.indexOf("/");
  if (index === -1) return text;
  return <>{text.slice(0, index)}<wbr /><span className="item-price-unit">{text.slice(index)}</span></>;
}

function formatStayDate(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

// Departure renders in the origin airport's zone, arrival in the
// destination's — the traveler's actual local clock at each end, not the
// viewer's own timezone.
function formatFlightDateTime(value: string | null, timeZone: string) {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

const TOKYO_LANDMARKS: { keywords: string[]; coordinate: [number, number] }[] = [
  { keywords: ["narita", "nrt"], coordinate: [35.7719, 140.3929] },
  { keywords: ["haneda", "hnd"], coordinate: [35.5494, 139.7798] },
  { keywords: ["shibuya"], coordinate: [35.6595, 139.7005] },
  { keywords: ["shinjuku"], coordinate: [35.6895, 139.6917] },
  { keywords: ["tokyo tower", "shibakoen", "minato city"], coordinate: [35.6586, 139.7454] },
  { keywords: ["meiji"], coordinate: [35.6764, 139.6993] },
  { keywords: ["asakusa"], coordinate: [35.7148, 139.7967] },
  { keywords: ["fuji", "kawaguchi"], coordinate: [35.5008, 138.7519] },
  { keywords: ["tsukiji"], coordinate: [35.6654, 139.7707] },
  { keywords: ["teamlab", "toyosu", "odaiba"], coordinate: [35.6252, 139.7817] },
  { keywords: ["ginza"], coordinate: [35.6717, 139.765] },
  { keywords: ["ueno"], coordinate: [35.7141, 139.7774] },
  { keywords: ["akihabara"], coordinate: [35.6984, 139.7731] },
  { keywords: ["roppongi"], coordinate: [35.6627, 139.7318] },
  { keywords: ["harajuku"], coordinate: [35.6702, 139.7026] },
  { keywords: ["tokyo"], coordinate: [35.6812, 139.7671] },
];
const TOKYO_STATION: [number, number] = [35.6812, 139.7671];

function resolveStopCoordinate(hint: string, fallbackIndex: number): [number, number] {
  const lower = hint.toLowerCase();
  const match = TOKYO_LANDMARKS.find(({ keywords }) => keywords.some((keyword) => lower.includes(keyword)));
  if (match) return match.coordinate;
  const angle = (fallbackIndex * 47 * Math.PI) / 180;
  const radius = 0.012;
  return [TOKYO_STATION[0] + radius * Math.cos(angle), TOKYO_STATION[1] + radius * Math.sin(angle)];
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`editor-panel ${className}`}><h2>{title}</h2>{children}</section>;
}

function StatusToggle({ tone, count, label, expanded, onClick }: { tone: "critical" | "warning" | "pass"; count: number; label: string; expanded: boolean; onClick: () => void }) {
  return <button className="status-toggle" aria-expanded={expanded} onClick={onClick}><span className={`${tone}-icon`}><Icon name={tone === "pass" ? "check" : "alert"} size={16} /></span><strong>{count}</strong><span>{label}</span><span className="status-chevron"><Icon name="chevron" size={17} /></span></button>;
}

type AddStopFlowProps = {
  addingAfter: number | null;
  setAddingAfter: Dispatch<SetStateAction<number | null>>;
  addFlow: AddFlowStep;
  setAddFlow: Dispatch<SetStateAction<AddFlowStep>>;
  flightSearch: string;
  setFlightSearch: Dispatch<SetStateAction<string>>;
  matchingFlights: (typeof AVAILABLE_FLIGHTS)[number][];
  selectedFlightId: string | null;
  setSelectedFlightId: Dispatch<SetStateAction<string | null>>;
  addSelectedFlight: () => void;
  selectedHotelOptionId: string | null;
  setSelectedHotelOptionId: Dispatch<SetStateAction<string | null>>;
  selectedRoomOptionId: string | null;
  setSelectedRoomOptionId: Dispatch<SetStateAction<string | null>>;
  selectedHotelOption: HotelOption | undefined;
  selectedRoomOption: HotelRoomOption | undefined;
  hotelCheckInDayId: string | null;
  setHotelCheckInDayId: Dispatch<SetStateAction<string | null>>;
  setHotelCheckOutDayId: Dispatch<SetStateAction<string | null>>;
  days: BuilderDay[];
  hotelCheckOutDayOptions: HotelDayOption[];
  selectedHotelCheckOutDayOption: HotelDayOption;
  hotelNotes: string;
  setHotelNotes: Dispatch<SetStateAction<string>>;
  createHotel: () => void;
  creatorDraft: CreatorDraft;
  setCreatorDraft: Dispatch<SetStateAction<CreatorDraft>>;
  createCreatorPick: () => void;
  activitySearch: string;
  setActivitySearch: Dispatch<SetStateAction<string>>;
  recommendedActivities: { title: string; meta: string; price: string }[];
  addRecommendedActivity: (title: string, meta: string, price: string) => void;
  activityDraft: ActivityDraft;
  setActivityDraft: Dispatch<SetStateAction<ActivityDraft>>;
  createActivity: () => void;
  activeDayData: BuilderDay | undefined;
  openAddFlow: (after: number) => void;
};

function AddStopFlow({ index, ...p }: AddStopFlowProps & { index: number }) {
  return p.addingAfter === index ? <section className="inline-add" aria-label="Add a stop">
                  {p.addFlow === "type" && <>
                    <div className="inline-add-head"><h4>Select item type</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <div className="item-type-grid">
                      <button onClick={() => p.setAddFlow("flight")}><span className="type-icon flight"><Icon name="plane" /></span><strong>Flight</strong><small>Air travel and transfers</small></button>
                      <button onClick={() => { p.setAddFlow("hotel"); p.setHotelCheckInDayId(p.activeDayData?.id ?? null); p.setHotelCheckOutDayId(null); }}><span className="type-icon hotel"><Icon name="hotel" /></span><strong>Hotel</strong><small>Accommodation and stays</small></button>
                      <button onClick={() => p.setAddFlow("activities")}><span className="type-icon activity"><Icon name="star" /></span><strong>Activity</strong><small>Tours, museums, and experiences</small></button>
                      <button onClick={() => p.setAddFlow("creator")}><span className="type-icon creator"><Icon name="check" /></span><strong>Creator Pick</strong><small>Your own recommendation</small></button>
                    </div>
                  </>}

                  {p.addFlow === "flight" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Choose a flight</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={p.flightSearch} onChange={(event) => p.setFlightSearch(event.target.value)} placeholder="Search by airport, airline, or flight number" /></label>
                    <p className="database-note">Flights are supplied by Travel Marketplace and cannot be edited here.</p>
                    <div className="flight-results" role="radiogroup" aria-label="Available flights">
                      {p.matchingFlights.map((flight) => <button key={flight.id} type="button" role="radio" aria-checked={p.selectedFlightId === flight.id} className={p.selectedFlightId === flight.id ? "selected" : ""} onClick={() => p.setSelectedFlightId(flight.id)}>
                        <span className="flight-brand"><strong>{flight.airline}</strong><small>{flight.number}</small></span>
                        <span className="flight-route"><strong>{flight.departure}</strong><small>{flight.from}</small></span>
                        <span className="flight-duration"><small>{flight.duration}</small><i aria-hidden="true"><Icon name="plane" size={20} /></i></span>
                        <span className="flight-route"><strong>{flight.arrival}</strong><small>{flight.to}</small></span>
                        <span className="flight-fare"><small>From</small><strong>${flight.price}</strong></span>
                        <span className="flight-select" aria-hidden="true">{p.selectedFlightId === flight.id ? <Icon name="check" size={18} /> : ""}</span>
                      </button>)}
                      {p.matchingFlights.length === 0 && <p>No matching flights found.</p>}
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!p.selectedFlightId} onClick={p.addSelectedFlight}>Add selected flight</button></div>
                  </>}

                  {p.addFlow === "hotel" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Add hotel</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <div className="hotel-choice-grid" role="radiogroup" aria-label="Available hotels">
                      {HOTEL_OPTIONS.map((hotel) => <button key={hotel.id} type="button" role="radio" aria-checked={p.selectedHotelOptionId === hotel.id} className={`hotel-choice-card${p.selectedHotelOptionId === hotel.id ? " selected" : ""}`} onClick={() => { p.setSelectedHotelOptionId(hotel.id); p.setSelectedRoomOptionId(null); }}>
                        <span className="hotel-choice-image"><Image src={hotel.image} alt={hotel.imageAlt} fill sizes="(max-width: 720px) 100vw, 33vw" /></span>
                        <span className="hotel-choice-copy"><strong>{hotel.name}</strong><span className="hotel-star-rating">{formatHotelStarRating(hotel.starRating)}</span><small>{hotel.area}</small><span>{hotel.room}</span><b>${hotel.price.toLocaleString("en-US")} total</b></span>
                        <span className="hotel-choice-check" aria-hidden="true">{p.selectedHotelOptionId === hotel.id ? <Icon name="check" size={20} /> : ""}</span>
                      </button>)}
                    </div>
                    {p.selectedHotelOption && <>
                      <p className="database-note">Travellers can change this hotel option after booking, from their trip.</p>
                      <div className="room-choice-grid" role="radiogroup" aria-label={`Room options for ${p.selectedHotelOption.name}`}>
                        {p.selectedHotelOption.rooms.map((room) => <button key={room.id} type="button" role="radio" aria-checked={p.selectedRoomOptionId === room.id} className={`room-choice-card${p.selectedRoomOptionId === room.id ? " selected" : ""}`} onClick={() => p.setSelectedRoomOptionId(room.id)}>
                          <strong>{room.name}</strong>
                          <span>{room.description}</span>
                          <b>${room.price.toLocaleString("en-US")} total</b>
                        </button>)}
                      </div>
                    </>}
                    {p.selectedHotelOption && p.selectedRoomOption && <>
                      <div className="hotel-confirm-card">
                        <div className="hotel-confirm-top">
                          <span className="hotel-confirm-media">
                            <Image src={p.selectedHotelOption.image} alt={p.selectedHotelOption.imageAlt} fill sizes="96px" />
                            <span className="hotel-confirm-media-badge">Illustrative room image</span>
                          </span>
                          <span className="hotel-confirm-heading">
                            <small>Hotel</small>
                            <strong>{p.selectedHotelOption.name}</strong>
                            <span>{p.selectedRoomOption.name}</span>
                          </span>
                          <span className="hotel-confirm-rating">
                            <Icon name="star" size={16} />
                            <b>{p.selectedHotelOption.starRating}</b><span>/ 5</span>
                          </span>
                        </div>
                        <dl className="hotel-confirm-stats">
                          <div><dt>Total price</dt><dd>${p.selectedRoomOption.price.toLocaleString("en-US")}</dd></div>
                          <div><dt>Check-in</dt><dd>{p.selectedHotelOption.checkIn}</dd></div>
                          <div><dt>Check-out</dt><dd>{p.selectedHotelOption.checkOut}</dd></div>
                          <div className="full"><dt>Address</dt><dd>{p.selectedHotelOption.address}</dd></div>
                        </dl>
                      </div>
                      <div className="activity-form hotel-fixed-details">
                        <label><span>Check-in day</span>
                          <select value={p.hotelCheckInDayId ?? ""} onChange={(event) => p.setHotelCheckInDayId(event.target.value)}>
                            {p.days.map((day) => <option key={day.id} value={day.id}>{`Day ${day.day}: ${day.title}`}</option>)}
                            <option value={NEW_DAY_OPTION_ID}>{`Day ${p.days.length + 1} (new day)`}</option>
                          </select>
                        </label>
                        <label><span>Checkout day</span>
                          <select value={p.selectedHotelCheckOutDayOption.id} onChange={(event) => p.setHotelCheckOutDayId(event.target.value)}>
                            {p.hotelCheckOutDayOptions.map((option) => <option key={option.id} value={option.id}>{option.id === NEW_DAY_OPTION_ID ? `Day ${option.index + 1} (new day)` : `Day ${option.index + 1}: ${option.title}`}</option>)}
                          </select>
                        </label>
                        <label><span>Price</span><input readOnly value={`$${p.selectedRoomOption.price.toLocaleString("en-US")}`} /></label>
                        <label className="full"><span>Notes</span><textarea value={p.hotelNotes} onChange={(event) => p.setHotelNotes(event.target.value)} placeholder="Add check-in or booking details" /></label>
                      </div>
                    </>}
                    <div className="activity-form-actions"><button className="publish-button" disabled={!p.selectedHotelOption || !p.selectedRoomOption || !p.hotelCheckInDayId} onClick={p.createHotel}>Add hotel</button></div>
                  </>}

                  {p.addFlow === "creator" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Add creator pick</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <div className="activity-form">
                      <label className="full"><span>Title</span><input value={p.creatorDraft.title} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, title: event.target.value })} placeholder="Your recommendation" /></label>
                      <label><span>Category</span><select value={p.creatorDraft.category} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, category: event.target.value })}>{ACTIVITY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
                      <label><span>Start time</span><input type="time" value={p.creatorDraft.time} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, time: event.target.value })} /></label>
                      <label><span>Duration (min)</span><select value={p.creatorDraft.duration} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, duration: event.target.value })}>{DURATION_OPTIONS.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
                      <label className="full"><span>Address</span><input value={p.creatorDraft.address} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, address: event.target.value })} /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={p.creatorDraft.price} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="full"><span>Why you recommend it</span><textarea value={p.creatorDraft.reason} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, reason: event.target.value })} placeholder="Share the detail travellers should know" /></label>
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!p.creatorDraft.title.trim()} onClick={p.createCreatorPick}>Add creator pick</button></div>
                  </>}

                  {p.addFlow === "activities" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Activity</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={p.activitySearch} onChange={(event) => p.setActivitySearch(event.target.value)} placeholder="Search Tokyo activities" /></label>
                    <h5>Recommended for Tokyo</h5>
                    <div className="activity-results">
                      {p.recommendedActivities.map((activity) => <button key={activity.title} onClick={() => p.addRecommendedActivity(activity.title, activity.meta, activity.price)}><span className="result-plus">+</span><strong>{activity.title}</strong><small>{activity.meta}</small><b>{activity.price}</b></button>)}
                      {p.recommendedActivities.length === 0 && <p>No activities found. Try another search or create your own.</p>}
                    </div>
                    <button className="create-activity-link" onClick={() => p.setAddFlow("create")}><Icon name="plus" size={16} /> Create new activity</button>
                  </>}

                  {p.addFlow === "create" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("activities")} aria-label="Back to activities">‹</button><h4>Create new activity</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <div className="activity-form">
                      <label className="full"><span>Activity</span><input value={p.activityDraft.title} onChange={(event) => p.setActivityDraft({ ...p.activityDraft, title: event.target.value })} /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={p.activityDraft.price} onChange={(event) => p.setActivityDraft({ ...p.activityDraft, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="full"><span>Address</span><input value={p.activityDraft.address} onChange={(event) => p.setActivityDraft({ ...p.activityDraft, address: event.target.value })} /></label>
                      <label><span>Start time</span><input type="time" value={p.activityDraft.startTime} onChange={(event) => p.setActivityDraft({ ...p.activityDraft, startTime: event.target.value })} /></label>
                      <label><span>Duration (min)</span><select value={p.activityDraft.duration} onChange={(event) => p.setActivityDraft({ ...p.activityDraft, duration: event.target.value })}>{DURATION_OPTIONS.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
                      <label><span>Ends at</span><input value={getEndTime(p.activityDraft.startTime, p.activityDraft.duration)} readOnly /></label>
                      <label className="full"><span>Notes</span><textarea value={p.activityDraft.notes} onChange={(event) => p.setActivityDraft({ ...p.activityDraft, notes: event.target.value })} placeholder="Share why this is worth a stop" /></label>
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={!p.activityDraft.title.trim()} onClick={p.createActivity}>Add activity</button></div>
                  </>}
                </section> : <button className="timeline-add" onClick={() => p.openAddFlow(index)}><Icon name="plus" size={14} /> Add stop</button>;
}

export default function ItineraryEditor({ pkg, onBack }: { pkg: CreatorPackageDetail; onBack: () => void }) {
  const { flights, hotels } = pkg;
  const copilotClient = useMemo(
    () => createCopilotClient(API_URL, pkg.package_id),
    [pkg.package_id],
  );
  const nextItemId = useRef(1000);
  const [packageTitle, setPackageTitle] = useState(pkg.title);
  const [titleDraft, setTitleDraft] = useState(pkg.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [days, setDays] = useState(() => buildDaysFromPackage(pkg));
  const [savedSnapshot, setSavedSnapshot] = useState<{ days: BuilderDay[]; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [editingDayField, setEditingDayField] = useState<"title" | null>(null);
  const [dayDraft, setDayDraft] = useState("");
  const packagePrice = computePackagePrice(days);
  const toSafeImageSrc = (value: string) => {
    try {
      const url = new URL(value, window.location.origin);
      return ["https:", "http:", "blob:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const [notice, setNotice] = useState("");
  const [pendingDeleteDay, setPendingDeleteDay] = useState<number | null>(null);
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<number | null>(null);
  const [addingAfter, setAddingAfter] = useState<number | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: "before" | "after" } | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: number; title: string; time: string; price: string; category: string; address: string; duration: string; notes: string; photos: string[] } | null>(null);
  const [expandedHotelId, setExpandedHotelId] = useState<number | null>(null);
  const [expandedFlightId, setExpandedFlightId] = useState<number | null>(null);
  const [expandedFeasibility, setExpandedFeasibility] = useState<"critical" | "suggestions" | "passed" | null>(null);
  const [addFlow, setAddFlow] = useState<AddFlowStep>("type");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityDraft, setActivityDraft] = useState({ title: "", price: "", address: "", startTime: "12:00", duration: "30", notes: "" });
  const [flightSearch, setFlightSearch] = useState("");
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [selectedHotelOptionId, setSelectedHotelOptionId] = useState<string | null>(null);
  const [selectedRoomOptionId, setSelectedRoomOptionId] = useState<string | null>(null);
  const [hotelNotes, setHotelNotes] = useState("");
  const [hotelCheckInDayId, setHotelCheckInDayId] = useState<string | null>(null);
  const [hotelCheckOutDayId, setHotelCheckOutDayId] = useState<string | null>(null);
  const [creatorDraft, setCreatorDraft] = useState({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });
  const [copilotOpen, setCopilotOpen] = useState(true);
  // "Saved" only holds while nothing has changed since the last successful PUT.
  const saved = savedSnapshot?.days === days && savedSnapshot?.title === packageTitle;
  const activeDayData = days[activeDay] ?? days[0];
  const items = activeDayData?.items ?? [];
  const story = activeDayData?.story ?? "";
  const photos = activeDayData?.photos ?? [];
  // buildDaysFromPackage stamps every row of a stay with `hotel-<id|name>`,
  // so the API hotel is looked up by that key rather than by counting rows —
  // the item list here is one day's worth, not the whole trip.
  const hotelByStayGroup = new Map(hotels.map((hotel) => [`hotel-${hotel.hotel_id ?? hotel.hotel_name ?? ""}`, hotel]));
  const hotelForItem = (item: TimelineItem) =>
    item.type === "HOTEL" && item.stayGroupId ? hotelByStayGroup.get(item.stayGroupId) : undefined;
  const routeStopBases = items.map((item, index) => {
    const flightIdx = items.slice(0, index).filter(({ type }) => type === "FLIGHT").length;
    const flight = item.type === "FLIGHT" ? flights[flightIdx] : undefined;
    const hotel = hotelForItem(item);
    const hint = [item.address, item.title, flight?.destination_iata, hotel?.address, hotel?.city]
      .filter((part): part is string => Boolean(part))
      .join(" ");
    return { label: item.title, time: item.time, coordinate: resolveStopCoordinate(hint, index) };
  });
  const routeStopLats = routeStopBases.map(({ coordinate }) => coordinate[0]);
  const routeStopLngs = routeStopBases.map(({ coordinate }) => coordinate[1]);
  const routeSpan = Math.max(
    routeStopLats.length ? Math.max(...routeStopLats) - Math.min(...routeStopLats) : 0,
    routeStopLngs.length ? Math.max(...routeStopLngs) - Math.min(...routeStopLngs) : 0,
  );
  const routeJitterRadius = Math.max(routeSpan * 0.025, 0.0015);
  const routeStopOccurrences = new Map<string, number>();
  const routeStops: RouteStop[] = routeStopBases.map(({ label, time, coordinate: base }) => {
    const key = `${base[0].toFixed(4)},${base[1].toFixed(4)}`;
    const occurrence = routeStopOccurrences.get(key) ?? 0;
    routeStopOccurrences.set(key, occurrence + 1);
    const coordinate: [number, number] = occurrence === 0
      ? base
      : [base[0] + routeJitterRadius * Math.cos(occurrence * 2.4), base[1] + routeJitterRadius * Math.sin(occurrence * 2.4)];
    return { label, time, coordinate };
  });

  const setStory = (value: string) => {
    const dayId = activeDayData?.id;
    if (!dayId) return;
    setDays((current) => current.map((day) => (day.id === dayId ? { ...day, story: value } : day)));
  };

  const setPhotos = (next: DayPhoto[]) => {
    const dayId = activeDayData?.id;
    if (!dayId) return;
    setDays((current) => current.map((day) => (day.id === dayId ? { ...day, photos: next } : day)));
  };

  const setItems = (update: TimelineItem[] | ((current: TimelineItem[]) => TimelineItem[])) => {
    const dayId = activeDayData?.id;
    if (!dayId) return;
    setDays((current) => current.map((day) => day.id === dayId ? {
      ...day,
      items: typeof update === "function" ? update(day.items) : update,
    } : day));
  };

  useEffect(() => {
    if (pendingDeleteDay === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDeleteDay(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDeleteDay]);

  useEffect(() => {
    if (pendingDeleteItemId === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDeleteItemId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDeleteItemId]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  };

  const savePackageTitle = () => {
    const nextTitle = titleDraft.trim();
    if (nextTitle) setPackageTitle(nextTitle);
    else setTitleDraft(packageTitle);
    setEditingTitle(false);
  };

  const startEditingDayField = (field: "title") => {
    setDayDraft(activeDayData?.title ?? "");
    setEditingDayField(field);
  };

  const saveDayField = () => {
    const dayId = activeDayData?.id;
    const field = editingDayField;
    setEditingDayField(null);
    if (!dayId || !field) return;
    const value = dayDraft.trim();
    if (field === "title" && !value) return;   // a day always keeps a title
    setDays((current) => current.map((day) => (day.id === dayId ? { ...day, [field]: value } : day)));
  };

  const accessToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;

  // ponytail: only title, price, and the day titles/summaries are synced back —
  // timeline items, hotels, and flights stay local. The API replaces those by
  // delete/re-add, which is a separate feature.
  const saveDraft = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      await updatePackage(fetch, API_URL, token, pkg.package_id, {
        title: packageTitle,
        base_price_aud: Math.round(packagePrice),
        days: days.map((day, index) => ({
          day_number: index + 1,
          // Don't pin the generated "Day N" placeholder as real data.
          title: day.title === `Day ${index + 1}` ? null : day.title || null,
          summary: day.story || null,
        })),
      });
      setSavedSnapshot({ days, title: packageTitle });
      showNotice("Draft saved");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to save this draft.");
    } finally {
      setSaving(false);
    }
  };

  const generateContent = async () => {
    if (isGeneratingStory) return;
    setIsGeneratingStory(true);
    try {
      const activityNames = items
        .filter((item) => item.type !== "FLIGHT" && item.type !== "HOTEL")
        .map((item) => (item.notes ? `${item.title} (${item.notes})` : item.title));

      const response = await fetch("/api/ai/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageTitle,
          destination: [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", "),
          selectedHotel: selectedHotelOption?.name ?? pkg.hotels[0]?.hotel_name ?? "",
          dayNumber: activeDay + 1,
          dayTitle: days[activeDay]?.title || `Day ${activeDay + 1}`,
          items: activityNames,
          vibe: days[activeDay]?.meta || "",
        }),
      });
      const data = (await response.json()) as { listing?: string; error?: string };
      if (data.listing) {
        setStory(data.listing);
        showNotice("Story generated");
      } else {
        showNotice(data.error || "The story generator returned nothing.");
      }
    } catch {
      showNotice("Failed to connect to the story generator.");
    } finally {
      setIsGeneratingStory(false);
    }
  };

  // ponytail: media rows carry no day association server-side, so every
  // existing photo lands on day 1. Add a day column when it matters.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await accessToken();
      if (!token) return;
      try {
        const media = await listPackageMedia(fetch, API_URL, token, pkg.package_id);
        if (cancelled || !media.length) return;
        setDays((current) => current.map((day, index) => index === 0
          ? { ...day, photos: [...media.map((entry) => ({ src: entry.url, alt: entry.caption || "Trip photo", media_id: entry.media_id })), ...day.photos] }
          : day));
      } catch {
        // A photo list that won't load isn't worth blocking the editor over.
      }
    })();
    return () => { cancelled = true; };
  }, [pkg.package_id]);

  const addDayPhoto = async (file: File) => {
    const dayId = activeDayData?.id;
    if (!dayId) return;
    const preview = URL.createObjectURL(file);
    const dropPreview = () => setDays((current) => current.map((day) => day.id === dayId
      ? { ...day, photos: day.photos.filter((photo) => photo.src !== preview) }
      : day));
    setDays((current) => current.map((day) => day.id === dayId
      ? { ...day, photos: [...day.photos, { src: preview, alt: file.name }] }
      : day));
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const uploaded = await uploadPackageMedia(fetch, API_URL, token, pkg.package_id, file);
      setDays((current) => current.map((day) => day.id === dayId ? {
        ...day,
        photos: day.photos.map((photo) => photo.src === preview
          ? { src: uploaded.url, alt: file.name, media_id: uploaded.media_id }
          : photo),
      } : day));
      showNotice("Photo uploaded");
    } catch (error) {
      dropPreview();
      showNotice(error instanceof Error ? error.message : "Unable to upload this photo.");
    } finally {
      URL.revokeObjectURL(preview);
    }
  };

  const removeDayPhoto = async (photo: DayPhoto) => {
    const dayId = activeDayData?.id;
    if (!dayId) return;
    if (photo.media_id) {
      try {
        const token = await accessToken();
        if (!token) throw new Error("Your session expired. Please sign in again.");
        await deletePackageMedia(fetch, API_URL, token, photo.media_id);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "Unable to remove this photo.");
        return;
      }
    }
    setDays((current) => current.map((day) => day.id === dayId
      ? { ...day, photos: day.photos.filter((entry) => entry.src !== photo.src) }
      : day));
    showNotice("Photo removed");
  };

  const startEditingItem = (item: TimelineItem) => {
    if (editingItem?.id === item.id) {
      setEditingItem(null);
      return;
    }
    setAddingAfter(null);
    setEditingItem({ id: item.id, title: item.title, time: item.time, price: item.price.replace(/[^0-9.]/g, ""), category: item.category ?? "Activity", address: item.address ?? "", duration: item.duration ?? "60", notes: item.notes ?? "", photos: item.photos ?? [] });
  };

  const timeConflict = editingItem ? findTimeConflict(items, editingItem.id, editingItem.time, editingItem.duration) : null;

  const saveEditedItem = () => {
    if (!editingItem || !editingItem.title.trim() || timeConflict) return;
    setItems((current) => current.map((item) => item.id === editingItem.id ? {
      ...item,
      title: editingItem.title.trim(),
      time: editingItem.time,
      price: editingItem.price ? `$${editingItem.price}` : "$0",
      category: editingItem.category,
      address: editingItem.address.trim(),
      duration: editingItem.duration,
      notes: editingItem.notes.trim(),
      photos: editingItem.photos,
    } : item));
    setEditingItem(null);
    showNotice("Stop updated");
  };

  const insertItem = (after: number, item: Omit<TimelineItem, "id">) => {
    if (!activeDayData) return;
    nextItemId.current += 1;
    setDays((current) => insertItemInDay(current, activeDayData.id, after, { ...item, id: nextItemId.current }));
    setAddingAfter(null);
    setAddFlow("type");
    showNotice(`${item.title} added`);
  };

  const openAddFlow = (after: number) => {
    setEditingItem(null);
    setAddingAfter(after);
    setAddFlow("type");
    setActivitySearch("");
  };

  // Shared by drag-and-drop and the keyboard reorder shortcut — dropping an
  // activity ahead of the flight that gets you there (or any other
  // scheduling conflict) is rejected the same way a manual time edit is.
  const applyReorder = (fromIndex: number, insertionIndex: number) => {
    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(insertionIndex, 0, moved);

    const conflict = REAL_TIME_PATTERN.test(moved.time)
      ? findTimeConflict(next, moved.id, moved.time, moved.duration ?? "0")
      : null;
    if (conflict) {
      showNotice(`Can't move ${moved.title} there — ${conflict}`);
      return;
    }

    setItems(next);
    setAddingAfter(null);
    showNotice(`${moved.title} moved to position ${insertionIndex + 1}`);
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= items.length) return;
    applyReorder(fromIndex, toIndex);
  };

  const dropItem = () => {
    if (draggedItemId === null || !dropTarget) return;
    const fromIndex = items.findIndex((item) => item.id === draggedItemId);
    if (fromIndex < 0) return;
    let insertionIndex = dropTarget.index + (dropTarget.position === "after" ? 1 : 0);
    if (fromIndex < insertionIndex) insertionIndex -= 1;
    applyReorder(fromIndex, insertionIndex);
  };

  const endDrag = () => {
    setDraggedItemId(null);
    setDropTarget(null);
  };

  const addRecommendedActivity = (title: string, meta: string, price: string) => {
    if (addingAfter === null) return;
    insertItem(addingAfter, { time: "16:00", type: "ACTIVITY", title, price, icon: "star", status: "pass", problemDetail: meta });
  };

  const createActivity = () => {
    if (addingAfter === null || !activityDraft.title.trim()) return;
    insertItem(addingAfter, {
      time: activityDraft.startTime,
      type: "ACTIVITY",
      title: activityDraft.title.trim(),
      price: activityDraft.price.trim() ? `$${activityDraft.price.trim()}` : "$0",
      icon: "star",
      status: "pass",
    });
    setActivityDraft({ title: "", price: "", address: "", startTime: "12:00", duration: "30", notes: "" });
  };

  const addSelectedFlight = () => {
    const flight = AVAILABLE_FLIGHTS.find((option) => option.id === selectedFlightId);
    if (addingAfter === null || !flight) return;
    insertItem(addingAfter, {
      time: flight.departure,
      type: "FLIGHT",
      title: `${flight.from} to ${flight.to} · ${flight.airline} ${flight.number}`,
      price: `$${flight.price}`,
      icon: "plane",
      status: "pass",
    });
    setFlightSearch("");
    setSelectedFlightId(null);
  };

  const matchingFlights = AVAILABLE_FLIGHTS.filter((flight) =>
    [flight.airline, flight.number, flight.from, flight.to].join(" ").toLowerCase().includes(flightSearch.trim().toLowerCase()),
  );
  const selectedHotelOption = HOTEL_OPTIONS.find(({ id }) => id === selectedHotelOptionId);
  const selectedRoomOption = selectedHotelOption?.rooms.find(({ id }) => id === selectedRoomOptionId);

  const hotelCheckInDayIndex = hotelCheckInDayId === NEW_DAY_OPTION_ID
    ? days.length
    : Math.max(0, days.findIndex((day) => day.id === hotelCheckInDayId));
  const hotelCheckOutDayOptions = [
    ...days
      .map((day, index) => ({ id: day.id, index, title: day.title }))
      .filter((option) => option.index > hotelCheckInDayIndex),
    { id: NEW_DAY_OPTION_ID, index: Math.max(days.length, hotelCheckInDayIndex + 1), title: "New day" },
  ];
  const selectedHotelCheckOutDayOption = hotelCheckOutDayOptions.find((option) => option.id === hotelCheckOutDayId) ?? hotelCheckOutDayOptions[0];
  const hotelCheckOutDayIndex = selectedHotelCheckOutDayOption.index;
  const hotelNightsCount = Math.max(1, hotelCheckOutDayIndex - hotelCheckInDayIndex);

  const createHotel = () => {
    if (!selectedHotelOption || !selectedRoomOption) return;
    const nights = hotelNightsCount;
    const checkInIndex = hotelCheckInDayIndex;
    const checkOutIndex = hotelCheckOutDayIndex;
    const stayGroupId = `hotel-stay-${Date.now()}`;
    // Rounding down every night and giving the remainder to the first one
    // keeps the nightly rows summing to exactly the room total.
    const nightlyPrice = Math.floor(selectedRoomOption.price / nights);
    const firstNightPrice = selectedRoomOption.price - nightlyPrice * (nights - 1);
    setDays((current) => {
      const next = [...current];
      while (next.length <= checkOutIndex) {
        const dayNumber = next.length + 1;
        next.push({ id: `day-${Date.now()}-${dayNumber}`, day: dayNumber, title: "Untitled day", meta: "Add your first stop", items: [], story: "", photos: [] });
      }
      for (let offset = 0; offset <= nights; offset += 1) {
        nextItemId.current += 1;
        const isCheckOutDay = offset === nights;
        const item: TimelineItem = {
          id: nextItemId.current,
          time: offset === 0 ? selectedHotelOption.checkIn : isCheckOutDay ? selectedHotelOption.checkOut : "Overnight stay",
          type: "HOTEL",
          title: isCheckOutDay
            ? `${selectedHotelOption.name} (Check-out)`
            : nights > 1 ? `${selectedHotelOption.name} (Night ${offset + 1} of ${nights})` : selectedHotelOption.name,
          price: `$${(offset === 0 ? firstNightPrice : nightlyPrice).toLocaleString("en-US")}/night`,
          icon: "hotel",
          status: "pass",
          address: selectedHotelOption.address,
          notes: hotelNotes.trim(),
          checkOut: selectedHotelOption.checkOut,
          roomType: selectedRoomOption.name,
          starRating: selectedHotelOption.starRating,
          stayMarker: offset === 0 ? "check-in" : isCheckOutDay ? "check-out" : undefined,
          stayGroupId,
        };
        const dayIndex = checkInIndex + offset;
        next[dayIndex] = { ...next[dayIndex], items: [...next[dayIndex].items, item] };
      }
      return next;
    });
    setActiveDay(checkInIndex);
    setAddingAfter(null);
    setAddFlow("type");
    setSelectedHotelOptionId(null);
    setSelectedRoomOptionId(null);
    setHotelNotes("");
    showNotice(nights > 1
      ? `${selectedHotelOption.name} added across ${nights} nights`
      : `${selectedHotelOption.name} added`);
  };

  const createCreatorPick = () => {
    if (addingAfter === null || !creatorDraft.title.trim()) return;
    insertItem(addingAfter, {
      time: creatorDraft.time,
      type: "CREATOR PICK",
      title: creatorDraft.title.trim(),
      price: creatorDraft.price.trim() ? `$${creatorDraft.price.trim()}` : "$0",
      icon: "star",
      status: "pass",
    });
    setCreatorDraft({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });
  };

  const recommendedActivities = [
    { title: "Shibuya Sky", meta: "Observation deck · 60 min", price: "$22" },
    { title: "Tsukiji Market", meta: "Food tour · 120 min", price: "Free" },
    { title: "teamLab Planets", meta: "Immersive art · 90 min", price: "$38" },
  ].filter((activity) => activity.title.toLowerCase().includes(activitySearch.trim().toLowerCase()));

  const addCopilotSuggestion = (suggestion: CopilotSuggestionV1) => {
    if (!activeDayData) return;
    nextItemId.current += 1;
    const newItem = copilotSuggestionToTimelineItem(suggestion, nextItemId.current, items);
    setDays((current) => appendItemToDay(current, activeDayData.id, newItem));
    showNotice(`${suggestion.item_name} added to Day ${activeDay + 1}`);
  };

  const deleteDay = (indexToDelete: number) => {
    if (days.length === 1) return;
    const remaining = removeDay(days, days[indexToDelete].id);
    setDays(remaining);
    setActiveDay((current) => {
      if (current > indexToDelete) return current - 1;
      if (current === indexToDelete) return Math.max(0, indexToDelete - 1);
      return current;
    });
    showNotice(`Day ${indexToDelete + 1} deleted`);
  };

  const deleteItem = (itemId: number) => {
    const target = days.flatMap((day) => day.items).find((entry) => entry.id === itemId);
    if (!target) return;
    setDays((current) => current.map((day) => ({
      ...day,
      items: day.items.filter((entry) => target.stayGroupId ? entry.stayGroupId !== target.stayGroupId : entry.id !== itemId),
    })));
    setPendingDeleteItemId(null);
    showNotice(`${target.title} removed`);
  };

  const requestDeleteItem = (item: TimelineItem) => {
    if (item.type === "FLIGHT" || item.type === "HOTEL") {
      setPendingDeleteItemId(item.id);
    } else {
      deleteItem(item.id);
    }
  };

  const pendingDeleteItem = pendingDeleteItemId !== null
    ? days.flatMap((day) => day.items).find((entry) => entry.id === pendingDeleteItemId) ?? null
    : null;
  const pendingDeleteItemStayCount = pendingDeleteItem?.stayGroupId
    ? days.flatMap((day) => day.items).filter((entry) => entry.stayGroupId === pendingDeleteItem.stayGroupId).length
    : 0;
  const pendingDeleteItemNightCount = Math.max(0, pendingDeleteItemStayCount - 1);

  const addFlowProps: AddStopFlowProps = {
    addingAfter, setAddingAfter,
    addFlow, setAddFlow,
    flightSearch, setFlightSearch,
    matchingFlights,
    selectedFlightId, setSelectedFlightId,
    addSelectedFlight,
    selectedHotelOptionId, setSelectedHotelOptionId,
    selectedRoomOptionId, setSelectedRoomOptionId,
    selectedHotelOption, selectedRoomOption,
    hotelCheckInDayId, setHotelCheckInDayId,
    setHotelCheckOutDayId,
    days,
    hotelCheckOutDayOptions,
    selectedHotelCheckOutDayOption,
    hotelNotes, setHotelNotes,
    createHotel,
    creatorDraft, setCreatorDraft,
    createCreatorPick,
    activitySearch, setActivitySearch,
    recommendedActivities,
    addRecommendedActivity,
    activityDraft, setActivityDraft,
    createActivity,
    activeDayData,
    openAddFlow,
  };

  return (
    <main className="itinerary-editor">
      <header className="editor-topbar">
        <button className="text-action back-action" onClick={onBack} aria-label="Edit destination, travel style, duration, or season"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> Edit trip setup</button>
        <div className="editor-title-block"><span className="editor-kicker">AI itinerary editor</span>{editingTitle ? <input className="package-title-input" value={titleDraft} autoFocus maxLength={200} aria-label="Package title" onChange={(event) => setTitleDraft(event.target.value)} onBlur={savePackageTitle} onKeyDown={(event) => { if (event.key === "Enter") savePackageTitle(); if (event.key === "Escape") { setTitleDraft(packageTitle); setEditingTitle(false); } }} /> : <button className="package-title-button" onClick={() => { setTitleDraft(packageTitle); setEditingTitle(true); }} aria-label={`Edit package title, currently ${packageTitle}`} title="Edit package title"><h1>{packageTitle}</h1></button>}</div>
        <div className="editor-actions">
          <button className="quiet-button" disabled={saving} onClick={() => { void saveDraft(); }}>{saving ? "Saving…" : saved ? "Saved" : "Save Draft"}</button>
          <button className="quiet-button" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button className="publish-button" onClick={() => { setPublished(true); showNotice("Package ready to publish"); }}>{published ? "Ready to publish" : "Continue to publish"}</button>
        </div>
      </header>

      <nav className="day-strip" aria-label="Itinerary days">
        <div className="day-tabs">
          {days.map((day, index) => <div key={day.day} className={`day-tab-wrap ${activeDay === index ? "active" : ""}`}>
            <button aria-current={activeDay === index ? "page" : undefined} className={`day-tab ${activeDay === index ? "active" : ""}`} onClick={() => setActiveDay(index)}><span>DAY {day.day} <b>{day.items.length}</b></span><strong>{day.title}</strong><small>{daySubtitle(day)}</small></button>
            <button className="delete-day-tab" disabled={days.length === 1} onClick={() => setPendingDeleteDay(index)} aria-label={`Delete Day ${day.day}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </div>)}
          <button className="add-day" onClick={() => { const nextDay = days.length + 1; setDays([...days, { id: `day-${Date.now()}`, day: nextDay, title: "Untitled day", meta: "Add your first stop", items: [], story: "", photos: [] }]); setActiveDay(days.length); showNotice("A new day was added"); }}><Icon name="plus" size={24} /><span>Add Day</span></button>
        </div>
        <div className="trip-length"><strong>{days.length} days</strong><span>{Math.max(0, days.length - 1)} nights</span></div>
      </nav>

      <div className="editor-shell">
        <div className="editor-main">
          <div className="day-heading"><div>
            <span>Day {activeDay + 1}</span>
            {editingDayField === "title"
              ? <input className="package-title-input" value={dayDraft} autoFocus maxLength={200} aria-label="Day title" onChange={(event) => setDayDraft(event.target.value)} onBlur={saveDayField} onKeyDown={(event) => { if (event.key === "Enter") saveDayField(); if (event.key === "Escape") setEditingDayField(null); }} />
              : <button className="package-title-button" onClick={() => startEditingDayField("title")} aria-label={`Edit day title, currently ${activeDayData?.title ?? "Untitled day"}`} title="Edit day title"><h2>{activeDayData?.title || "Untitled day"}</h2></button>}
          </div></div>

          <section className="story-section">
            <div className="section-label"><h3>Tell your story</h3><span>{photos.length} uploaded</span></div>
            <div className="photo-grid">
              {photos.map((photo) => <figure key={photo.src}>
                <img src={toSafeImageSrc(photo.src)} alt={photo.alt} />
                <button type="button" className="remove-photo-btn" aria-label={`Remove ${photo.alt}`} onClick={() => { void removeDayPhoto(photo); }}><Icon name="plus" size={10} /></button>
              </figure>)}
              <label className="photo-add"><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void addDayPhoto(file); }} /><Icon name="plus" size={30} /><span>Add photo</span><small>JPG or PNG</small></label>
            </div>
          </section>

          <section className="story-copy">
            <div className="section-label"><h3>Your story</h3><button className="ai-button" disabled={isGeneratingStory} aria-label="Generate story with AI" onClick={() => { void generateContent(); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></svg> {isGeneratingStory ? "Generating story…" : "AI write for me"}</button></div>
            <textarea value={story} onChange={(event) => setStory(event.target.value)} placeholder="Share your insider tips and personal recommendations…" aria-label="Your story" />
          </section>

          <section className="timeline-section">
            <h3>Timeline</h3>
            <div className="timeline-list">
              {items.map((item, index) => {
                const flightIndex = items.slice(0, index).filter(({ type }) => type === "FLIGHT").length;
                const flight = item.type === "FLIGHT" ? flights[flightIndex] : undefined;
                const hotel = hotelForItem(item);
                const hasHotelDetails = item.type === "HOTEL" && (Boolean(hotel) || Boolean(item.roomType));
                const isFixedActivity = item.type === "ACTIVITY";
                const scheduleConflict = REAL_TIME_PATTERN.test(item.time)
                  ? findTimeConflict(items, item.id, item.time, item.duration ?? "0")
                  : null;
                const nights = hotel ? hotelNights(hotel) : null;
                // Only the check-in row speaks for the whole stay; the night
                // and check-out rows keep their own per-night wording/price.
                const isStayHead = item.stayMarker === "check-in";
                const hotelTitle = hotel?.hotel_name && isStayHead
                  ? `${hotel.hotel_name}${nights ? ` (${nights} night${nights === 1 ? "" : "s"})` : ""}`
                  : item.title;
                const hotelTotal = isStayHead && nights && hotel?.price_per_night_aud !== null && hotel?.price_per_night_aud !== undefined
                  ? `$${(hotel.price_per_night_aud * nights).toLocaleString("en-AU")}`
                  : item.price;
                const itemPrice = flight?.price_aud !== null && flight?.price_aud !== undefined
                  ? `$${flight.price_aud.toLocaleString("en-AU")}`
                  : hotelTotal;
                const isTimeValue = /^\d{1,2}:\d{2}/.test(item.time);
                const isPriceValue = itemPrice.startsWith("$");
                const stayMarkerLabel = item.stayMarker === "check-in"
                    ? "Check-in"
                    : item.stayMarker === "check-out"
                      ? "Check-out"
                      : null;
                const canExpand = item.type === "FLIGHT" ? Boolean(flight) : item.type === "HOTEL" ? hasHotelDetails : true;
                const isExpanded = item.type === "FLIGHT" ? expandedFlightId === item.id : item.type === "HOTEL" ? expandedHotelId === item.id : editingItem?.id === item.id;
                const toggleExpand = () => {
                  if (item.type === "FLIGHT") { setExpandedFlightId((current) => current === item.id ? null : item.id); return; }
                  if (item.type === "HOTEL") { setExpandedHotelId((current) => current === item.id ? null : item.id); return; }
                  startEditingItem(item);
                };
                return <div key={item.id} className={`timeline-group ${addingAfter === index ? "adding" : ""} ${dropTarget?.index === index ? `drop-${dropTarget.position}` : ""}`} onDragOver={(event) => { event.preventDefault(); if (draggedItemId === item.id) return; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ index, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" }); }} onDrop={(event) => { event.preventDefault(); dropItem(); endDrag(); }}>
                <article className={`timeline-item ${scheduleConflict ? "critical" : item.status} ${draggedItemId === item.id ? "dragging" : ""} ${canExpand ? "editable" : ""} ${isExpanded ? "expanded" : ""}`} onClick={(event) => { if (!canExpand || (event.target as HTMLElement).closest("button")) return; toggleExpand(); }} onKeyDown={(event) => { if (!canExpand || (event.target as HTMLElement).closest("button")) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleExpand(); } }} tabIndex={canExpand ? 0 : undefined} role={canExpand ? "button" : undefined} aria-expanded={canExpand ? isExpanded : undefined}>
                  <button className="drag-handle" draggable aria-label={`Move ${hotelTitle}. Use drag and drop, or the up and down arrow keys.`} onDragStart={(event) => { setEditingItem(null); setDraggedItemId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(item.id)); }} onDragEnd={endDrag} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); moveItem(index, index - 1); } if (event.key === "ArrowDown") { event.preventDefault(); moveItem(index, index + 1); } }}><span /><span /><span /><span /><span /><span /></button>
                  <div className="item-time"><Icon name={item.icon} /><strong className={isTimeValue ? undefined : "item-time-word"}>{item.time}</strong></div>
                  <div className="item-copy"><div className="item-copy-head"><span>{item.type}</span>{stayMarkerLabel && <span className="stay-marker">{stayMarkerLabel}</span>}</div><h4>{hotelTitle}</h4>{scheduleConflict ? <div className="item-alert"><Icon name="alert" size={15} /><div><strong>Scheduling conflict</strong><span>{scheduleConflict}</span></div></div> : item.problem && <div className="item-alert"><Icon name="alert" size={15} /><div><strong>{item.problem}</strong><span>{item.problemDetail}</span></div></div>}</div>
                  <div className="item-price"><span>Price</span><strong className={isPriceValue ? undefined : "item-price-word"}>{withWrapBeforeSlash(itemPrice)}</strong></div>
                </article>
                {flight && expandedFlightId === item.id && <section id={`flight-details-${item.id}`} className="timeline-detail-panel" aria-label={`${flight.airline ?? "Flight"} details`}>
                  <div className="detail-card">
                    <div className="detail-card-top">
                      <div className="detail-card-heading">
                        <span className="detail-card-badge detail-card-badge-flight"><Icon name="plane" size={14} />Flight</span>
                        <div className="detail-card-title-row">
                          <h3>{flight.airline || "Flight"}</h3>
                          <p className="detail-card-subtitle"><Icon name="plane" size={14} />{flight.origin_iata || "Not provided"} to {flight.destination_iata || "Not provided"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="timeline-item-details">
                    <dl className="stat-grid">
                      <div><dt>Airline</dt><dd>{flight.airline || "Not provided"}</dd></div>
                      <div><dt>Flight number</dt><dd>{flight.flight_number || "Not provided"}</dd></div>
                      <div><dt>Cabin</dt><dd>{flight.cabin_class || "Not provided"}</dd></div>
                      <div><dt>From</dt><dd>{flight.origin_iata || "Not provided"}</dd></div>
                      <div><dt>To</dt><dd>{flight.destination_iata || "Not provided"}</dd></div>
                      <div><dt>Departure</dt><dd>{formatFlightDateTime(flight.departure_datetime, timezoneForIata(flight.origin_iata))}</dd></div>
                      <div><dt>Arrival</dt><dd>{formatFlightDateTime(flight.arrival_datetime, timezoneForIata(flight.destination_iata))}</dd></div>
                    </dl>
                  </div>
                  <button className="item-delete" onClick={() => requestDeleteItem(item)}>Delete</button>
                </section>}
                {hasHotelDetails && expandedHotelId === item.id && <section id={`hotel-details-${item.id}`} className="timeline-detail-panel" aria-label={`${hotel?.hotel_name ?? item.title ?? "Hotel"} details`}>
                  <div className="detail-card">
                    <div className="detail-card-top">
                      <div className="detail-card-heading">
                        <span className="detail-card-badge detail-card-badge-hotel"><Icon name="hotel" size={14} />Hotel</span>
                        <div className="detail-card-title-row">
                          <h3>{hotel?.hotel_name || item.title || "Hotel"}</h3>
                          <p className="detail-card-subtitle"><Icon name="pin" size={14} />{hotel ? (hotel.address || [hotel.city].filter(Boolean).join(", ") || "Not provided") : (item.address || "Not provided")}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="timeline-item-details">
                    <dl className="stat-grid">
                      {hotel ? <>
                        <div><dt>Room type</dt><dd>{hotel.room_type || "Not provided"}</dd></div>
                        <div><dt>Stay</dt><dd>{nights ? `${nights} night${nights === 1 ? "" : "s"}` : "Not provided"}</dd></div>
                        <div><dt>Check-in</dt><dd>{formatStayDate(hotel.check_in_date)}</dd></div>
                        <div><dt>Check-out</dt><dd>{formatStayDate(hotel.check_out_date)}</dd></div>
                        <div><dt>Rating</dt><dd className="rating-value">{hotel.star_rating ? <><Icon name="star" size={14} />{hotel.star_rating} / 5</> : "Not provided"}</dd></div>
                        <div><dt>Per night</dt><dd>{hotel.price_per_night_aud === null ? "Not provided" : `$${hotel.price_per_night_aud.toLocaleString("en-AU")} AUD`}</dd></div>
                        <div className="full"><dt>Address</dt><dd>{hotel.address || [hotel.city].filter(Boolean).join(", ") || "Not provided"}</dd></div>
                      </> : <>
                        <div><dt>Room type</dt><dd>{item.roomType || "Not provided"}</dd></div>
                        <div><dt>Check-in</dt><dd>{item.checkIn || "Not provided"}</dd></div>
                        <div><dt>Check-out</dt><dd>{item.checkOut || "Not provided"}</dd></div>
                        <div><dt>Rating</dt><dd className="rating-value">{item.starRating ? <><Icon name="star" size={14} />{item.starRating} / 5</> : "Not provided"}</dd></div>
                        <div className="full"><dt>Address</dt><dd>{item.address || "Not provided"}</dd></div>
                        {item.notes && <div className="full"><dt>Notes</dt><dd>{item.notes}</dd></div>}
                      </>}
                    </dl>
                  </div>
                  <button className="item-delete" onClick={() => requestDeleteItem(item)}>Delete</button>
                </section>}
                {editingItem?.id === item.id && <section className={`inline-edit${isFixedActivity ? " inline-edit-compact" : ""}`} aria-label={`${isFixedActivity ? "View" : "Edit"} ${item.title}`}>
                  {isFixedActivity ? <>
                    <div className="detail-card">
                      <div className="detail-card-top">
                        <div className="detail-card-heading">
                          <span className="detail-card-badge"><Icon name="star" size={14} />{editingItem.category}</span>
                          <div className="detail-card-title-row">
                            <h3>{editingItem.title}</h3>
                            <p className="detail-card-subtitle"><Icon name="pin" size={14} />{editingItem.address || "Address not provided"}</p>
                          </div>
                        </div>
                      </div>
                      <div className="activity-card-stats">
                        <div className="activity-card-stat"><Icon name="clock" size={16} /><span><small>Start time</small><div className="activity-card-time-field"><input type="time" className="activity-card-time-input" aria-label="Start time" value={editingItem.time} onChange={(event) => setEditingItem({ ...editingItem, time: event.target.value })} onClick={(event) => { try { event.currentTarget.showPicker(); } catch { /* unsupported browser: native click behavior still works */ } }} /></div></span></div>
                        <div className="activity-card-duration"><span className="activity-card-duration-label">{editingItem.duration} min</span></div>
                        <div className="activity-card-stat"><Icon name="clock" size={16} /><span><small>Ends at</small><strong>{getEndTime(editingItem.time, editingItem.duration)}</strong></span></div>
                      </div>
                      {timeConflict && <p className="activity-card-time-error" role="alert">{timeConflict}</p>}
                    </div>
                    <label className="activity-card-notes"><span>Notes</span><div className="activity-card-notes-field"><textarea value={editingItem.notes} maxLength={500} onChange={(event) => setEditingItem({ ...editingItem, notes: event.target.value })} placeholder="Share why this is worth a stop" /><small>{editingItem.notes.length} / 500</small></div></label>
                  </> : <>
                    <div className="edit-categories"><span>Category</span><div>{ACTIVITY_CATEGORIES.map((category) => <button key={category} className={editingItem.category === category ? "selected" : ""} onClick={() => setEditingItem({ ...editingItem, category })}>{category}</button>)}</div></div>
                    <div className="inline-edit-grid activity-details-grid">
                      <label className="edit-title"><span>Activity</span><input value={editingItem.title} onChange={(event) => setEditingItem({ ...editingItem, title: event.target.value })} autoFocus /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={editingItem.price} onChange={(event) => setEditingItem({ ...editingItem, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="edit-address"><span>Address</span><input value={editingItem.address} onChange={(event) => setEditingItem({ ...editingItem, address: event.target.value })} placeholder="Add an address" /></label>
                      <label><span>Start time</span><input type="time" value={editingItem.time} onChange={(event) => setEditingItem({ ...editingItem, time: event.target.value })} /></label>
                      <label><span>Duration (min)</span><select value={editingItem.duration} onChange={(event) => setEditingItem({ ...editingItem, duration: event.target.value })}>{DURATION_OPTIONS.map((duration) => <option key={duration}>{duration}</option>)}</select></label>
                      <label><span>Ends at</span><input value={getEndTime(editingItem.time, editingItem.duration)} readOnly /></label>
                      <label className="edit-notes"><span>Notes</span><textarea value={editingItem.notes} onChange={(event) => setEditingItem({ ...editingItem, notes: event.target.value })} placeholder="Share why this is worth a stop" /></label>
                    </div>
                    {timeConflict && <p className="activity-card-time-error" role="alert">{timeConflict}</p>}
                  </>}
                  {/* ponytail: per-activity photos stay local blob URLs — the media API
                      attaches files to a package, not to a timeline item. */}
                  <div className="edit-photo">
                    <span>Photos <small>Optional</small></span>
                    <div>
                      {editingItem.photos.map((photo, index) => <figure key={photo}>
                        <img src={photo} alt={index === 0 ? "Activity cover" : "Activity photo"} />
                        {index === 0
                          ? <b><Icon name="star" size={10} />Cover</b>
                          : <button type="button" className="set-cover-btn" onClick={() => setEditingItem({ ...editingItem, photos: [photo, ...editingItem.photos.filter((_, i) => i !== index)] })}>Set as cover</button>}
                        <button type="button" className="remove-photo-btn" aria-label="Remove photo" onClick={() => setEditingItem({ ...editingItem, photos: editingItem.photos.filter((_, i) => i !== index) })}><Icon name="plus" size={10} /></button>
                      </figure>)}
                      <label><input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) setEditingItem({ ...editingItem, photos: [...editingItem.photos, ...files.map((file) => URL.createObjectURL(file))] }); event.target.value = ""; }} /><Icon name="plus" size={18} />Add photo</label>
                    </div>
                  </div>
                  <div className="inline-edit-actions"><button className="item-delete" onClick={() => requestDeleteItem(item)}>Delete</button><button className="quiet-button" onClick={() => setEditingItem(null)}>Cancel</button><button className="publish-button" disabled={!editingItem.title.trim() || Boolean(timeConflict)} onClick={saveEditedItem}>Save changes</button></div>
                </section>}
                <AddStopFlow index={index} {...addFlowProps} />
              </div>})}
              {items.length === 0 && <AddStopFlow index={-1} {...addFlowProps} />}
            </div>
          </section>
        </div>

        <aside className="editor-sidebar">
          <button className="copilot-mobile-trigger" type="button" onClick={() => setCopilotOpen(true)}>Open Itinerary Co-Pilot</button>
          <Panel title="Package quality" className="quality-panel">
            <div className="quality-score"><strong>78</strong><span>/100</span></div>
            <div className="score-track" role="meter" aria-label="Package quality score, 78 out of 100. Minimum score to publish is 70." aria-valuemin={0} aria-valuemax={100} aria-valuenow={78}>
              <span className="score-fill" />
              <i aria-hidden="true" />
              <span className="score-threshold" aria-label="Minimum publish score is 70"><small>Minimum publish score:</small><strong>70</strong></span>
            </div>
            <div className="quality-meta"><strong><Icon name="check" size={14} />Ready to publish</strong></div>
          </Panel>
          <Panel title="Feasibility status" className="status-panel">
            <StatusToggle tone="critical" count={2} label="Critical issues" expanded={expandedFeasibility === "critical"} onClick={() => setExpandedFeasibility(expandedFeasibility === "critical" ? null : "critical")} />
            {expandedFeasibility === "critical" && <div className="status-details">
              <article><span className="critical-icon"><Icon name="alert" size={16} /></span><div><strong>Transfer time is too short</strong><p>Only 10 minutes between arrival and Shibuya Crossing. Allow at least 75 minutes.</p><button onClick={() => showNotice("Flight and activity highlighted")}>View affected stops</button></div></article>
              <article><span className="critical-icon"><Icon name="alert" size={16} /></span><div><strong>Hotel check-in conflict</strong><p>Check-in overlaps with the evening activity.</p><button onClick={() => showNotice("Hotel timing highlighted")}>View affected stops</button></div></article>
            </div>}
            <StatusToggle tone="warning" count={2} label="Suggestions" expanded={expandedFeasibility === "suggestions"} onClick={() => setExpandedFeasibility(expandedFeasibility === "suggestions" ? null : "suggestions")} />
            {expandedFeasibility === "suggestions" && <div className="status-details suggestions-details">
              <article><span className="warning-icon"><Icon name="alert" size={16} /></span><div><strong>Busy afternoon</strong><p>Eight stops may feel rushed. Consider moving one activity to Day 2.</p></div></article>
              <article><span className="warning-icon"><Icon name="alert" size={16} /></span><div><strong>Long gap before dinner</strong><p>There is an open window after Tokyo Tower that could include travel or a short break.</p></div></article>
            </div>}
            <StatusToggle tone="pass" count={4} label="Passed" expanded={expandedFeasibility === "passed"} onClick={() => setExpandedFeasibility(expandedFeasibility === "passed" ? null : "passed")} />
            {expandedFeasibility === "passed" && <ul className="passed-details"><li><Icon name="check" size={15} />Daily schedule has a clear start and end</li><li><Icon name="check" size={15} />All stops have pricing</li><li><Icon name="check" size={15} />Accommodation is included</li><li><Icon name="check" size={15} />Required package photos are uploaded</li></ul>}
          </Panel>
          <CopilotPanel
            client={copilotClient}
            city={pkg.destination_city ?? ""}
            mobileOpen={copilotOpen}
            onClose={() => setCopilotOpen(false)}
            dayLabel={`Day ${activeDay + 1}`}
            onAddSuggestion={addCopilotSuggestion}
          />
          <Panel title="Pricing & earnings" className="pricing-panel"><span>Total package price</span><strong>${packagePrice.toLocaleString()}</strong><hr/><span>Your commission (20%)</span><strong className="commission">${Math.round(packagePrice * .2).toLocaleString()}</strong><small>Est. 5–8 bookings/month</small></Panel>
          <Panel title="Route map" className="route-panel"><RouteMap stops={routeStops} /></Panel>
        </aside>
      </div>
      {notice && <div className="editor-toast" role="status">{notice}</div>}
      {pendingDeleteDay !== null && <div className="delete-day-backdrop" role="presentation" onMouseDown={() => setPendingDeleteDay(null)}>
        <section className="delete-day-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-day-title" aria-describedby="delete-day-description" onMouseDown={(event) => event.stopPropagation()}>
          <h2 id="delete-day-title">Delete Day {pendingDeleteDay + 1}?</h2>
          <p id="delete-day-description"><strong>{days[pendingDeleteDay]?.title}</strong> and every item in this day will be removed. This cannot be undone.</p>
          <div className="delete-day-actions">
            <button className="quiet-button" autoFocus onClick={() => setPendingDeleteDay(null)}>Cancel</button>
            <button className="confirm-delete-button" onClick={() => { const dayToDelete = pendingDeleteDay; setPendingDeleteDay(null); deleteDay(dayToDelete); }}>Delete day</button>
          </div>
        </section>
      </div>}
      {pendingDeleteItem && <div className="delete-day-backdrop" role="presentation" onMouseDown={() => setPendingDeleteItemId(null)}>
        <section className="delete-day-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-item-title" aria-describedby="delete-item-description" onMouseDown={(event) => event.stopPropagation()}>
          <h2 id="delete-item-title">Delete {pendingDeleteItem.type === "HOTEL" ? "hotel" : "flight"}?</h2>
          <p id="delete-item-description">
            {pendingDeleteItemStayCount > 1
              ? <>This stay spans <strong>{pendingDeleteItemNightCount} night{pendingDeleteItemNightCount === 1 ? "" : "s"}</strong> across this itinerary. Deleting it removes check-in through check-out, not just this card. This cannot be undone.</>
              : <>This will remove <strong>{pendingDeleteItem.title}</strong> from the itinerary. This cannot be undone.</>}
          </p>
          <div className="delete-day-actions">
            <button className="quiet-button" autoFocus onClick={() => setPendingDeleteItemId(null)}>Cancel</button>
            <button className="confirm-delete-button" onClick={() => deleteItem(pendingDeleteItem.id)}>Delete</button>
          </div>
        </section>
      </div>}
      {previewOpen && <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><button className="preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button><span>Traveller preview</span><h2 id="preview-title">{packageTitle}</h2><p>{story || "Your itinerary story will appear here. Add a personal introduction before publishing."}</p><div><strong>{days.length} days / 2 nights</strong><strong>${packagePrice.toLocaleString()}</strong></div><button className="publish-button" onClick={() => { setPreviewOpen(false); setPublished(true); showNotice("Package ready to publish"); }}>Continue to publish</button></section></div>}
    </main>
  );
}
