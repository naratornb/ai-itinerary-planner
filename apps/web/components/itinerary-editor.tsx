"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import CopilotPanel from "./copilot/copilot-panel";
import { formatHotelStarRating } from "./hotel-catalog";
import RouteMap, { type RouteStop } from "./route-map";
import { createCopilotClient } from "../lib/copilot-client";
import {
  appendItemToDay,
  buildPackageUpdate,
  buildDaysFromPackage,
  computePackagePrice,
  copilotSuggestionToTimelineItem,
  extractClockTimeInZone,
  flightDurationMinutes,
  getEndTime,
  insertItemInDay,
  nextCalendarDate,
  removeDay,
  timezoneForIata,
  type BuilderDay,
  type DayPhoto,
  type TimelineItem,
} from "../lib/itinerary-builder";
import type { CopilotSuggestionV1 } from "../lib/copilot";
import {
  deletePackageMedia,
  listPackageMedia,
  updatePackage,
  uploadPackageMedia,
  CreatorApiError,
  STATUS_LABELS,
  type CreatorFlightDetail,
  type CreatorHotelDetail,
  type CreatorPackageDetail,
} from "../lib/creator-api";
import { itinerarySnapshotStorageKey, parseWizardVibesDraft, wizardVibesStorageKey } from "../lib/review-draft";
import { APP_ROUTES } from "../lib/routes";
import { supabase } from "../lib/supabase/client";
import Icon from "./icon";

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

// Transfer-gap check thresholds used by annotateItems.
const MIN_TRANSFER_GAP_MIN = 15; // minutes — minimum breathing room between consecutive items
const LONG_ACTIVITY_MIN = 240;   // minutes — 4 hours

const ACTIVITY_CATEGORIES = ["Activity", "Restaurant", "Shopping", "Attraction", "Other"];
const DURATION_OPTIONS = ["30", "60", "90", "120", "150", "180", "210", "240"];
// Labels, not ids — the wizard's sessionStorage stash stores vibes by label.
const TRIP_VIBE_OPTIONS = ["Chill", "Adventure", "Luxury", "Local Experience", "Foodie", "Scenic"];
const TRIP_SEASON_OPTIONS = ["spring", "summer", "autumn", "winter"];
const MAX_TRIP_VIBES = 3;
// Matches the wizard's longest duration bucket (9-14 days).
const MAX_TRIP_DAYS = 14;
const MAX_ITEM_PHOTOS = 6;
// The detail page only renders one hero image per day (assignDayImages maps
// one media item per day slot) — a second upload here would never be shown.
const MAX_DAY_PHOTOS = 1;

const NEW_DAY_OPTION_ID = "__new-day__";

type AddFlowStep = "type" | "activities" | "flight" | "hotel" | "creator";
type CreatorDraft = { title: string; category: string; address: string; time: string; duration: string; price: string; reason: string };
type HotelDayOption = { id: string; index: number; title: string };

function hotelNights(hotel: CreatorHotelDetail) {
  if (hotel.nights && hotel.nights > 0) return hotel.nights;
  if (!hotel.check_in_date || !hotel.check_out_date) return null;
  const checkIn = Date.parse(`${hotel.check_in_date}T00:00:00Z`);
  const checkOut = Date.parse(`${hotel.check_out_date}T00:00:00Z`);
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut <= checkIn) return null;
  return Math.round((checkOut - checkIn) / 86_400_000);
}

const REAL_TIME_PATTERN = /^\d{1,2}:\d{2}/;

const REFERENCE_FLIGHT_GUIDANCE = "Travellers will see similar flights for their dates and departure airport.";

function sentenceCase(value: string) {
  const normalized = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "";
}

// Item-type breakdown for a day's tab badge row — same 4 icons as the
// "Select item type" add-stop screen (flight, hotel, activity, creator pick).
function dayItemTypeCounts(day: BuilderDay) {
  const counts = { FLIGHT: 0, HOTEL: 0, ACTIVITY: 0, "CREATOR PICK": 0 };
  for (const item of day.items) {
    if (item.type in counts) counts[item.type as keyof typeof counts] += 1;
  }
  return [
    { key: "flight", icon: "plane" as const, count: counts.FLIGHT, label: "Reference flights" },
    { key: "hotel", icon: "hotel" as const, count: counts.HOTEL, label: "Hotels" },
    { key: "activity", icon: "star" as const, count: counts.ACTIVITY, label: "Activities" },
    { key: "creator", icon: "check" as const, count: counts["CREATOR PICK"], label: "Creator picks" },
  ].filter((entry) => entry.count > 0);
}

