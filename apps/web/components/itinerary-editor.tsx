"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import CopilotPanel from "./copilot/copilot-panel";
import { formatHotelStarRating } from "./hotel-catalog";
import RouteMap, { type RouteStop } from "./route-map";
import { createCopilotClient } from "../lib/copilot-client";
import {
  appendItemToDay,
  buildDaysFromPackage,
  computePackagePrice,
  copilotSuggestionToTimelineItem,
  daySubtitle,
  extractClockTimeInZone,
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
  type CreatorFlightDetail,
  type CreatorHotelDetail,
  type CreatorPackageDetail,
} from "../lib/creator-api";
import { supabase } from "../lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type FeasibilityIssue = {
  error_code: string;
  rule: string;
  severity: "error" | "warning";
  field?: string;
  field_value?: string;
  affected_item: string;
  message: string;
  action: string;
};

type FeasibilityResult = {
  package_id: string;
  is_feasible: boolean;
  has_warnings: boolean;
  hard_errors: FeasibilityIssue[];
  soft_warnings: FeasibilityIssue[];
  summary: string;
  quality_score?: number;
  can_publish?: boolean;
  ai_response?: any;
};

function timeToSlot(time: string): string {
  const h = parseInt(time.split(":")[0], 10);
  if (isNaN(h) || h < 13) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

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
    hourglass: <><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22" /><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// Transfer-gap check thresholds used by annotateItems.
const MIN_TRANSFER_GAP_MIN = 15; // minutes — minimum breathing room between consecutive items
const LONG_ACTIVITY_MIN = 240;   // minutes — 4 hours

const ACTIVITY_CATEGORIES = ["Activity", "Restaurant", "Shopping", "Attraction", "Other"];
const DURATION_OPTIONS = ["30", "60", "90", "120", "180"];
const MAX_ITEM_PHOTOS = 6;

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

// "168 min" reads slower than "2h 48m" — raw minutes stay available as a
// tooltip for anyone who wants the exact figure.
function formatDuration(minutesText: string) {
  const total = Number(minutesText) || 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// Placeholder until hotels carry a real check-in/check-out time — the
// inventory only has dates, never a time of day. Industry-standard hours,
// not a per-hotel fact; swap for real data once the backend has it.
const STANDARD_HOTEL_CHECKIN_TIME = "15:00";
const STANDARD_HOTEL_CHECKOUT_TIME = "11:00";

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
// Landmark-level precision only exists for Tokyo; anywhere else, stops
// scatter around the day's actual city center instead of always Tokyo
// Station, which put every non-Tokyo trip's map in the wrong country.
const CITY_CENTERS: Record<string, [number, number]> = {
  Tokyo: [35.6812, 139.7671],
  Paris: [48.8566, 2.3522],
  Sydney: [-33.8688, 151.2093],
  Bali: [-8.6705, 115.2126],
};

function resolveStopCoordinate(hint: string, fallbackIndex: number, city: string | null): [number, number] {
  const lower = hint.toLowerCase();
  if (city === null || city === "Tokyo") {
    const match = TOKYO_LANDMARKS.find(({ keywords }) => keywords.some((keyword) => lower.includes(keyword)));
    if (match) return match.coordinate;
  }
  const center = (city && CITY_CENTERS[city]) || CITY_CENTERS.Tokyo;
  const angle = (fallbackIndex * 47 * Math.PI) / 180;
  const radius = 0.012;
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}

/** Convert "HH:MM" to total minutes from midnight. */
function toMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * Returns true when text appears to contain random/gibberish characters.
 * Heuristics (both must be language-agnostic enough to avoid false positives on proper nouns):
 *  1. Any word with 5+ consecutive consonants (e.g. "jrhfurehog")
 *  2. More than 40% of long words (>4 letters) have a vowel ratio below 15%
 * Short texts or texts with no long words are left alone.
 */
function detectGibberish(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  const lower = text.toLowerCase();
  // Immediate fail: any 5-consonant run is a strong gibberish signal
  if (/[^aeiou\s\d\W]{5,}/.test(lower.replace(/[^a-z]/g, " "))) return true;
  // Secondary: vowel-ratio check across long words
  const words = lower.split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")).filter((w) => w.length > 4);
  if (words.length === 0) return false;
  const suspicious = words.filter((w) => {
    const vowels = (w.match(/[aeiou]/g) ?? []).length;
    return vowels / w.length < 0.15;
  });
  return suspicious.length / words.length > 0.4;
}

/**
 * Annotates each item with problem / problemDetail / status based on (priority order):
 *  1. LONG_ACTIVITY : a single item's duration exceeds LONG_ACTIVITY_MIN
 *  2. OVERLAP       : this item starts before the previous item ends
 *  3. SHORT_TRANSFER: gap to the next item is > 0 but < MIN_TRANSFER_GAP_MIN
 *  4. GIBBERISH     : item notes contain random/unreadable characters
 * All other items are marked "pass" with no problem.
 */
function annotateItems(raw: TimelineItem[]): TimelineItem[] {
  return raw.map((item, i) => {
    const durationMin = Number(item.duration ?? 60);
    const endMin = toMinutes(item.time) + durationMin;

    // 1. Long single activity
    if (durationMin > LONG_ACTIVITY_MIN) {
      const hrs = (durationMin / 60).toFixed(1);
      return {
        ...item,
        status: "critical" as const,
        problem: "Activity is unusually long",
        problemDetail: `${hrs} hrs scheduled — consider splitting into two stops`,
      };
    }

    // 2 & 3. Gap vs next item — the list is a single day's items
    const next = raw[i + 1];
    if (next) {
      const nextStartMin = toMinutes(next.time);
      const gapMin = nextStartMin - endMin;

      if (gapMin < 0) {
        const overlapMin = Math.abs(gapMin);
        return {
          ...item,
          status: "critical" as const,
          problem: "Overlaps next item",
          problemDetail: `Ends ${overlapMin} min after "${next.title}" starts`,
        };
      }

      if (gapMin < MIN_TRANSFER_GAP_MIN) {
        return {
          ...item,
          status: "critical" as const,
          problem: "Transfer gap is too short",
          problemDetail: `${gapMin} min to reach "${next.title}" · ${MIN_TRANSFER_GAP_MIN} min minimum`,
        };
      }
    }

    // 4. Gibberish in description
    if (detectGibberish(item.notes ?? "")) {
      return {
        ...item,
        status: "critical" as const,
        problem: "Description contains unreadable text",
        problemDetail: "Remove random characters and use clear, traveller-friendly language",
      };
    }

    return { ...item, status: "pass" as const, problem: undefined, problemDetail: undefined };
  });
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`editor-panel ${className}`}><h2>{title}</h2>{children}</section>;
}

function StatusToggle({ tone, count, label, expanded, onClick }: { tone: "critical" | "warning" | "pass"; count?: number; label: string; expanded: boolean; onClick: () => void }) {
  return <button className="status-toggle" aria-expanded={expanded} onClick={onClick}><span className={`${tone}-icon`}><Icon name={tone === "pass" ? "check" : "alert"} size={16} /></span>{count !== undefined && <strong>{count}</strong>}<span>{label}</span><span className="status-chevron"><Icon name="chevron" size={17} /></span></button>;
}

// Hover (desktop) or tab-focus (keyboard/touch) reveals rating and
// suitable-for — the two catalog fields that don't fit on the card face —
// without an extra click. The "+" stays a separate button, so a tap that
// only opens the popover never also adds the stop.
function ActivityDetailPopover({ activity }: { activity: { title: string; rating: number | null; suitableFor: string | null } }) {
  if (activity.rating == null && !activity.suitableFor) return null;
  return <div className="activity-detail-popover">
    {activity.rating != null && <span className="activity-detail-rating"><Icon name="star" size={12} />{activity.rating.toFixed(1)}</span>}
    {activity.suitableFor && <span>Good for {activity.suitableFor}</span>}
  </div>;
}

type AddStopFlowProps = {
  addingAfter: number | null;
  setAddingAfter: Dispatch<SetStateAction<number | null>>;
  addFlow: AddFlowStep;
  setAddFlow: Dispatch<SetStateAction<AddFlowStep>>;
  flightSearch: string;
  setFlightSearch: Dispatch<SetStateAction<string>>;
  matchingFlights: CreatorFlightDetail[];
  selectedFlightIndex: number | null;
  setSelectedFlightIndex: Dispatch<SetStateAction<number | null>>;
  addSelectedFlight: () => void;
  availableHotels: CreatorHotelDetail[];
  selectedHotelIndex: number | null;
  setSelectedHotelIndex: Dispatch<SetStateAction<number | null>>;
  selectedHotelOption: CreatorHotelDetail | undefined;
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
  recommendedActivities: { title: string; meta: string; price: string; rating: number | null; suitableFor: string | null }[];
  addRecommendedActivity: (title: string, meta: string, price: string) => void;
  moreActivitiesOpen: boolean;
  setMoreActivitiesOpen: Dispatch<SetStateAction<boolean>>;
  activityDraft: ActivityDraft;
  setActivityDraft: Dispatch<SetStateAction<ActivityDraft>>;
  createActivity: () => void;
  activeDayData: BuilderDay | undefined;
  activeDayCity: string | null;
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
                      {p.matchingFlights.map((flight, index) => {
                        const departureTime = extractClockTimeInZone(flight.departure_datetime, timezoneForIata(flight.origin_iata)) ?? "--:--";
                        const arrivalTime = extractClockTimeInZone(flight.arrival_datetime, timezoneForIata(flight.destination_iata)) ?? "--:--";
                        return <button key={flight.flight_id ?? index} type="button" role="radio" aria-checked={p.selectedFlightIndex === index} className={p.selectedFlightIndex === index ? "selected" : ""} onClick={() => p.setSelectedFlightIndex(index)}>
                          <span className="flight-brand"><strong>{flight.airline ?? "Airline not provided"}</strong><small>{flight.flight_number ?? ""}</small></span>
                          <span className="flight-route"><strong>{departureTime}</strong><small>{flight.origin_iata ?? "Not provided"}</small></span>
                          <span className="flight-duration"><i aria-hidden="true"><Icon name="plane" size={20} /></i></span>
                          <span className="flight-route"><strong>{arrivalTime}</strong><small>{flight.destination_iata ?? "Not provided"}</small></span>
                          <span className="flight-fare"><small>From</small><strong>{flight.price_aud != null ? `$${flight.price_aud.toLocaleString("en-US")}` : "Not provided"}</strong></span>
                          <span className="flight-select" aria-hidden="true">{p.selectedFlightIndex === index ? <Icon name="check" size={18} /> : ""}</span>
                        </button>;
                      })}
                      {p.matchingFlights.length === 0 && <p>No matching flights found.</p>}
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={p.selectedFlightIndex === null} onClick={p.addSelectedFlight}>Add selected flight</button></div>
                  </>}

                  {p.addFlow === "hotel" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Add hotel</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <p className="database-note">Hotels are supplied by Travel Marketplace and cannot be edited here.</p>
                    <div className="hotel-choice-grid" role="radiogroup" aria-label="Available hotels">
                      {p.availableHotels.map((hotel, index) => <button key={hotel.hotel_id ?? hotel.hotel_name ?? index} type="button" role="radio" aria-checked={p.selectedHotelIndex === index} className={`hotel-choice-card${p.selectedHotelIndex === index ? " selected" : ""}`} onClick={() => p.setSelectedHotelIndex(index)}>
                        <span className="hotel-choice-copy">
                          <strong>{hotel.hotel_name ?? "Hotel"}</strong>
                          {hotel.star_rating != null && <span className="hotel-star-rating">{formatHotelStarRating(hotel.star_rating)}</span>}
                          <small>{hotel.city ?? "Not provided"}</small>
                          {hotel.room_type && <span>{hotel.room_type}</span>}
                          <b>{hotel.price_per_night_aud != null ? `$${hotel.price_per_night_aud.toLocaleString("en-US")}/night` : "Price not provided"}</b>
                        </span>
                        <span className="hotel-choice-check" aria-hidden="true">{p.selectedHotelIndex === index ? <Icon name="check" size={20} /> : ""}</span>
                      </button>)}
                      {p.availableHotels.length === 0 && <p>No hotels found for this package.</p>}
                    </div>
                    {p.selectedHotelOption && <>
                      <div className="hotel-confirm-card">
                        <div className="hotel-confirm-top">
                          <span className="hotel-confirm-heading">
                            <small>Hotel</small>
                            <strong>{p.selectedHotelOption.hotel_name ?? "Hotel"}</strong>
                            {p.selectedHotelOption.room_type && <span>{p.selectedHotelOption.room_type}</span>}
                          </span>
                          {p.selectedHotelOption.star_rating != null && <span className="hotel-confirm-rating">
                            <Icon name="star" size={16} />
                            <b>{p.selectedHotelOption.star_rating}</b><span>/ 5</span>
                          </span>}
                        </div>
                        <dl className="hotel-confirm-stats stat-grid">
                          <div><dt>Per night</dt><dd>{p.selectedHotelOption.price_per_night_aud != null ? `$${p.selectedHotelOption.price_per_night_aud.toLocaleString("en-US")}` : "Not provided"}</dd></div>
                          <div className="full"><dt>Address</dt><dd>{p.selectedHotelOption.address || p.selectedHotelOption.city || "Not provided"}</dd></div>
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
                        <label className="full"><span>Notes</span><textarea value={p.hotelNotes} onChange={(event) => p.setHotelNotes(event.target.value)} placeholder="Add check-in or booking details" /></label>
                      </div>
                    </>}
                    <div className="activity-form-actions"><button className="publish-button" disabled={!p.selectedHotelOption || !p.hotelCheckInDayId} onClick={p.createHotel}>Add hotel</button></div>
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
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={p.activitySearch} onChange={(event) => p.setActivitySearch(event.target.value)} placeholder={`Search ${p.activeDayCity ?? "local"} activities`} /></label>
                    <h5>Recommended for {p.activeDayCity ?? "this trip"}</h5>
                    <div className="activity-results">
                      {p.recommendedActivities.slice(0, 3).map((activity) => <div key={activity.title} className="activity-card">
                        <button className="activity-add-btn" aria-label={`Add ${activity.title}`} onClick={() => p.addRecommendedActivity(activity.title, activity.meta, activity.price)}><Icon name="plus" size={16} /></button>
                        <strong>{activity.title}</strong>
                        <small>{activity.meta}</small>
                        <b>{activity.price}</b>
                        <ActivityDetailPopover activity={activity} />
                      </div>)}
                      {p.recommendedActivities.length === 0 && <p>No activities found. Try another search or create your own.</p>}
                    </div>
                    {p.recommendedActivities.length > 3 && <>
                      <button className="activity-more-toggle" onClick={() => p.setMoreActivitiesOpen((open) => !open)} aria-expanded={p.moreActivitiesOpen}>
                        <span className="status-chevron"><Icon name="chevron" size={14} /></span>
                        {p.moreActivitiesOpen ? "Show fewer activities" : `See ${p.recommendedActivities.length - 3} more`}
                      </button>
                      {p.moreActivitiesOpen && <ul className="activity-list">
                        {p.recommendedActivities.slice(3).map((activity) => <li key={activity.title} className="activity-card">
                          <span className="activity-list-name"><strong>{activity.title}</strong><small>{activity.meta}</small></span>
                          <span className="activity-list-trail"><b>{activity.price}</b><button className="activity-add-btn" aria-label={`Add ${activity.title}`} onClick={() => p.addRecommendedActivity(activity.title, activity.meta, activity.price)}><Icon name="plus" size={14} /></button></span>
                          <ActivityDetailPopover activity={activity} />
                        </li>)}
                      </ul>}
                    </>}
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
  const [feasResult, setFeasResult] = useState<FeasibilityResult | null>(null);
  const [feasLoading, setFeasLoading] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [days, setDays] = useState(() => buildDaysFromPackage(pkg));
  const dayTabsRef = useRef<HTMLDivElement>(null);
  const [dayScroll, setDayScroll] = useState({ canLeft: false, canRight: false });
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
  const [recommendedActivities, setRecommendedActivities] = useState<{ title: string; meta: string; price: string; rating: number | null; suitableFor: string | null }[]>([]);
  const [moreActivitiesOpen, setMoreActivitiesOpen] = useState(false);
  const [activityDraft, setActivityDraft] = useState({ title: "", price: "", address: "", startTime: "12:00", duration: "30", notes: "" });
  const [flightSearch, setFlightSearch] = useState("");
  const [selectedFlightIndex, setSelectedFlightIndex] = useState<number | null>(null);
  const [selectedHotelIndex, setSelectedHotelIndex] = useState<number | null>(null);
  const [hotelNotes, setHotelNotes] = useState("");
  const [hotelCheckInDayId, setHotelCheckInDayId] = useState<string | null>(null);
  const [hotelCheckOutDayId, setHotelCheckOutDayId] = useState<string | null>(null);
  const [creatorDraft, setCreatorDraft] = useState({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });
  const [copilotOpen, setCopilotOpen] = useState(true);
  // "Saved" only holds while nothing has changed since the last successful PUT.
  const saved = savedSnapshot?.days === days && savedSnapshot?.title === packageTitle;
  const activeDayData = days[activeDay] ?? days[0];
  // Feasibility annotation is a pure function of the day's items, so it's
  // derived here once instead of being re-applied inside every handler.
  const items = useMemo(() => annotateItems(activeDayData?.items ?? []), [activeDayData]);
  const story = activeDayData?.story ?? "";
  const photos = activeDayData?.photos ?? [];
  // Activities carry a plain city name in `address` (buildDaysFromPackage);
  // hotels sometimes carry a full street address instead, so activities are
  // the more reliable signal for "what city is this day actually in."
  const activeDayCity = items.find((item) => item.type === "ACTIVITY" && item.address)?.address ?? null;
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
    return { label: item.title, time: item.time, coordinate: resolveStopCoordinate(hint, index, activeDayCity) };
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

  function buildValidationPayload() {
    return {
      package_id: pkg.package_id,
      trip_name: packageTitle,
      city: pkg.destination_city,
      country: pkg.destination_country,
      // ponytail: month/group size have no editor UI yet — wire real inputs when they do
      travel_month: "April",
      total_days: days.length,
      group_size: 2,
      hotel_name: pkg.hotels[0]?.hotel_name ?? "",
      hotel_stars: pkg.hotels[0]?.star_rating ?? 4,
      days_json: JSON.stringify(
        days.map((day) => ({
          day_number: day.day,
          // Flights on this day — used by R2 transfer-time check in route.ts
          flights: day.items
            .filter((item) => item.type === "FLIGHT")
            .map((item) => ({
              arrival_time: item.time,
              flight_type: item.title.toLowerCase().includes("international")
                ? "international"
                : "domestic",
              title: item.title,
            })),
          activities: day.items
            .filter((item) => item.type !== "FLIGHT" && item.type !== "HOTEL")
            .map((item) => ({
              activity_name: item.title,
              start_time: item.time,           // HH:MM — used by R2
              slot: timeToSlot(item.time),
              category: item.category ?? item.type ?? "Activity",
              duration_hours: Number(item.duration ?? 60) / 60,
              suitable_for: "Couple",
              address: item.address ?? "",
              description: item.notes ?? "",
            })),
        }))
      ),
    };
  }

  const runFeasibilityCheck = async () => {
    setFeasLoading(true);
    setFeasResult(null);
    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildValidationPayload()),
      });
      if (res.ok) {
        const data = await res.json();
        console.log("=== [AI VALIDATE CLIENT RESPONSE] ===", data);
        setFeasResult(data);
      }
    } catch (err) {
      console.error("Failed to run feasibility check:", err);
    } finally {
      setFeasLoading(false);
    }
  };

  // Invalidate the check result whenever itinerary content changes after a check has been run.
  // This forces creators to re-check before they can publish edited content.
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (!feasLoading) {
      setFeasResult(null);
    }
    // All itinerary content (items, story, photos) lives inside `days`; the
    // derived `items` is deliberately excluded so switching day tabs doesn't
    // clear an unchanged result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, packageTitle]);

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

  // The day strip only scrolls via trackpad/shift-wheel — a plain mouse has
  // no way to move it sideways, so arrow buttons need to know when there's
  // anywhere left to scroll.
  useEffect(() => {
    const el = dayTabsRef.current;
    if (!el) return;
    const update = () => setDayScroll({
      canLeft: el.scrollLeft > 1,
      canRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
    update();
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [days.length]);

  const scrollDayTabs = (direction: 1 | -1) => {
    dayTabsRef.current?.scrollBy({ left: direction * 240, behavior: "smooth" });
  };

  // Debounced so a fast typist doesn't fire a query per keystroke; queries the
  // real activities catalog directly (RLS grants public SELECT — see
  // supabase/migrations/0003_rls_policies.sql), not just a handful of AI-picked
  // rows the package already carries.
  useEffect(() => {
    if (addFlow !== "activities") return;
    const timer = window.setTimeout(async () => {
      let query = supabase
        .from("activities")
        .select("activity_name,city,category,duration_hours,price_aud,rating,suitable_for")
        .order("rating", { ascending: false })
        .limit(24);
      if (activeDayCity) query = query.eq("city", activeDayCity);
      const search = activitySearch.trim();
      if (search) query = query.ilike("activity_name", `%${search}%`);
      const { data, error } = await query;
      if (error || !data) { setRecommendedActivities([]); return; }
      // The catalog carries some exact-duplicate rows (same activity re-seeded
      // under a different id) — collapse those to one card by name.
      const seen = new Set<string>();
      const deduped = data.filter((row) => {
        const key = row.activity_name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setRecommendedActivities(deduped.map((row) => ({
        title: row.activity_name,
        meta: [row.category, row.duration_hours ? `${Math.round(row.duration_hours * 60)} min` : null, row.city].filter(Boolean).join(" · "),
        price: row.price_aud ? `$${row.price_aud}` : "Free",
        rating: row.rating,
        suitableFor: row.suitable_for,
      })));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [addFlow, activeDayCity, activitySearch]);

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
          selectedHotel: selectedHotelOption?.hotel_name ?? pkg.hotels[0]?.hotel_name ?? "",
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

  const saveEditedItem = () => {
    if (!editingItem || !editingItem.title.trim()) return;

    const updatedItem: TimelineItem = {
      ...items.find((item) => item.id === editingItem.id)!,
      title: editingItem.title.trim(),
      time: editingItem.time,
      price: editingItem.price ? `$${editingItem.price}` : "$0",
      category: editingItem.category,
      address: editingItem.address.trim(),
      duration: editingItem.duration,
      notes: editingItem.notes.trim(),
      photos: editingItem.photos,
    };
    const previousIndex = items.findIndex((item) => item.id === editingItem.id);
    const withUpdate = items.map((item) => item.id === editingItem.id ? updatedItem : item);
    // A changed start time moves the stop to wherever it now falls
    // chronologically, instead of blocking the save until neighbors are
    // rearranged by hand.
    const resorted = REAL_TIME_PATTERN.test(updatedItem.time)
      ? [...withUpdate].sort((a, b) => a.time.localeCompare(b.time))
      : withUpdate;

    setItems(resorted);
    setEditingItem(null);
    const newIndex = resorted.findIndex((item) => item.id === editingItem.id);
    showNotice(newIndex !== previousIndex ? `${updatedItem.title} moved to position ${newIndex + 1}` : "Stop updated");
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
    const flight = selectedFlightIndex !== null ? matchingFlights[selectedFlightIndex] : undefined;
    if (addingAfter === null || !flight) return;
    const scheduleDatetime = flight.arrival_datetime ?? flight.departure_datetime;
    insertItem(addingAfter, {
      time: extractClockTimeInZone(scheduleDatetime, timezoneForIata(flight.destination_iata ?? flight.origin_iata)) ?? "09:00",
      type: "FLIGHT",
      title: [flight.origin_iata, flight.destination_iata].filter(Boolean).join(" to ") || flight.airline || "Flight",
      price: flight.price_aud != null ? `$${flight.price_aud.toLocaleString("en-US")}` : "$0",
      icon: "plane",
      status: "pass",
    });
    setFlightSearch("");
    setSelectedFlightIndex(null);
  };

  const matchingFlights = flights.filter((flight) =>
    [flight.airline, flight.flight_number, flight.origin_iata, flight.destination_iata].join(" ").toLowerCase().includes(flightSearch.trim().toLowerCase()),
  );
  const selectedHotelOption = selectedHotelIndex !== null ? hotels[selectedHotelIndex] : undefined;

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
    if (!selectedHotelOption) return;
    const hotelName = selectedHotelOption.hotel_name ?? "Hotel";
    const pricePerNight = selectedHotelOption.price_per_night_aud ?? 0;
    const nights = hotelNightsCount;
    const checkInIndex = hotelCheckInDayIndex;
    const checkOutIndex = hotelCheckOutDayIndex;
    const stayGroupId = `hotel-stay-${nextItemId.current + 1}`;
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
          // "Check-in"/"Check-out"/"Overnight stay" instead of a fabricated
          // clock time — bookings only ever carry a date, never a time.
          time: offset === 0 ? "Check-in" : isCheckOutDay ? "Check-out" : "Overnight stay",
          type: "HOTEL",
          title: isCheckOutDay
            ? `${hotelName} (Check-out)`
            : nights > 1 ? `${hotelName} (Night ${offset + 1} of ${nights})` : hotelName,
          price: `$${pricePerNight.toLocaleString("en-US")}/night`,
          icon: "hotel",
          status: "pass",
          address: selectedHotelOption.address ?? selectedHotelOption.city ?? undefined,
          notes: hotelNotes.trim(),
          checkIn: selectedHotelOption.check_in_date ?? undefined,
          checkOut: selectedHotelOption.check_out_date ?? undefined,
          roomType: selectedHotelOption.room_type ?? undefined,
          starRating: selectedHotelOption.star_rating ?? undefined,
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
    setSelectedHotelIndex(null);
    setHotelNotes("");
    showNotice(nights > 1 ? `${hotelName} added across ${nights} nights` : `${hotelName} added`);
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

  const hardErrors = feasResult?.hard_errors ?? [];
  const softWarnings = feasResult?.soft_warnings ?? [];
  const hasEmptyDay = days.some((day) => day.items.length === 0);
  const displayScore = hasEmptyDay ? 0 : feasResult?.quality_score;

  const isReadyToPublish = Boolean(
    feasResult &&
    (displayScore ?? 0) >= 70 &&
    hardErrors.length === 0 &&
    feasResult.is_feasible
  );

  const handlePublish = () => {
    if (feasLoading) return;
    setPreviewOpen(false);
    if (!isReadyToPublish) {
      showNotice(!feasResult
        ? "Please check content before publishing."
        : (displayScore ?? 0) < 70
          ? `Your trip score is ${displayScore ?? 0}/100. A minimum score of 70 is required to publish. Improve your itinerary and check content again.`
          : "Fix critical feasibility issues and check content again before publishing.");
      return;
    }
    setPublished(true);
    showNotice("Package ready to publish");
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
    selectedFlightIndex, setSelectedFlightIndex,
    addSelectedFlight,
    availableHotels: hotels,
    selectedHotelIndex, setSelectedHotelIndex,
    selectedHotelOption,
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
    moreActivitiesOpen,
    setMoreActivitiesOpen,
    activityDraft, setActivityDraft,
    createActivity,
    activeDayData,
    activeDayCity,
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
          <button className="publish-button" disabled={feasLoading} onClick={handlePublish}>
            {!isReadyToPublish ? (feasResult && !feasResult.is_feasible ? "Fix issues to publish" : "Check content to publish") : "Continue to publish"}
          </button>
        </div>
      </header>

      <nav className="day-strip" aria-label="Itinerary days">
        <button type="button" className="day-scroll-btn" disabled={!dayScroll.canLeft} onClick={() => scrollDayTabs(-1)} aria-label="Scroll days left"><Icon name="chevron" size={18} /></button>
        <div className="day-tabs" ref={dayTabsRef}>
          {days.map((day, index) => <div key={day.day} className={`day-tab-wrap ${activeDay === index ? "active" : ""}`}>
            <button aria-current={activeDay === index ? "page" : undefined} className={`day-tab ${activeDay === index ? "active" : ""}`} onClick={() => setActiveDay(index)}><span>DAY {day.day} <b>{day.items.length}</b></span><strong>{day.title}</strong><small>{daySubtitle(day)}</small></button>
            <button className="delete-day-tab" disabled={days.length === 1} onClick={() => setPendingDeleteDay(index)} aria-label={`Delete Day ${day.day}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </div>)}
          <button className="add-day" onClick={() => { const nextDay = days.length + 1; setDays([...days, { id: `day-${Date.now()}`, day: nextDay, title: "Untitled day", meta: "Add your first stop", items: [], story: "", photos: [] }]); setActiveDay(days.length); showNotice("A new day was added"); }}><Icon name="plus" size={24} /><span>Add Day</span></button>
        </div>
        <button type="button" className="day-scroll-btn" disabled={!dayScroll.canRight} onClick={() => scrollDayTabs(1)} aria-label="Scroll days right"><Icon name="chevron" size={18} /></button>
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
            <div className="section-label"><h3>Day photos</h3><span>{photos.length} uploaded</span></div>
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
            <div className={`timeline-list${items.length === 0 ? " is-empty" : ""}`}>
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
                      <div><dt>Departure</dt><dd>{extractClockTimeInZone(flight.departure_datetime, timezoneForIata(flight.origin_iata)) ?? "Not provided"}</dd></div>
                      <div><dt>Arrival</dt><dd>{extractClockTimeInZone(flight.arrival_datetime, timezoneForIata(flight.destination_iata)) ?? "Not provided"}</dd></div>
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
                        <div><dt>Check-in</dt><dd>{STANDARD_HOTEL_CHECKIN_TIME}</dd></div>
                        <div><dt>Check-out</dt><dd>{STANDARD_HOTEL_CHECKOUT_TIME}</dd></div>
                        <div><dt>Stay</dt><dd>{nights ? `${nights} night${nights === 1 ? "" : "s"}` : "Not provided"}</dd></div>
                        <div><dt>Rating</dt><dd className="rating-value">{hotel.star_rating ? <><Icon name="star" size={14} />{hotel.star_rating} / 5</> : "Not provided"}</dd></div>
                        <div><dt>Per night</dt><dd>{hotel.price_per_night_aud === null ? "Not provided" : `$${hotel.price_per_night_aud.toLocaleString("en-AU")} AUD`}</dd></div>
                        <div className="full"><dt>Address</dt><dd>{hotel.address || [hotel.city].filter(Boolean).join(", ") || "Not provided"}</dd></div>
                      </> : <>
                        <div><dt>Room type</dt><dd>{item.roomType || "Not provided"}</dd></div>
                        <div><dt>Check-in</dt><dd>{STANDARD_HOTEL_CHECKIN_TIME}</dd></div>
                        <div><dt>Check-out</dt><dd>{STANDARD_HOTEL_CHECKOUT_TIME}</dd></div>
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
                          <h3>{editingItem.title}</h3>
                          <p className="detail-card-subtitle"><Icon name="pin" size={14} />{editingItem.address || "Address not provided"}</p>
                        </div>
                      </div>
                      <div className="activity-card-stats">
                        <div className="activity-card-stat">
                          <small>Start time</small>
                          <span className="activity-card-stat-value"><Icon name="clock" size={16} /><div className="activity-card-time-field"><input type="time" className="activity-card-time-input" aria-label="Start time" value={editingItem.time} onChange={(event) => setEditingItem({ ...editingItem, time: event.target.value })} onClick={(event) => { try { event.currentTarget.showPicker(); } catch { /* unsupported browser: native click behavior still works */ } }} /></div></span>
                        </div>
                        <div className="activity-card-stat">
                          <small>Duration</small>
                          <span className="activity-card-stat-value"><Icon name="hourglass" size={16} /><strong title={`${editingItem.duration} min`}>{formatDuration(editingItem.duration)}</strong></span>
                        </div>
                        <div className="activity-card-stat">
                          <small>End time</small>
                          <span className="activity-card-stat-value"><Icon name="clock" size={16} /><strong>{getEndTime(editingItem.time, editingItem.duration)}</strong></span>
                        </div>
                      </div>
                    </div>
                    <label className="activity-card-notes"><span>Notes</span><div className="activity-card-notes-field"><textarea ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }} value={editingItem.notes} maxLength={500} onChange={(event) => { event.currentTarget.style.height = "auto"; event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`; setEditingItem({ ...editingItem, notes: event.target.value }); }} placeholder="Share why this is worth a stop" /><small>{editingItem.notes.length} / 500</small></div></label>
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
                  </>}
                  {/* ponytail: per-activity photos stay local blob URLs — the media API
                      attaches files to a package, not to a timeline item. */}
                  <div className="edit-photo">
                    <div className="edit-photo-head"><span>Photos</span><small>Optional &middot; {editingItem.photos.length} / {MAX_ITEM_PHOTOS}</small></div>
                    <div>
                      {editingItem.photos.map((photo, index) => <figure key={photo}>
                        <img src={photo} alt={index === 0 ? "Activity cover" : "Activity photo"} />
                        {index === 0
                          ? <b><Icon name="star" size={10} />Cover</b>
                          : <button type="button" className="set-cover-btn" onClick={() => setEditingItem({ ...editingItem, photos: [photo, ...editingItem.photos.filter((_, i) => i !== index)] })}>Set as cover</button>}
                        <button type="button" className="remove-photo-btn" aria-label="Remove photo" onClick={() => setEditingItem({ ...editingItem, photos: editingItem.photos.filter((_, i) => i !== index) })}><Icon name="plus" size={10} /></button>
                      </figure>)}
                      {editingItem.photos.length < MAX_ITEM_PHOTOS && <label><input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []).slice(0, MAX_ITEM_PHOTOS - editingItem.photos.length); if (files.length) setEditingItem({ ...editingItem, photos: [...editingItem.photos, ...files.map((file) => URL.createObjectURL(file))] }); event.target.value = ""; }} /><Icon name="plus" size={18} />Add photo</label>}
                    </div>
                  </div>
                  <div className="inline-edit-actions"><button className="item-delete" onClick={() => requestDeleteItem(item)}>Delete</button><button className="quiet-button" onClick={() => setEditingItem(null)}>Cancel</button><button className="publish-button" disabled={!editingItem.title.trim()} onClick={saveEditedItem}>Save changes</button></div>
                </section>}
                <AddStopFlow index={index} {...addFlowProps} />
              </div>})}
              {items.length === 0 && (addingAfter === -1
                ? <AddStopFlow index={-1} {...addFlowProps} />
                : <div className="timeline-empty">
                    <span className="timeline-empty-icon"><Icon name="pin" size={22} /></span>
                    <p>No stops yet</p>
                    <small>Add a flight, hotel, or activity to start building this day.</small>
                    <button type="button" className="timeline-empty-add" onClick={() => openAddFlow(-1)}><Icon name="plus" size={14} /> Add stop</button>
                  </div>)}
            </div>
          </section>
        </div>

        <aside className="editor-sidebar">
          <button className="copilot-mobile-trigger" type="button" onClick={() => setCopilotOpen(true)}>Open Itinerary Co-Pilot</button>
          <Panel title="Package quality" className="quality-panel">
            <div className="quality-score"><strong>{displayScore !== undefined ? displayScore : "(-)"}</strong><span>/100</span></div>
            <div className="score-track" role="meter" aria-label={displayScore !== undefined ? `Package quality score, ${displayScore} out of 100. Minimum score to publish is 70.` : "Package quality score not yet checked. Minimum score to publish is 70."} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayScore ?? 0}>
              <span className="score-fill" style={{ width: displayScore !== undefined ? `${Math.min(100, Math.max(0, displayScore))}%` : "0%" }} />
              <i aria-hidden="true" />
              <span className="score-threshold" aria-label="Minimum publish score is 70"><small>Minimum publish score:</small><strong>70</strong></span>
            </div>
            <div className="quality-meta">
              <button
                className="quiet-button check-content-button"
                onClick={runFeasibilityCheck}
                disabled={feasLoading}
              >
                {feasLoading ? "Checking..." : "Check content"}
              </button>
              {isReadyToPublish ? (
                <strong><Icon name="check" size={14} />Ready to publish</strong>
              ) : (
                <strong className="warning">
                  <Icon name="alert" size={14} />
                  {!feasResult
                    ? "Please check content"
                    : hardErrors.length > 0
                      ? "Fix critical issues"
                      : "Score below 70"}
                </strong>
              )}
            </div>
          </Panel>
          <Panel title="Feasibility status" className="status-panel">
            <StatusToggle tone="critical" count={hardErrors.length} label="Critical issues" expanded={expandedFeasibility === "critical"} onClick={() => setExpandedFeasibility(expandedFeasibility === "critical" ? null : "critical")} />
            {expandedFeasibility === "critical" && <div className="status-details">
              {hardErrors.map((err, idx) => (
                <article key={idx}>
                  <span className="critical-icon"><Icon name="alert" size={16} /></span>
                  <div>
                    <strong>{err.affected_item}</strong>
                    <p>{err.message}</p>
                    <small>Fix: {err.action}</small>
                  </div>
                </article>
              ))}
              {hardErrors.length === 0 && <p style={{ padding: "8px", fontSize: "0.85rem", color: "#16a34a" }}>No critical issues detected.</p>}
            </div>}
            <StatusToggle tone="warning" count={softWarnings.length} label="Suggestions" expanded={expandedFeasibility === "suggestions"} onClick={() => setExpandedFeasibility(expandedFeasibility === "suggestions" ? null : "suggestions")} />
            {expandedFeasibility === "suggestions" && <div className="status-details suggestions-details">
              {softWarnings.map((warn, idx) => (
                <article key={idx}>
                  <span className="warning-icon"><Icon name="alert" size={16} /></span>
                  <div>
                    <strong>{warn.affected_item}</strong>
                    <p>{warn.message}</p>
                    <small>Fix: {warn.action}</small>
                  </div>
                </article>
              ))}
              {softWarnings.length === 0 && <p style={{ padding: "8px", fontSize: "0.85rem", color: "#6b7280" }}>No suggestions.</p>}
            </div>}
            <StatusToggle tone="pass" label="Passed" expanded={expandedFeasibility === "passed"} onClick={() => setExpandedFeasibility(expandedFeasibility === "passed" ? null : "passed")} />
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
          <Panel title="Pricing & earnings" className="pricing-panel"><span>Total package price</span><strong>${packagePrice.toLocaleString()}</strong><hr/><span>Your commission (20%)</span><strong className="commission">${Math.round(packagePrice * .2).toLocaleString()}</strong></Panel>
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
      {previewOpen && <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><button className="preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button><span>Traveller preview</span><h2 id="preview-title">{packageTitle}</h2><p>{story || "Your itinerary story will appear here. Add a personal introduction before publishing."}</p><div><strong>{days.length} days / 2 nights</strong><strong>${packagePrice.toLocaleString()}</strong></div><button className="publish-button" disabled={feasLoading} onClick={handlePublish}>{!isReadyToPublish ? (feasResult && !feasResult.is_feasible ? "Fix issues to publish" : "Check content to publish") : "Continue to publish"}</button></section></div>}
    </main>
  );
}