function formatRelativeTime(fromMs: number, nowMs: number = Date.now()) {
  const minutes = Math.floor((nowMs - fromMs) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Rule engine prefixes issue `field` with "Day N" (e.g. "Day 3 – Morning") — see lib/feasibility.ts.
function parseIssueDay(field?: string): number | null {
  const match = field?.match(/^Day (\d+)/);
  return match ? Number(match[1]) : null;
}

export function referenceFlightPresentation(item: TimelineItem) {
  const route = item.originIata && item.destinationIata
    ? `${item.originIata} → ${item.destinationIata}`
    : item.title;
  const title = [item.flightNumber, route].filter(Boolean).join(" · ");
  const times = item.departureTime && item.arrivalTime
    ? `${item.departureTime}–${item.arrivalTime}`
    : item.departureTime || item.arrivalTime || (REAL_TIME_PATTERN.test(item.time) ? item.time : "");
  const schedule = [times, item.cabinClass ? sentenceCase(item.cabinClass) : ""]
    .filter(Boolean)
    .join(" · ");

  return {
    label: "REFERENCE FLIGHT",
    subtitle: "Creator’s suggested option",
    title: title || "Reference flight",
    schedule,
    priceLabel: "Estimated",
    price: item.price,
    guidance: REFERENCE_FLIGHT_GUIDANCE,
  };
}

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
  Seoul: [37.5665, 126.9780],
  Reykjavik: [64.1466, -21.9426],
  Athens: [37.9838, 23.7275],
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

    // 1. Long single activity — flights routinely run past this on their own, so skip them
    if (item.type !== "FLIGHT" && durationMin > LONG_ACTIVITY_MIN) {
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

function Panel({ title, icon, badge, children, className = "" }: { title: string; icon?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`editor-panel ${className}`}><div className="editor-panel-header"><h2>{icon}{title}</h2>{badge}</div>{children}</section>;
}

const TIME_FIELD_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const TIME_FIELD_MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

// A "HH:MM" input that still accepts direct keyboard typing (the real
// <input type="time"> underneath), plus a styled dropdown — opened by our
// own chevron, never the browser's native picker — for click-to-pick.
function TimeField({ value, onChange, ariaLabel, className = "" }: { value: string; onChange: (value: string) => void; ariaLabel: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hh, mm] = value.split(":");

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`time-field ${className}`} ref={containerRef}>
      <input type="time" className="time-field-input" aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="time-field-toggle" aria-label={`${open ? "Close" : "Open"} time picker`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="time-field-dropdown" role="presentation">
          <div className="time-field-col" role="listbox" aria-label="Hour">
            {TIME_FIELD_HOURS.map((h) => (
              <button type="button" key={h} role="option" aria-selected={h === hh} className={`time-field-option${h === hh ? " selected" : ""}`} onClick={() => onChange(`${h}:${mm}`)}>{h}</button>
            ))}
          </div>
          <div className="time-field-col" role="listbox" aria-label="Minute">
            {TIME_FIELD_MINUTES.map((m) => (
              <button type="button" key={m} role="option" aria-selected={m === mm} className={`time-field-option${m === mm ? " selected" : ""}`} onClick={() => { onChange(`${hh}:${m}`); setOpen(false); }}>{m}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type SelectFieldOption = { value: string; label: string };

// A styled stand-in for a native <select> of a short fixed option list
// (durations, categories, day pickers, …) — no native dropdown to restyle,
// so this is a plain button + custom list instead of an <input> like
// TimeField. String options are shorthand for { value, label } pairs where
// the two are the same (durations, categories); day pickers need distinct
// value (the day id) and label (the display text) so pass objects there.
function SelectField({ value, onChange, options, ariaLabel, className = "", placeholder }: { value: string; onChange: (value: string) => void; options: (string | SelectFieldOption)[]; ariaLabel: string; className?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalized = options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));
  const selectedLabel = normalized.find((option) => option.value === value)?.label ?? placeholder ?? value;

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`select-field ${className}`} ref={containerRef}>
      <button type="button" className="select-field-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{selectedLabel}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <div className="select-field-dropdown" role="listbox" aria-label={ariaLabel}>
          {normalized.map((option) => (
            <button type="button" key={option.value} role="option" aria-selected={option.value === value} className={`select-field-option${option.value === value ? " selected" : ""}`} onClick={() => { onChange(option.value); setOpen(false); }}>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  moreHotelsOpen: boolean;
  setMoreHotelsOpen: Dispatch<SetStateAction<boolean>>;
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
  creatorPhotos: DayPhoto[];
  setCreatorPhotos: Dispatch<SetStateAction<DayPhoto[]>>;
  addCreatorPhotos: (files: File[]) => Promise<void>;
  removeCreatorPhoto: (photo: DayPhoto) => void;
  trackUpload: <T,>(operation: Promise<T>) => Promise<T>;
  toSafeImageSrc: (value: string) => string;
  createCreatorPick: () => void;
  activitySearch: string;
  setActivitySearch: Dispatch<SetStateAction<string>>;
  recommendedActivities: { title: string; meta: string; price: string; rating: number | null; suitableFor: string | null }[];
  addRecommendedActivity: (title: string, meta: string, price: string) => void;
  moreActivitiesOpen: boolean;
  setMoreActivitiesOpen: Dispatch<SetStateAction<boolean>>;
  activeDayData: BuilderDay | undefined;
  activeDayCity: string | null;
  openAddFlow: (after: number) => void;
};

function AddStopFlow({ index, ...p }: AddStopFlowProps & { index: number }) {
  return p.addingAfter === index ? <section className="inline-add" aria-label="Add a stop">
                  {p.addFlow === "type" && <>
                    <div className="inline-add-head"><h4>Select item type</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <div className="item-type-grid">
                      <button onClick={() => p.setAddFlow("flight")}><span className="type-icon flight"><Icon name="plane" /></span><strong>Reference flight</strong><small>Suggest an air travel option</small></button>
                      <button onClick={() => { p.setAddFlow("hotel"); p.setHotelCheckInDayId(p.activeDayData?.id ?? null); p.setHotelCheckOutDayId(null); }}><span className="type-icon hotel"><Icon name="hotel" /></span><strong>Hotel</strong><small>Accommodation and stays</small></button>
                      <button onClick={() => p.setAddFlow("activities")}><span className="type-icon activity"><Icon name="star" /></span><strong>Activity</strong><small>Tours, museums, and experiences</small></button>
                      <button onClick={() => p.setAddFlow("creator")}><span className="type-icon creator"><Icon name="check" /></span><strong>Creator Pick</strong><small>Your own recommendation</small></button>
                    </div>
                  </>}

                  {p.addFlow === "flight" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Choose a reference flight</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <label className="activity-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={p.flightSearch} onChange={(event) => p.setFlightSearch(event.target.value)} placeholder="Search by airport, airline, or flight number" /></label>
                    <p className="database-note">Choose an example for the itinerary. Travellers will see similar flights after selecting their dates and departure airport.</p>
                    <div className="flight-results" role="radiogroup" aria-label="Available flights">
                      {p.matchingFlights.map((flight, index) => {
                        const departureTime = extractClockTimeInZone(flight.departure_datetime, timezoneForIata(flight.origin_iata)) ?? "--:--";
                        const arrivalTime = extractClockTimeInZone(flight.arrival_datetime, timezoneForIata(flight.destination_iata)) ?? "--:--";
                        return <button key={flight.flight_id ?? index} type="button" role="radio" aria-checked={p.selectedFlightIndex === index} className={p.selectedFlightIndex === index ? "selected" : ""} onClick={() => p.setSelectedFlightIndex(index)}>
                          <span className="flight-brand"><strong>{flight.airline ?? "Airline not provided"}</strong><small>{flight.flight_number ?? ""}</small></span>
                          <span className="flight-route"><strong>{departureTime}</strong><small>{flight.origin_iata ?? "Not provided"}</small></span>
                          <span className="flight-duration"><i aria-hidden="true"><Icon name="plane" size={20} /></i></span>
                          <span className="flight-route"><strong>{arrivalTime}</strong><small>{flight.destination_iata ?? "Not provided"}</small></span>
                          <span className="flight-fare"><small>Estimated</small><strong>{flight.price_aud != null ? `$${flight.price_aud.toLocaleString("en-US")}` : "Not provided"}</strong></span>
                          <span className="flight-select" aria-hidden="true">{p.selectedFlightIndex === index ? <Icon name="check" size={18} /> : ""}</span>
                        </button>;
                      })}
                      {p.matchingFlights.length === 0 && <p>No matching flights found.</p>}
                    </div>
                    <div className="activity-form-actions"><button className="publish-button" disabled={p.selectedFlightIndex === null} onClick={p.addSelectedFlight}>Add as reference flight</button></div>
                  </>}

                  {p.addFlow === "hotel" && <>
                    <div className="inline-add-head"><button className="inline-back" onClick={() => p.setAddFlow("type")} aria-label="Back to item types">‹</button><h4>Add hotel</h4><button onClick={() => p.setAddingAfter(null)}>Cancel</button></div>
                    <p className="database-note">Hotels are supplied by Travel Marketplace and cannot be edited here.</p>
                    {!p.selectedHotelOption && <>
                      <div className="hotel-choice-grid" role="radiogroup" aria-label="Available hotels">
                        {p.availableHotels.map((hotel, index) => (index < 3 || p.moreHotelsOpen) && <button key={hotel.hotel_id ?? hotel.hotel_name ?? index} type="button" role="radio" aria-checked={p.selectedHotelIndex === index} title={hotel.star_rating != null ? formatHotelStarRating(hotel.star_rating) : undefined} className={`hotel-choice-card${p.selectedHotelIndex === index ? " selected" : ""}`} onClick={() => p.setSelectedHotelIndex(index)}>
                          {hotel.star_rating != null && <span className="hotel-choice-rating"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>{hotel.star_rating}</span>}
                          <span className="hotel-choice-check" aria-hidden="true">{p.selectedHotelIndex === index && <Icon name="check" size={16} />}</span>
                          <strong>{hotel.hotel_name ?? "Hotel"}</strong>
                          <small><Icon name="pin" size={12} />{hotel.city ?? "Not provided"}{hotel.room_type ? ` · ${hotel.room_type}` : ""}</small>
                          <span className="hotel-choice-from"><small>FROM</small><b>{hotel.price_per_night_aud != null ? `$${hotel.price_per_night_aud.toLocaleString("en-US")}/night` : "Price not provided"}</b></span>
                        </button>)}
                        {p.availableHotels.length === 0 && <p>No hotels found for this destination.</p>}
                      </div>
                      {p.availableHotels.length > 3 && (
                        <button className="activity-more-toggle" onClick={() => p.setMoreHotelsOpen((open) => !open)} aria-expanded={p.moreHotelsOpen}>
                          <span className="status-chevron"><Icon name="chevron" size={14} /></span>
                          {p.moreHotelsOpen ? "Show fewer hotels" : `See ${p.availableHotels.length - 3} more`}
                        </button>
                      )}
                    </>}
                    {p.selectedHotelOption && <>
                      <div className="hotel-confirm-card">
                        <div className="hotel-confirm-top">
                          <span className="hotel-confirm-heading">
                            <small>Hotel</small>
                            <strong>{p.selectedHotelOption.hotel_name ?? "Hotel"}</strong>
                            {p.selectedHotelOption.room_type && <span>{p.selectedHotelOption.room_type}</span>}
                          </span>
                          <button type="button" className="hotel-confirm-change" onClick={() => p.setSelectedHotelIndex(null)}>Change hotel</button>
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
                          <SelectField
                            value={p.hotelCheckInDayId ?? ""}
                            onChange={p.setHotelCheckInDayId}
                            ariaLabel="Check-in day"
                            options={[
                              ...p.days.map((day) => ({ value: day.id, label: `Day ${day.day}: ${day.title}` })),
                              { value: NEW_DAY_OPTION_ID, label: `Day ${p.days.length + 1} (new day)` },
                            ]}
                          />
                        </label>
                        <label><span>Checkout day</span>
                          <SelectField
                            value={p.selectedHotelCheckOutDayOption.id}
                            onChange={p.setHotelCheckOutDayId}
                            ariaLabel="Checkout day"
                            options={p.hotelCheckOutDayOptions.map((option) => ({
                              value: option.id,
                              label: option.id === NEW_DAY_OPTION_ID ? `Day ${option.index + 1} (new day)` : `Day ${option.index + 1}: ${option.title}`,
                            }))}
                          />
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
                      <label><span>Category</span><SelectField value={p.creatorDraft.category} onChange={(category) => p.setCreatorDraft({ ...p.creatorDraft, category })} options={ACTIVITY_CATEGORIES} ariaLabel="Category" /></label>
                      <label><span>Start time</span><TimeField value={p.creatorDraft.time} onChange={(time) => p.setCreatorDraft({ ...p.creatorDraft, time })} ariaLabel="Start time" /></label>
                      <label><span>Duration (min)</span><SelectField value={p.creatorDraft.duration} onChange={(duration) => p.setCreatorDraft({ ...p.creatorDraft, duration })} options={DURATION_OPTIONS} ariaLabel="Duration (min)" /></label>
                      <label><span>Ends at</span><input value={getEndTime(p.creatorDraft.time, p.creatorDraft.duration)} readOnly /></label>
                      <label className="three-quarter"><span>Address</span><input value={p.creatorDraft.address} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, address: event.target.value })} /></label>
                      <label><span>Price</span><div className="price-input"><b>$</b><input inputMode="decimal" value={p.creatorDraft.price} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, price: event.target.value.replace(/[^0-9.]/g, "") })} /></div></label>
                      <label className="full"><span>Why you recommend it</span><textarea value={p.creatorDraft.reason} onChange={(event) => p.setCreatorDraft({ ...p.creatorDraft, reason: event.target.value })} placeholder="Share the detail travellers should know" /></label>
                    </div>
                    <div className="edit-photo">
                      <div className="edit-photo-head"><span>Photos</span><small>Optional &middot; {p.creatorPhotos.length} / {MAX_ITEM_PHOTOS}</small></div>
                      <div>
                        {p.creatorPhotos.map((photo, index) => <figure key={photo.src}>
                          <img src={p.toSafeImageSrc(photo.src)} alt={photo.alt || (index === 0 ? "Creator pick cover" : "Creator pick photo")} />
                          {index === 0
                            ? <b><Icon name="star" size={10} />Cover</b>
                            : <button type="button" className="set-cover-btn" onClick={() => p.setCreatorPhotos([photo, ...p.creatorPhotos.filter((_, i) => i !== index)])}>Set as cover</button>}
                          <button type="button" className="remove-photo-btn" aria-label="Remove photo" onClick={() => p.removeCreatorPhoto(photo)}><Icon name="plus" size={10} /></button>
                        </figure>)}
                        {p.creatorPhotos.length < MAX_ITEM_PHOTOS && <label><input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []).slice(0, MAX_ITEM_PHOTOS - p.creatorPhotos.length); event.target.value = ""; if (files.length) void p.trackUpload(p.addCreatorPhotos(files)); }} /><span className="edit-photo-add-icon"><Icon name="plus" size={16} /></span><span className="edit-photo-add-label">Add photo</span></label>}
                      </div>
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
                      {p.moreActivitiesOpen && <div className="activity-results activity-results-more">
                        {p.recommendedActivities.slice(3).map((activity) => <div key={activity.title} className="activity-card">
                          <button className="activity-add-btn" aria-label={`Add ${activity.title}`} onClick={() => p.addRecommendedActivity(activity.title, activity.meta, activity.price)}><Icon name="plus" size={16} /></button>
                          <strong>{activity.title}</strong>
                          <small>{activity.meta}</small>
                          <b>{activity.price}</b>
                          <ActivityDetailPopover activity={activity} />
                        </div>)}
                      </div>}
                    </>}
                    <button className="create-activity-link" onClick={() => p.setAddFlow("creator")}><Icon name="plus" size={16} /> Create new activity</button>
                  </>}
                </section> : <button className="timeline-add" onClick={() => p.openAddFlow(index)}><Icon name="plus" size={14} /> Add stop</button>;
}

export default function ItineraryEditor({
  pkg,
  onSessionExpired,
  onContinueToReview,
}: {
  pkg: CreatorPackageDetail;
  onSessionExpired: () => void;
  onContinueToReview: () => void;
}) {
  const router = useRouter();
  const [pendingLeaveConfirm, setPendingLeaveConfirm] = useState(false);
  const [packageDetail, setPackageDetail] = useState(pkg);
  const { flights, hotels } = packageDetail;
  const copilotClient = useMemo(
    () => createCopilotClient(API_URL, pkg.package_id),
    [pkg.package_id],
  );
  const nextItemId = useRef(1000);
  const pendingUploads = useRef<Set<Promise<unknown>>>(new Set());
  const submittingRef = useRef(false);
  const [packageTitle, setPackageTitle] = useState(pkg.title);
  const [titleDraft, setTitleDraft] = useState(pkg.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [feasResult, setFeasResult] = useState<FeasibilityResult | null>(null);
  const [feasLoading, setFeasLoading] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [days, setDays] = useState(() => buildDaysFromPackage(pkg));
  const dayTabsRef = useRef<HTMLDivElement>(null);
  const [dayScroll, setDayScroll] = useState({ canLeft: false, canRight: false });
  const [savedSnapshot, setSavedSnapshot] = useState<{ days: BuilderDay[]; title: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [packageStatus, setPackageStatus] = useState(pkg.status ?? "draft");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  // Only draft/rejected packages may be saved or submitted (apps/api/app/packages/service.py) —
  // everything else is a read-only lifecycle state past this editor's control.
  const isLocked = packageStatus !== "draft" && packageStatus !== "rejected";
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
  const [editingItem, setEditingItem] = useState<{ id: number; title: string; time: string; price: string; category: string; address: string; duration: string; notes: string; photos: DayPhoto[] } | null>(null);
  const [expandedHotelId, setExpandedHotelId] = useState<number | null>(null);
  const [expandedFlightId, setExpandedFlightId] = useState<number | null>(null);
  const [expandedFeasibility, setExpandedFeasibility] = useState<"critical" | "suggestions" | "passed" | null>(null);
  const [addFlow, setAddFlow] = useState<AddFlowStep>("type");
  const [activitySearch, setActivitySearch] = useState("");
  const [recommendedActivities, setRecommendedActivities] = useState<{ title: string; meta: string; price: string; rating: number | null; suitableFor: string | null }[]>([]);
  const [moreActivitiesOpen, setMoreActivitiesOpen] = useState(false);
  const [catalogHotels, setCatalogHotels] = useState<CreatorHotelDetail[] | null>(null);
  const [flightSearch, setFlightSearch] = useState("");
  const [selectedFlightIndex, setSelectedFlightIndex] = useState<number | null>(null);
  const [selectedHotelIndex, setSelectedHotelIndex] = useState<number | null>(null);
  const [moreHotelsOpen, setMoreHotelsOpen] = useState(false);
  const [hotelSearch, setHotelSearch] = useState("");
  const [hotelSort, setHotelSort] = useState<"rating" | "price_asc" | "price_desc">("rating");
  const [hotelNotes, setHotelNotes] = useState("");
  const [hotelCheckInDayId, setHotelCheckInDayId] = useState<string | null>(null);
  const [hotelCheckOutDayId, setHotelCheckOutDayId] = useState<string | null>(null);
  const [editingStayGroupId, setEditingStayGroupId] = useState<string | null>(null);
  const [editStayCheckInDayId, setEditStayCheckInDayId] = useState<string | null>(null);
  const [editStayCheckOutDayId, setEditStayCheckOutDayId] = useState<string | null>(null);
  const [creatorDraft, setCreatorDraft] = useState({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });
  const [creatorPhotos, setCreatorPhotos] = useState<DayPhoto[]>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  // "Saved" only holds while nothing has changed since the last successful PUT.
  const saved = savedSnapshot?.days === days && savedSnapshot?.title === packageTitle;
  const activeDayData = days[activeDay] ?? days[0];
  const goToIssueDay = (field?: string) => {
    const dayNumber = parseIssueDay(field);
    const index = dayNumber !== null ? days.findIndex((d) => d.day === dayNumber) : -1;
    if (index !== -1) setActiveDay(index);
  };
  // Feasibility annotation is a pure function of the day's items, so it's
  // derived here once instead of being re-applied inside every handler.
  const items = useMemo(() => annotateItems(activeDayData?.items ?? []), [activeDayData]);
  const story = activeDayData?.story ?? "";
  const photos = activeDayData?.photos ?? [];
  // Activities carry a plain city name in `address` (buildDaysFromPackage);
  // hotels sometimes carry a full street address instead, so activities are
  // the more reliable signal for "what city is this day actually in."
  const activeDayCity = pkg.destination_city ?? null;
  const tripDestination = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ");
  // Vibes/season have no backend field (see the wizard's create flow) — this
  // is a best-effort read of the sessionStorage stash written at creation,
  // so it only shows up in the browser tab that made or last edited the trip.
  // Editing here re-writes the same stash so the display updates immediately.
  const [tripVibesDraft, setTripVibesDraft] = useState(() => (
    typeof window === "undefined" ? null : parseWizardVibesDraft(window.sessionStorage.getItem(wizardVibesStorageKey(pkg.package_id)))
  ));
  const [editingTripParams, setEditingTripParams] = useState(false);
  const [tripParamsDraft, setTripParamsDraft] = useState<{ vibes: string[]; season: string | null }>({ vibes: [], season: null });
  const startEditingTripParams = () => {
    setTripParamsDraft({ vibes: tripVibesDraft?.vibes ?? [], season: tripVibesDraft?.season ?? null });
    setEditingTripParams(true);
  };
  const saveTripParams = () => {
    const next = { vibes: tripParamsDraft.vibes, season: tripParamsDraft.season };
    try {
      window.sessionStorage.setItem(wizardVibesStorageKey(pkg.package_id), JSON.stringify(next));
    } catch {
      // best-effort only
    }
    setTripVibesDraft(next);
    setEditingTripParams(false);
  };
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
    // Keep showing the last result (and let creators keep working from it)
    // while a re-check is in flight — only replace it once fresh data lands.
    setFeasLoading(true);
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
        // Timestamps a check that only ever runs from a click handler, never
        // during render — safe despite the purity lint's static analysis.
        // eslint-disable-next-line react-hooks/purity
        setLastCheckedAt(Date.now());
        setResultStale(false);
      }
    } catch (err) {
      console.error("Failed to run feasibility check:", err);
    } finally {
      setFeasLoading(false);
    }
  };

  // Mark the check result stale whenever itinerary content changes after a
  // check has been run — this blocks submission (see isReadyToSubmit) but
  // deliberately keeps the last result on screen instead of clearing it, so
  // creators can keep working from the issue list while they fix things.
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (feasResult) setResultStale(true);
    // All itinerary content (items, story, photos) lives inside `days`; the
    // derived `items` is deliberately excluded so switching day tabs doesn't
    // mark an unchanged result stale.
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
      // The destination catalog lets creators pick a country-level entry
      // (e.g. "Iceland") as well as cities, and that value ends up here as
      // activeDayCity — so match it against either column, not just city.
      if (activeDayCity) query = query.or(`city.eq.${activeDayCity},country.eq.${activeDayCity}`);
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

  // Hotels are "supplied by Travel Marketplace" per the note in the add-hotel
  // flow — the full catalog for this destination, not just whatever the AI
  // happened to attach to the package at creation time.
  useEffect(() => {
    if (addFlow !== "hotel") return;
    setMoreHotelsOpen(false);
    void (async () => {
      let query = supabase
        .from("hotels")
        .select("hotel_id,hotel_name,city,star_rating,room_type,price_per_night_aud")
        .order("star_rating", { ascending: false })
        .limit(24);
      if (activeDayCity) query = query.or(`city.eq.${activeDayCity},country.eq.${activeDayCity}`);
      const { data, error } = await query;
      setCatalogHotels(error || !data ? [] : data.map((row) => ({ ...row, address: null })));
    })();
  }, [addFlow, activeDayCity]);

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

  const trackUpload = <T,>(operation: Promise<T>): Promise<T> => {
    const tracked = operation.finally(() => {
      pendingUploads.current.delete(tracked);
      setUploadingCount(pendingUploads.current.size);
    });
    pendingUploads.current.add(tracked);
    setUploadingCount(pendingUploads.current.size);
    return tracked;
  };

  const persistDraft = async (token: string) => {
    while (pendingUploads.current.size) {
      await Promise.all([...pendingUploads.current]);
    }
    const persisted = await updatePackage(
      fetch,
      API_URL,
      token,
      pkg.package_id,
      buildPackageUpdate(packageDetail, days, packageTitle),
    );
    const persistedDays = buildDaysFromPackage(persisted);
    setPackageDetail(persisted);
    setDays(persistedDays);
    setPackageTitle(persisted.title);
    setTitleDraft(persisted.title);
    setPackageStatus(persisted.status ?? packageStatus);
    setSavedSnapshot({ days: persistedDays, title: persisted.title });
    // Timestamps a save that only ever runs from a click handler, never
    // during render — safe despite the purity lint's static analysis.
    // eslint-disable-next-line react-hooks/purity
    setLastSavedAt(Date.now());
    return persisted;
  };

  const saveDraft = async () => {
    if (saving || submitting || uploadingCount > 0 || isLocked) return;
    setSaving(true);
    try {
      const token = await accessToken();
      if (!token) {
        onSessionExpired();
        throw new Error("Your session expired. Please sign in again.");
      }
      await persistDraft(token);
      showNotice("Draft saved");
    } catch (error) {
      if (error instanceof CreatorApiError) {
        if (error.status === 401) onSessionExpired();
        if (error.status === 404 || error.status === 409) setPackageStatus("not_editable");
      }
      showNotice(typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "Unable to save this draft.");
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
        setDays((current) => {
          const associatedIds = new Set(current.flatMap((day) => [
            ...day.photos.flatMap((photo) => photo.media_id ? [photo.media_id] : []),
            ...day.items.flatMap((item) => item.photos?.flatMap((photo) => photo.media_id ? [photo.media_id] : []) ?? []),
          ]));
          const legacyMedia = media.filter((entry) => !associatedIds.has(entry.media_id));
          return current.map((day, index) => index === 0 && legacyMedia.length
            ? { ...day, photos: [...legacyMedia.map((entry) => ({ src: entry.url, alt: entry.caption || "Trip photo", media_id: entry.media_id })), ...day.photos] }
            : day);
        });
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

  const changeDayPhoto = async (photo: DayPhoto, file: File) => {
    await removeDayPhoto(photo);
    await addDayPhoto(file);
  };

  const addItemPhotos = async (files: File[]) => {
    const previews = files.map((file) => ({
      file,
      photo: { src: URL.createObjectURL(file), alt: file.name } satisfies DayPhoto,
    }));
    setEditingItem((current) => current
      ? { ...current, photos: [...current.photos, ...previews.map(({ photo }) => photo)] }
      : current);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const uploaded = await Promise.all(previews.map(async ({ file, photo }) => ({
        preview: photo.src,
        fileName: file.name,
        media: await uploadPackageMedia(fetch, API_URL, token, pkg.package_id, file),
      })));
      setEditingItem((current) => current ? {
        ...current,
        photos: current.photos.map((photo) => {
          const match = uploaded.find(({ preview }) => preview === photo.src);
          return match
            ? { src: match.media.url, alt: match.fileName, media_id: match.media.media_id }
            : photo;
        }),
      } : current);
      showNotice(`${files.length} photo${files.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      const previewUrls = new Set(previews.map(({ photo }) => photo.src));
      setEditingItem((current) => current
        ? { ...current, photos: current.photos.filter((photo) => !previewUrls.has(photo.src)) }
        : current);
      showNotice(error instanceof Error ? error.message : "Unable to upload these photos.");
    } finally {
      previews.forEach(({ photo }) => URL.revokeObjectURL(photo.src));
    }
  };

  const removeItemPhoto = (photo: DayPhoto) => {
    // Item edits are cancellable, so remove only the association here. The
    // package media itself remains available until a later cleanup policy.
    setEditingItem((current) => current
      ? { ...current, photos: current.photos.filter((entry) => entry.src !== photo.src) }
      : current);
  };

  const addCreatorPhotos = async (files: File[]) => {
    const previews = files.map((file) => ({
      file,
      photo: { src: URL.createObjectURL(file), alt: file.name } satisfies DayPhoto,
    }));
    setCreatorPhotos((current) => [...current, ...previews.map(({ photo }) => photo)]);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const uploaded = await Promise.all(previews.map(async ({ file, photo }) => ({
        preview: photo.src,
        fileName: file.name,
        media: await uploadPackageMedia(fetch, API_URL, token, pkg.package_id, file),
      })));
      setCreatorPhotos((current) => current.map((photo) => {
        const match = uploaded.find(({ preview }) => preview === photo.src);
        return match
          ? { src: match.media.url, alt: match.fileName, media_id: match.media.media_id }
          : photo;
      }));
      showNotice(`${files.length} photo${files.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      const previewUrls = new Set(previews.map(({ photo }) => photo.src));
      setCreatorPhotos((current) => current.filter((photo) => !previewUrls.has(photo.src)));
      showNotice(error instanceof Error ? error.message : "Unable to upload these photos.");
    } finally {
      previews.forEach(({ photo }) => URL.revokeObjectURL(photo.src));
    }
  };

  const removeCreatorPhoto = (photo: DayPhoto) => {
    setCreatorPhotos((current) => current.filter((entry) => entry.src !== photo.src));
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


  const addSelectedFlight = () => {
    const flight = selectedFlightIndex !== null ? matchingFlights[selectedFlightIndex] : undefined;
    if (addingAfter === null || !flight) return;
    const departureTime = flight.departure_time
      || extractClockTimeInZone(flight.departure_datetime ?? null, timezoneForIata(flight.origin_iata));
    const arrivalTime = flight.arrival_time
      || extractClockTimeInZone(flight.arrival_datetime ?? null, timezoneForIata(flight.destination_iata));
    insertItem(addingAfter, {
      time: departureTime ?? "09:00",
      type: "FLIGHT",
      title: [flight.origin_iata, flight.destination_iata].filter(Boolean).join(" to ") || flight.airline || "Flight",
      price: flight.price_aud != null ? `$${flight.price_aud.toLocaleString("en-US")}` : "$0",
      icon: "plane",
      status: "pass",
      originIata: flight.origin_iata ?? undefined,
      destinationIata: flight.destination_iata ?? undefined,
      airline: flight.airline ?? undefined,
      flightNumber: flight.flight_number ?? undefined,
      departureDatetime: flight.departure_datetime ?? undefined,
      arrivalDatetime: flight.arrival_datetime ?? undefined,
      departureTime: departureTime ?? undefined,
      arrivalTime: arrivalTime ?? undefined,
      duration: flight.duration_minutes
        ? String(flight.duration_minutes)
        : (() => {
            const minutes = flightDurationMinutes(flight.departure_datetime, flight.arrival_datetime);
            return minutes === undefined ? undefined : String(minutes);
          })(),
      cabinClass: flight.cabin_class ?? undefined,
    });
    setFlightSearch("");
    setSelectedFlightIndex(null);
  };

  const matchingFlights = flights.filter((flight) =>
    [flight.airline, flight.flight_number, flight.origin_iata, flight.destination_iata].join(" ").toLowerCase().includes(flightSearch.trim().toLowerCase()),
  );
  const selectedHotelOption = selectedHotelIndex !== null ? (catalogHotels ?? hotels)[selectedHotelIndex] : undefined;

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

  const editStayCheckInIndex = editStayCheckInDayId === NEW_DAY_OPTION_ID
    ? days.length
    : Math.max(0, days.findIndex((day) => day.id === editStayCheckInDayId));
  const editStayCheckOutDayOptions = [
    ...days
      .map((day, index) => ({ id: day.id, index, title: day.title }))
      .filter((option) => option.index > editStayCheckInIndex),
    { id: NEW_DAY_OPTION_ID, index: Math.max(days.length, editStayCheckInIndex + 1), title: "New day" },
  ];
  const selectedEditStayCheckOutDayOption = editStayCheckOutDayOptions.find((option) => option.id === editStayCheckOutDayId) ?? editStayCheckOutDayOptions[0];

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
        next.push({ id: `day-${Date.now()}-${dayNumber}`, day: dayNumber, title: "Untitled day", meta: "Add your first stop", items: [], story: "", photos: [], date: nextCalendarDate(next[next.length - 1]?.date) });
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
          hotelName: selectedHotelOption.hotel_name ?? undefined,
          city: selectedHotelOption.city ?? undefined,
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

  // Moves an existing hotel stay to a different Day range: removes every item
  // sharing stayGroupId, then re-spreads fresh check-in/overnight/check-out
  // items across the new days (extending `days` if the new range runs past
  // the end) — same shape as createHotel's spread, but for an edit in place.
  const updateHotelStayDays = (stayGroupId: string, checkInDayId: string, checkOutDayId: string) => {
    const checkInIndex = checkInDayId === NEW_DAY_OPTION_ID ? days.length : Math.max(0, days.findIndex((d) => d.id === checkInDayId));
    const checkOutIndexRaw = checkOutDayId === NEW_DAY_OPTION_ID ? Math.max(days.length, checkInIndex + 1) : days.findIndex((d) => d.id === checkOutDayId);
    const checkOutIndex = Math.max(checkInIndex + 1, checkOutIndexRaw);
    const nights = checkOutIndex - checkInIndex;
    const template = days.flatMap((day) => day.items).find((it) => it.stayGroupId === stayGroupId);
    if (!template) return;
    const hotelName = template.hotelName ?? "Hotel";
    setDays((current) => {
      let next = current.map((day) => ({ ...day, items: day.items.filter((it) => it.stayGroupId !== stayGroupId) }));
      while (next.length <= checkOutIndex) {
        const dayNumber = next.length + 1;
        next.push({ id: `day-${Date.now()}-${dayNumber}`, day: dayNumber, title: "Untitled day", meta: "Add your first stop", items: [], story: "", photos: [], date: nextCalendarDate(next[next.length - 1]?.date) });
      }
      for (let offset = 0; offset <= nights; offset += 1) {
        const isCheckOutDay = offset === nights;
        nextItemId.current += 1;
        const newItem: TimelineItem = {
          ...template,
          id: nextItemId.current,
          time: offset === 0 ? "Check-in" : isCheckOutDay ? "Check-out" : "Overnight stay",
          title: isCheckOutDay
            ? `${hotelName} (Check-out)`
            : nights > 1 ? `${hotelName} (Night ${offset + 1} of ${nights})` : hotelName,
          stayMarker: offset === 0 ? "check-in" : isCheckOutDay ? "check-out" : undefined,
        };
        const dayIndex = checkInIndex + offset;
        next[dayIndex] = { ...next[dayIndex], items: [...next[dayIndex].items, newItem] };
      }
      return next;
    });
    setEditingStayGroupId(null);
    setExpandedHotelId(null);
    setActiveDay(checkInIndex);
    showNotice(`${hotelName} moved to ${nights > 1 ? `${nights} nights` : "1 night"} from Day ${checkInIndex + 1}`);
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
      category: creatorDraft.category,
      address: creatorDraft.address.trim() || undefined,
      duration: creatorDraft.duration,
      notes: creatorDraft.reason.trim() || undefined,
      photos: creatorPhotos,
    });
    setCreatorDraft({ title: "", category: "Activity", address: "", time: "12:00", duration: "60", price: "", reason: "" });
    setCreatorPhotos([]);
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

  const isReadyToSubmit = Boolean(
    feasResult &&
    !resultStale &&
    (displayScore ?? 0) >= 70 &&
    hardErrors.length === 0 &&
    feasResult.is_feasible
  );
  const scorePassing = Boolean(feasResult) && !resultStale && (displayScore ?? 0) >= 70;

  // The static checklist below always lists 4 criteria; they're treated as
  // satisfied whenever there are no critical issues, mirroring the pass/fail
  // logic the submit button itself relies on (isReadyToSubmit's hardErrors check).
  const passedCount = feasResult ? (hardErrors.length === 0 ? 4 : 0) : undefined;

  const submissionButtonLabel = isLocked
    ? STATUS_LABELS[packageStatus] ?? packageStatus
    : uploadingCount > 0
      ? `Uploading ${uploadingCount}…`
    : submitting
      ? "Continuing…"
      : !isReadyToSubmit
        // A stale result can't be trusted to say whether issues remain, so
        // it falls back to "Check content to continue" like the unchecked case.
        ? (feasResult && !resultStale && !feasResult.is_feasible ? "Fix issues to continue" : "Check content to continue")
        : "Continue to review";

  // Saves the draft, then hands off to the review page where the actual
  // submit-for-review call happens — this never submits by itself.
  const handleSubmit = async () => {
    if (feasLoading || saving || uploadingCount > 0 || submittingRef.current || isLocked) return;
    setPreviewOpen(false);
    if (!isReadyToSubmit) {
      // Never checked, or checked against content that's since changed:
      // run the check itself instead of just telling the creator to go
      // click "Check content" — one less step for the common case.
      if (!feasResult || resultStale) {
        void runFeasibilityCheck();
        return;
      }
      showNotice((displayScore ?? 0) < 70
        ? `Your trip score is ${displayScore ?? 0}/100. A minimum score of 70 is required to continue. Improve your itinerary and check content again.`
        : "Fix critical feasibility issues and check content again before continuing.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const token = await accessToken();
      if (!token) {
        onSessionExpired();
        throw new Error("Your session expired. Please sign in again.");
      }
      await persistDraft(token);
      setEditingTitle(false);
      setEditingDayField(null);
      setEditingItem(null);
      setAddingAfter(null);
      // Flights/hotels/activities added this session aren't saved by PUT yet
      // (see saveDraft above) — snapshot them so the review page shows exactly
      // what was just approved here, not a stale server-side fetch.
      try {
        window.sessionStorage.setItem(itinerarySnapshotStorageKey(pkg.package_id), JSON.stringify({ title: packageTitle, days }));
      } catch {
        // best-effort only
      }
      onContinueToReview();
    } catch (error) {
      if (error instanceof CreatorApiError) {
        if (error.status === 401) onSessionExpired();
        if (error.status === 404 || error.status === 409) setPackageStatus("not_editable");
      }
      // A failed save doesn't continue to review — the draft may not
      // reflect what the review page would show, so this can just be retried.
      showNotice(typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "Unable to continue to review.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
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
    availableHotels: catalogHotels ?? hotels,
    selectedHotelIndex, setSelectedHotelIndex,
    moreHotelsOpen, setMoreHotelsOpen,
    selectedHotelOption,
    hotelCheckInDayId, setHotelCheckInDayId,
    setHotelCheckOutDayId,
    days,
    hotelCheckOutDayOptions,
    selectedHotelCheckOutDayOption,
    hotelNotes, setHotelNotes,
    createHotel,
    creatorDraft, setCreatorDraft,
    creatorPhotos, setCreatorPhotos,
    addCreatorPhotos,
    removeCreatorPhoto,
    trackUpload,
    toSafeImageSrc,
    createCreatorPick,
    activitySearch, setActivitySearch,
    recommendedActivities,
    addRecommendedActivity,
    moreActivitiesOpen,
    setMoreActivitiesOpen,
    activeDayData,
    activeDayCity,
    openAddFlow,
  };

  return (
    <main className="itinerary-editor">
      <header className="editor-topbar">
        <button
          type="button"
          className="text-action back-action"
          aria-label="Back to dashboard"
          title="Back to dashboard"
          onClick={() => { if (saved) router.push(APP_ROUTES.dashboard); else setPendingLeaveConfirm(true); }}
        ><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
        <div className="editor-title-block">
          <span className="editor-kicker">AI itinerary editor</span>
          {editingTitle ? <input className="package-title-input" value={titleDraft} autoFocus maxLength={200} aria-label="Package title" onChange={(event) => setTitleDraft(event.target.value)} onBlur={savePackageTitle} onKeyDown={(event) => { if (event.key === "Enter") savePackageTitle(); if (event.key === "Escape") { setTitleDraft(packageTitle); setEditingTitle(false); } }} /> : <button className="package-title-button" disabled={isLocked} onClick={() => { setTitleDraft(packageTitle); setEditingTitle(true); }} aria-label={`Edit package title, currently ${packageTitle}`} title="Edit package title"><h1>{packageTitle}</h1></button>}
        </div>
        <div className="editor-actions">
          <button className="quiet-button" disabled={saving || submitting || uploadingCount > 0 || isLocked} onClick={() => { void saveDraft(); }}>{uploadingCount > 0 ? `Uploading ${uploadingCount}…` : saving ? "Saving…" : saved ? "Saved" : "Save Draft"}</button>
          <button className="quiet-button" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button className="publish-button" disabled={feasLoading || saving || uploadingCount > 0 || submitting || isLocked} onClick={() => { void handleSubmit(); }}>
            {submissionButtonLabel}
          </button>
        </div>
      </header>

      {isLocked && <div className="locked-status-banner" role="status">
        This package is {(STATUS_LABELS[packageStatus] ?? packageStatus).toLowerCase()} and can no longer be edited here.
      </div>}

      <nav className="day-strip" aria-label="Itinerary days">
        <button type="button" className="day-scroll-btn" disabled={!dayScroll.canLeft} onClick={() => scrollDayTabs(-1)} aria-label="Scroll days left"><Icon name="chevron" size={18} /></button>
        <div className="day-tabs" ref={dayTabsRef}>
          {days.map((day, index) => <div key={day.day} className={`day-tab-wrap ${activeDay === index ? "active" : ""}`}>
            <button aria-current={activeDay === index ? "page" : undefined} className={`day-tab ${activeDay === index ? "active" : ""}`} onClick={() => setActiveDay(index)}><span>DAY {day.day} <b>{day.items.length}</b></span><strong>{day.title}</strong><span className="day-tab-types">{dayItemTypeCounts(day).map((entry) => <span key={entry.key} className="day-tab-type-badge" aria-label={`${entry.count} ${entry.label}`}><Icon name={entry.icon} size={13} />{entry.count}</span>)}</span></button>
            <button className="delete-day-tab" disabled={days.length === 1 || isLocked} onClick={() => setPendingDeleteDay(index)} aria-label={`Delete Day ${day.day}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </div>)}
          <button className="add-day" disabled={isLocked || days.length >= MAX_TRIP_DAYS} title={days.length >= MAX_TRIP_DAYS ? `Trips can have up to ${MAX_TRIP_DAYS} days` : undefined} onClick={() => { const nextDay = days.length + 1; setDays([...days, { id: `day-${Date.now()}`, day: nextDay, title: "Untitled day", meta: "Add your first stop", items: [], story: "", photos: [], date: nextCalendarDate(days[days.length - 1]?.date) }]); setActiveDay(days.length); showNotice("A new day was added"); }}><Icon name="plus" size={24} /><span>Add Day</span></button>
        </div>
        <button type="button" className="day-scroll-btn" disabled={!dayScroll.canRight} onClick={() => scrollDayTabs(1)} aria-label="Scroll days right"><Icon name="chevron" size={18} /></button>
      </nav>

      <fieldset className="editor-shell" disabled={isLocked} aria-label={isLocked ? "Read-only itinerary" : "Itinerary editor"}>
        <div className="editor-main">
          <div className="day-heading"><div>
            <span>Day {activeDay + 1}</span>
            {editingDayField === "title"
              ? <input className="package-title-input" value={dayDraft} autoFocus maxLength={200} aria-label="Day title" onChange={(event) => setDayDraft(event.target.value)} onBlur={saveDayField} onKeyDown={(event) => { if (event.key === "Enter") saveDayField(); if (event.key === "Escape") setEditingDayField(null); }} />
              : <button className="package-title-button" onClick={() => startEditingDayField("title")} aria-label={`Edit day title, currently ${activeDayData?.title ?? "Untitled day"}`} title="Edit day title"><h2>{activeDayData?.title || "Untitled day"}</h2></button>}
          </div></div>

          <div className="day-panel-row day-panel">
            <section className="story-section day-panel-col">
              <div className="day-photo-single">
                {photos.map((photo) => <figure key={photo.src}>
                  <img src={toSafeImageSrc(photo.src)} alt={photo.alt} />
                  <label className="change-photo-btn" aria-label={`Change ${photo.alt}`}>
                    <input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void trackUpload(changeDayPhoto(photo, file)); }} />
                    Change photo
                  </label>
                </figure>)}
                {photos.length < MAX_DAY_PHOTOS && <label className="photo-add"><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void trackUpload(addDayPhoto(file)); }} /><span className="photo-add-icon"><Icon name="plus" size={18} /></span><span className="photo-add-label">Add photo</span><small>JPG or PNG</small></label>}
              </div>
            </section>

            <section className="story-copy day-panel-col">
              <div className="day-panel-header">
                <div className="day-panel-heading">
                  <h3>Day summary</h3>
                  <span className="field-hint">
                    <button type="button" className="field-hint-trigger" aria-label="What to write in the day summary">?</button>
                    <span className="field-hint-tooltip" role="tooltip">Describe the schedule, local ambiance, and practical traveller tips for this day. Upload a photo representing this day&apos;s itinerary; it&apos;s shown as the cover image wherever travellers browse the itinerary.</span>
                  </span>
                </div>
                <button className="ai-button" disabled={isGeneratingStory} aria-label="Generate story with AI" onClick={() => { void generateContent(); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></svg> {isGeneratingStory ? "Generating story…" : "AI write for me"}</button>
              </div>
              <textarea value={story} onChange={(event) => setStory(event.target.value)} placeholder="Share your insider tips and personal recommendations…" aria-label="Your story" />
              <div className="story-copy-footer">
                <span className="story-copy-stats">
                  {story.length} characters · {story.trim() ? story.trim().split(/\s+/).length : 0} words
                  {saved && lastSavedAt && <span className="story-copy-saved">Draft saved {formatRelativeTime(lastSavedAt)}</span>}
                </span>
              </div>
            </section>
          </div>

          <section className="timeline-section">
            <h3>Timeline</h3>
            <div className={`timeline-list${items.length === 0 ? " is-empty" : ""}`}>
              {items.map((item, index) => {
                const flightIndex = items.slice(0, index).filter(({ type }) => type === "FLIGHT").length;
                const flight = item.type === "FLIGHT" ? flights[flightIndex] : undefined;
                const referenceFlight = item.type === "FLIGHT" ? referenceFlightPresentation(item) : null;
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
                const stayDays = item.stayGroupId
                  ? days.map((d, i) => ({ id: d.id, index: i, title: d.title })).filter((d) => days[d.index].items.some((it) => it.stayGroupId === item.stayGroupId))
                  : [];
                const stayCheckInDayId = stayDays[0]?.id ?? null;
                const stayCheckOutDayId = stayDays[stayDays.length - 1]?.id ?? null;
                const stayNightsFromDays = stayDays.length > 0 ? stayDays.length - 1 : null;
                const stayRangeLabel = stayDays.length > 0
                  ? `${stayNightsFromDays} night${stayNightsFromDays === 1 ? "" : "s"} · Day ${stayDays[0].index + 1} – Day ${stayDays[stayDays.length - 1].index + 1}`
                  : nights ? `${nights} night${nights === 1 ? "" : "s"}` : "Not provided";
                const isEditingStay = Boolean(item.stayGroupId) && editingStayGroupId === item.stayGroupId;
                const startEditingStay = () => {
                  setEditingStayGroupId(item.stayGroupId!);
                  setEditStayCheckInDayId(stayCheckInDayId);
                  setEditStayCheckOutDayId(stayCheckOutDayId);
                };
                const stayRow = <div className={isEditingStay ? "full" : undefined}>
                  <dt>Stay</dt>
                  {isEditingStay ? <dd>
                    <div className="stay-edit-form">
                      <div className="stay-edit-fields">
                        <label><span>Check-in day</span>
                          <SelectField
                            value={editStayCheckInDayId ?? ""}
                            onChange={setEditStayCheckInDayId}
                            ariaLabel="Check-in day"
                            options={[
                              ...days.map((day, i) => ({ value: day.id, label: `Day ${i + 1}: ${day.title}` })),
                              { value: NEW_DAY_OPTION_ID, label: `Day ${days.length + 1} (new day)` },
                            ]}
                          />
                        </label>
                        <label><span>Checkout day</span>
                          <SelectField
                            value={selectedEditStayCheckOutDayOption?.id ?? ""}
                            onChange={setEditStayCheckOutDayId}
                            ariaLabel="Checkout day"
                            options={editStayCheckOutDayOptions.map((option) => ({
                              value: option.id,
                              label: option.id === NEW_DAY_OPTION_ID ? `Day ${option.index + 1} (new day)` : `Day ${option.index + 1}: ${option.title}`,
                            }))}
                          />
                        </label>
                      </div>
                      <div className="stay-edit-actions">
                        <button type="button" className="stay-edit-cancel" onClick={() => setEditingStayGroupId(null)}>Cancel</button>
                        <button type="button" className="stay-edit-save" disabled={!editStayCheckInDayId || !selectedEditStayCheckOutDayOption} onClick={() => updateHotelStayDays(item.stayGroupId!, editStayCheckInDayId!, selectedEditStayCheckOutDayOption.id)}>Save</button>
                      </div>
                    </div>
                  </dd> : <dd className="stat-with-action">
                    <span>{stayRangeLabel}</span>
                    {isStayHead && item.stayGroupId && <button type="button" className="stat-edit-btn" aria-label="Edit stay dates" onClick={startEditingStay}><Icon name="pencil" size={13} /></button>}
                  </dd>}
                </div>;
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
                const displayedPrice = referenceFlight?.price ?? itemPrice;
                const isPriceValue = displayedPrice.startsWith("$");
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
                  <div className="item-time">
                    <div className="item-time-row"><Icon name={item.icon} /><strong className={isTimeValue ? undefined : "item-time-word"}>{item.time}</strong></div>
                    {isTimeValue && item.type === "FLIGHT" && item.arrivalTime && <span className="item-time-end">to {item.arrivalTime}</span>}
                    {isTimeValue && item.type !== "FLIGHT" && item.duration && <span className="item-time-end">to {getEndTime(item.time, item.duration)}</span>}
                  </div>
                  <div className="item-copy">
                    <div className="item-copy-head">
                      <span className={`item-type-pill${item.type === "FLIGHT" ? " item-type-pill-flight" : item.type === "HOTEL" ? " item-type-pill-hotel" : ""}`}>{referenceFlight?.label ?? item.type}</span>
                      {!referenceFlight && item.duration && <span className="item-copy-meta-item"><Icon name="clock" size={12} />{item.duration} min</span>}
                      {!referenceFlight && item.address && <span className="item-copy-meta-item"><Icon name="pin" size={12} />{item.address}</span>}
                      {stayMarkerLabel && <span className="stay-marker">{stayMarkerLabel}</span>}
                    </div>
                    <h4>{referenceFlight?.title ?? hotelTitle}</h4>
                    {referenceFlight?.schedule && <p className="reference-flight-schedule">{referenceFlight.schedule}</p>}
                    {scheduleConflict ? <div className="item-alert"><Icon name="alert" size={15} /><div><strong>Scheduling conflict</strong><span>{scheduleConflict}</span></div></div> : item.problem && <div className="item-alert"><Icon name="alert" size={15} /><div><strong>{item.problem}</strong><span>{item.problemDetail}</span></div></div>}
                  </div>
                  <div className="item-price"><span>{referenceFlight?.priceLabel ?? "Estimated"}</span><strong className={isPriceValue ? undefined : "item-price-word"}>{withWrapBeforeSlash(displayedPrice)}</strong></div>
                  <div className="item-actions">
                    {canExpand && <button type="button" className="item-action-icon" aria-label={`Edit ${hotelTitle}`} onClick={toggleExpand}><Icon name="pencil" size={15} /></button>}
                    <button type="button" className="item-action-icon item-action-icon-delete" aria-label={`Delete ${hotelTitle}`} onClick={() => requestDeleteItem(item)}><Icon name="trash" size={15} /></button>
                  </div>
                </article>
                {flight && expandedFlightId === item.id && <section id={`flight-details-${item.id}`} className="timeline-detail-panel" aria-label={`${flight.airline ?? "Flight"} reference flight details`}>
                  <div className="detail-card">
                    <div className="detail-card-top">
                      <div className="detail-card-heading">
                        <span className="detail-card-badge detail-card-badge-flight"><Icon name="plane" size={14} />Reference flight</span>
                        <div className="detail-card-title-row">
                          <h3>{flight.airline || "Flight"}</h3>
                          <p className="detail-card-subtitle"><Icon name="plane" size={14} />{flight.origin_iata || "Not provided"} to {flight.destination_iata || "Not provided"}</p>
                        </div>
                        <p className="reference-flight-guidance">{REFERENCE_FLIGHT_GUIDANCE}</p>
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
                        {stayRow}
                        <div><dt>Rating</dt><dd className="rating-value">{hotel.star_rating ? <><Icon name="star" size={14} />{hotel.star_rating} / 5</> : "Not provided"}</dd></div>
                        <div><dt>Per night</dt><dd>{hotel.price_per_night_aud === null ? "Not provided" : `$${hotel.price_per_night_aud.toLocaleString("en-AU")} AUD`}</dd></div>
                      </> : <>
                        <div><dt>Room type</dt><dd>{item.roomType || "Not provided"}</dd></div>
                        <div><dt>Check-in</dt><dd>{STANDARD_HOTEL_CHECKIN_TIME}</dd></div>
                        <div><dt>Check-out</dt><dd>{STANDARD_HOTEL_CHECKOUT_TIME}</dd></div>
                        {stayRow}
                        <div><dt>Rating</dt><dd className="rating-value">{item.starRating ? <><Icon name="star" size={14} />{item.starRating} / 5</> : "Not provided"}</dd></div>
                        {item.notes && <div className="full"><dt>Notes</dt><dd>{item.notes}</dd></div>}
                      </>}
                    </dl>
                  </div>
                </section>}
                {editingItem?.id === item.id && <section className={`inline-edit${isFixedActivity ? " inline-edit-compact" : ""}`} aria-label={`${isFixedActivity ? "View" : "Edit"} ${item.title}`}>
                  {isFixedActivity ? <>
                    <div className="detail-card">
                      <div className="detail-card-top">
                        <div className="detail-card-heading">
                          <div className="detail-card-title-row detail-card-title-row-inline">
                            <span className="detail-card-badge"><Icon name="star" size={14} />{editingItem.category}</span>
                            <h3>{editingItem.title}</h3>
                            <p className="detail-card-subtitle"><Icon name="pin" size={14} />{editingItem.address || "Address not provided"}</p>
                          </div>
                        </div>
                      </div>
                      <div className="activity-card-stats">
                        <div className="activity-card-stat">
                          <small>Start time</small>
                          <span className="activity-card-stat-value"><Icon name="clock" size={16} /><TimeField className="activity-card-time-field" value={editingItem.time} onChange={(time) => setEditingItem({ ...editingItem, time })} ariaLabel="Start time" /></span>
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
                      <label><span>Start time</span><TimeField value={editingItem.time} onChange={(time) => setEditingItem({ ...editingItem, time })} ariaLabel="Start time" /></label>
                      <label><span>Duration (min)</span><SelectField value={editingItem.duration} onChange={(duration) => setEditingItem({ ...editingItem, duration })} options={DURATION_OPTIONS} ariaLabel="Duration (min)" /></label>
                      <label><span>Ends at</span><input value={getEndTime(editingItem.time, editingItem.duration)} readOnly /></label>
                      <label className="edit-notes"><span>Notes</span><textarea value={editingItem.notes} onChange={(event) => setEditingItem({ ...editingItem, notes: event.target.value })} placeholder="Share why this is worth a stop" /></label>
                    </div>
                  </>}
                  <div className="edit-photo">
                    <div className="edit-photo-head"><span>Photos</span><small>Optional &middot; {editingItem.photos.length} / {MAX_ITEM_PHOTOS}</small></div>
                    <div>
                      {editingItem.photos.map((photo, index) => <figure key={photo.src}>
                        <img src={toSafeImageSrc(photo.src)} alt={photo.alt || (index === 0 ? "Activity cover" : "Activity photo")} />
                        {index === 0
                          ? <b><Icon name="star" size={10} />Cover</b>
                          : <button type="button" className="set-cover-btn" onClick={() => setEditingItem({ ...editingItem, photos: [photo, ...editingItem.photos.filter((_, i) => i !== index)] })}>Set as cover</button>}
                        <button type="button" className="remove-photo-btn" aria-label="Remove photo" onClick={() => removeItemPhoto(photo)}><Icon name="plus" size={10} /></button>
                      </figure>)}
                      {editingItem.photos.length < MAX_ITEM_PHOTOS && <label><input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []).slice(0, MAX_ITEM_PHOTOS - editingItem.photos.length); event.target.value = ""; if (files.length) void trackUpload(addItemPhotos(files)); }} /><span className="edit-photo-add-icon"><Icon name="plus" size={16} /></span><span className="edit-photo-add-label">Add photo</span></label>}
                    </div>
                  </div>
                  <div className="inline-edit-actions"><button className="quiet-button" onClick={() => setEditingItem(null)}>Cancel</button><button className="publish-button" disabled={!editingItem.title.trim()} onClick={saveEditedItem}>Save changes</button></div>
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
          <button className="copilot-mobile-trigger" type="button" onClick={() => setCopilotOpen(true)} aria-label="Open Itinerary Co-Pilot">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></svg>
            <span>Ask Co-Pilot</span>
          </button>
          <section className="editor-panel status-panel" aria-label="Feasibility check">
            <div className="feas-head">
              <div className="feas-head-top">
                <div className="feas-head-title">
                  <h2>Feasibility check</h2>
                </div>
                <button type="button" className="feas-recheck-button" onClick={runFeasibilityCheck} disabled={feasLoading}>
                  {feasLoading ? <span className="button-spinner" aria-hidden="true" /> : <Icon name="refresh" size={12} />}
                  {feasLoading ? "Checking…" : feasResult ? "Re-check" : "Check content"}
                </button>
              </div>
            </div>
            <div className="feas-body">
              <div className="feas-score-section">
                <div className="feas-score-topline">
                  <span className="feas-score-caption-group">
                    <span className="feas-score-caption">Score</span>
                    <span className="field-hint">
                      <button type="button" className="field-hint-trigger" aria-label="About the score">?</button>
                      <span className="field-hint-tooltip" role="tooltip">This score shows how ready your package is to publish. It checks things like pricing, scheduling, and required details across the whole itinerary. You need at least 70 to submit.</span>
                    </span>
                  </span>
                  <span className="feas-score-threshold-label">Minimum score: 70</span>
                </div>
                <div className={`feas-score-display${!feasResult || resultStale ? " feas-score-display-stale" : scorePassing ? " feas-score-display-pass" : ""}`}>
                  <strong>{displayScore !== undefined ? displayScore : "—"}</strong><span>/100</span>
                </div>
                <div className={`score-track${resultStale ? " score-track-stale" : scorePassing ? " score-track-pass" : ""}`} role="meter" aria-label={displayScore !== undefined ? `Package quality score, ${displayScore} out of 100${resultStale ? " (stale — content changed since this was calculated)" : ""}. Minimum score to submit is 70.` : "Package quality score not yet checked. Minimum score to submit is 70."} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayScore ?? 0}>
                  <span className="score-fill" style={{ width: displayScore !== undefined ? `${Math.min(100, Math.max(0, displayScore))}%` : "0%" }} />
                  <i aria-hidden="true" />
                </div>
              </div>
              <div className="feas-stat-row">
                <button type="button" className={`feas-stat feas-stat-critical${expandedFeasibility === "critical" ? " expanded" : ""}`} disabled={!feasResult} aria-expanded={expandedFeasibility === "critical"} onClick={() => setExpandedFeasibility(expandedFeasibility === "critical" ? null : "critical")}>
                  <span className="feas-stat-label"><span className="feas-stat-dot" />Critical</span>
                  <strong>{feasResult ? hardErrors.length : "—"}</strong>
                </button>
                <button type="button" className={`feas-stat feas-stat-warning${expandedFeasibility === "suggestions" ? " expanded" : ""}`} disabled={!feasResult} aria-expanded={expandedFeasibility === "suggestions"} onClick={() => setExpandedFeasibility(expandedFeasibility === "suggestions" ? null : "suggestions")}>
                  <span className="feas-stat-label"><span className="feas-stat-dot" />Suggest</span>
                  <strong>{feasResult ? softWarnings.length : "—"}</strong>
                </button>
                <button type="button" className={`feas-stat feas-stat-pass${expandedFeasibility === "passed" ? " expanded" : ""}`} disabled={!feasResult} aria-expanded={expandedFeasibility === "passed"} onClick={() => setExpandedFeasibility(expandedFeasibility === "passed" ? null : "passed")}>
                  <span className="feas-stat-label"><span className="feas-stat-dot" />Passed</span>
                  <strong>{feasResult ? passedCount : "—"}</strong>
                </button>
              </div>
            </div>
            {expandedFeasibility === "critical" && <div className="status-details">
              {hardErrors.map((err, idx) => {
                const dayNumber = parseIssueDay(err.field);
                return (
                  <article key={idx} className="issue-card issue-card-critical">
                    <p className="issue-card-title"><span className="issue-card-dot" />{err.affected_item}</p>
                    <p className="issue-card-message">{err.message}</p>
                    {dayNumber !== null && <button type="button" className="issue-card-goto" onClick={() => goToIssueDay(err.field)}>Go to Day {dayNumber}<Icon name="chevron" size={13} /></button>}
                  </article>
                );
              })}
              {hardErrors.length === 0 && <p style={{ padding: "8px", fontSize: "0.85rem" }}>No critical issues detected.</p>}
            </div>}
            {expandedFeasibility === "suggestions" && <div className="status-details">
              {softWarnings.map((warn, idx) => {
                const dayNumber = parseIssueDay(warn.field);
                return (
                  <article key={idx} className="issue-card issue-card-warning">
                    <p className="issue-card-title"><span className="issue-card-dot" />{warn.affected_item}</p>
                    <p className="issue-card-message">{warn.message}</p>
                    {dayNumber !== null && <button type="button" className="issue-card-goto" onClick={() => goToIssueDay(warn.field)}>Go to Day {dayNumber}<Icon name="chevron" size={13} /></button>}
                  </article>
                );
              })}
              {softWarnings.length === 0 && <p style={{ padding: "8px", fontSize: "0.85rem" }}>No suggestions.</p>}
            </div>}
            {expandedFeasibility === "passed" && <ul className="passed-details"><li><Icon name="check" size={15} />Daily schedule has a clear start and end</li><li><Icon name="check" size={15} />All stops have pricing</li><li><Icon name="check" size={15} />Accommodation is included</li><li><Icon name="check" size={15} />Required package photos are uploaded</li></ul>}
            <p className="quality-footer">Last update: {feasResult && lastCheckedAt ? formatRelativeTime(lastCheckedAt) : "Not yet checked"}</p>
          </section>
          <Panel title="Trip details" className="trip-params-panel">
            <div className="trip-params-rows">
              <div className="trip-params-row">
                <span className="trip-params-row-label">Destination</span>
                <strong>{tripDestination || "Not set"}</strong>
              </div>
              <div className="trip-params-row">
                <span className="trip-params-row-label">Duration</span>
                <strong>{days.length} day{days.length === 1 ? "" : "s"} ({Math.max(0, days.length - 1)} night{Math.max(0, days.length - 1) === 1 ? "" : "s"})</strong>
              </div>
              <div className="trip-params-row">
                <span className="trip-params-row-label">Target season</span>
                {editingTripParams
                  ? <SelectField
                      value={tripParamsDraft.season ?? ""}
                      onChange={(season) => setTripParamsDraft((current) => ({ ...current, season }))}
                      options={TRIP_SEASON_OPTIONS.map((season) => ({ value: season, label: season.charAt(0).toUpperCase() + season.slice(1) }))}
                      ariaLabel="Target season"
                      placeholder="Not set"
                    />
                  : <strong>{tripVibesDraft?.season ? tripVibesDraft.season.charAt(0).toUpperCase() + tripVibesDraft.season.slice(1) : "Not set"}</strong>}
              </div>
              {!editingTripParams && (
                <div className="trip-params-row">
                  <span className="trip-params-row-label">Itinerary vibe</span>
                  <strong>{tripVibesDraft?.vibes.length ? tripVibesDraft.vibes.join(" · ") : "Not set"}</strong>
                </div>
              )}
            </div>
            {editingTripParams && (
              <div className="edit-categories trip-params-vibe-edit">
                <span>Itinerary vibe (up to {MAX_TRIP_VIBES})</span>
                <div>
                  {TRIP_VIBE_OPTIONS.map((vibe) => {
                    const selected = tripParamsDraft.vibes.includes(vibe);
                    return (
                      <button
                        key={vibe}
                        type="button"
                        className={selected ? "selected" : ""}
                        disabled={!selected && tripParamsDraft.vibes.length >= MAX_TRIP_VIBES}
                        onClick={() => setTripParamsDraft((current) => ({
                          ...current,
                          vibes: selected ? current.vibes.filter((v) => v !== vibe) : [...current.vibes, vibe],
                        }))}
                      >{vibe}</button>
                    );
                  })}
                </div>
              </div>
            )}
            {editingTripParams
              ? <div className="trip-params-actions">
                  <button type="button" className="quiet-button" onClick={() => setEditingTripParams(false)}>Cancel</button>
                  <button type="button" className="publish-button" onClick={saveTripParams}>Save</button>
                </div>
              : <button type="button" className="trip-params-edit-button" disabled={isLocked} onClick={startEditingTripParams}><Icon name="pencil" size={14} />Edit trip details</button>}
          </Panel>
          <CopilotPanel
            client={copilotClient}
            // The active day's own city, not the package's overall
            // destination — a Tokyo→Paris trip's day 5 is in Paris, and a
            // cityless prompt on that day should mean Paris, not Tokyo.
            city={activeDayCity ?? pkg.destination_city ?? ""}
            mobileOpen={copilotOpen}
            onClose={() => setCopilotOpen(false)}
            dayLabel={`Day ${activeDay + 1}`}
            onAddSuggestion={addCopilotSuggestion}
          />
          <Panel title="Route map" className="route-panel"><RouteMap stops={routeStops} /></Panel>
          <Panel
            title="Pricing & earnings"
            className="pricing-panel"
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--fc-success)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>}
          >
            <div className="pricing-columns">
              <div><span>Package total</span><strong>${packagePrice.toLocaleString()}</strong></div>
              <div><span>Your 20% cut</span><strong className="commission">${Math.round(packagePrice * .2).toLocaleString()}</strong></div>
            </div>
          </Panel>
        </aside>
      </fieldset>
      {notice && <div className="editor-toast" role="status">{notice}</div>}
      {pendingLeaveConfirm && <div className="delete-day-backdrop" role="presentation" onMouseDown={() => setPendingLeaveConfirm(false)}>
        <section className="delete-day-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title" aria-describedby="leave-confirm-description" onMouseDown={(event) => event.stopPropagation()}>
          <h2 id="leave-confirm-title">Leave without saving?</h2>
          <p id="leave-confirm-description">Changes you made since the last save will be lost.</p>
          <div className="delete-day-actions">
            <button className="quiet-button" autoFocus onClick={() => setPendingLeaveConfirm(false)}>Cancel</button>
            <button className="confirm-delete-button" onClick={() => { setPendingLeaveConfirm(false); router.push(APP_ROUTES.dashboard); }}>Leave</button>
          </div>
        </section>
      </div>}
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
      {previewOpen && <div className="preview-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={(event) => event.stopPropagation()}><button className="preview-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button><span>Traveller preview</span><h2 id="preview-title">{packageTitle}</h2><p>{story || "Your itinerary story will appear here. Add a personal introduction before submitting."}</p><div><strong>{days.length} days / 2 nights</strong><strong>${packagePrice.toLocaleString()}</strong></div><button className="publish-button" disabled={feasLoading || saving || uploadingCount > 0 || submitting || isLocked} onClick={() => { void handleSubmit(); }}>{submissionButtonLabel}</button></section></div>}
    </main>
  );
}
