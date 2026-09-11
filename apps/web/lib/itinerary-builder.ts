export type IconName =
  | "plane"
  | "star"
  | "hotel"
  | "plus"
  | "alert"
  | "check"
  | "clock"
  | "chevron"
  | "pin";

export type TimelineItem = {
  id: number;
  time: string;
  type: string;
  title: string;
  price: string;
  icon: IconName;
  problem?: string;
  problemDetail?: string;
  status: "critical" | "pass";
  category?: string;
  address?: string;
  duration?: string;
  /** Short factual line under the title (e.g. a flight's airline + duration). */
  subtitle?: string;
  notes?: string;
  photos?: string[];
  checkIn?: string;
  checkOut?: string;
  roomType?: string;
  starRating?: number;
  stayMarker?: "check-in" | "check-out";
  stayGroupId?: string;
  /** Inventory ID from the Co-Pilot suggestion this item was added from. */
  sourceId?: string;
};

export type BuilderDay = {
  id: string;
  day: number;
  title: string;
  meta: string;
  items: TimelineItem[];
  story: string;
  photos: DayPhoto[];
};

/** `media_id` is absent while an optimistic blob preview is still uploading. */
export type DayPhoto = { src: string; alt: string; media_id?: string };

/**
 * A multi-night stay renders one row per night *plus* a check-out row, and
 * every row carries the same per-night price — so the check-out row would
 * bill an extra night it never covers.
 */
export function computePackagePrice(days: BuilderDay[]): number {
  return days
    .flatMap((day) => day.items)
    .filter((item) => item.stayMarker !== "check-out")
    .reduce((sum, item) => sum + (Number(item.price.replace(/[^0-9.]/g, "")) || 0), 0);
}

/** Day-tab subtitle: the day's story, clipped for the narrow tab. */
export function daySubtitle(day: BuilderDay, limit = 48): string {
  const text = day.story || day.meta;
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function updateDay(
  days: BuilderDay[],
  dayId: string,
  update: (day: BuilderDay) => BuilderDay,
) {
  return days.map((day) => (day.id === dayId ? update(day) : day));
}

export function appendItemToDay(
  days: BuilderDay[],
  dayId: string,
  item: TimelineItem,
) {
  return updateDay(days, dayId, (day) => ({ ...day, items: [...day.items, item] }));
}

export function updateItemInDay(
  days: BuilderDay[],
  dayId: string,
  itemId: number,
  patch: Partial<TimelineItem>,
) {
  return updateDay(days, dayId, (day) => ({
    ...day,
    items: day.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
  }));
}

export function insertItemInDay(
  days: BuilderDay[],
  dayId: string,
  afterIndex: number,
  item: TimelineItem,
) {
  return updateDay(days, dayId, (day) => {
    const items = [...day.items];
    items.splice(afterIndex + 1, 0, item);
    return { ...day, items };
  });
}

export function moveItemInDay(
  days: BuilderDay[],
  dayId: string,
  fromIndex: number,
  toIndex: number,
) {
  return updateDay(days, dayId, (day) => {
    if (
      fromIndex === toIndex
      || fromIndex < 0
      || toIndex < 0
      || fromIndex >= day.items.length
      || toIndex >= day.items.length
    ) return day;

    const items = [...day.items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    return { ...day, items };
  });
}

export function removeDay(days: BuilderDay[], dayId: string) {
  if (days.length === 1) return days;
  return days
    .filter((day) => day.id !== dayId)
    .map((day, index) => ({ ...day, day: index + 1 }));
}

export function getEndTime(startTime: string, durationMinutes: string) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + Number(durationMinutes);
  return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

const COPILOT_TYPE_ICON: Record<string, IconName> = {
  ACTIVITY: "star",
  HOTEL: "hotel",
  FLIGHT: "plane",
};

/**
 * Maps a Co-Pilot suggestion onto the editor's TimelineItem shape and
 * appends it after the day's current last item, since suggestions carry no
 * start time of their own.
 */
export function copilotSuggestionToTimelineItem(
  suggestion: CopilotSuggestionV1,
  id: number,
  previousItems: TimelineItem[] = [],
): TimelineItem {
  const type = suggestion.item_type.toUpperCase();
  const previous = previousItems[previousItems.length - 1];
  const time = previous ? getEndTime(previous.time, previous.duration ?? "0") : "09:00";

  return {
    id,
    time,
    type,
    title: suggestion.item_name,
    price: suggestion.price_aud != null
      ? `$${suggestion.price_aud}${suggestion.price_unit === "per_night" ? "/night" : ""}`
      : "",
    icon: COPILOT_TYPE_ICON[type] ?? "star",
    status: "pass",
    category: suggestion.category ?? suggestion.item_type,
    // ponytail: default 60min for hotels/flights, which carry no duration.
    duration: String(Math.round((suggestion.duration_hours ?? 1) * 60)),
    notes: suggestion.why_recommended,
    sourceId: suggestion.item_id,
  };
}
import type { CopilotSuggestionV1 } from "./copilot";
import type { CreatorPackageDetail } from "./creator-api";

function parseDay(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const time = Date.parse(dateStr.length <= 10 ? `${dateStr}T00:00:00Z` : dateStr);
  return Number.isNaN(time) ? null : time;
}

// A flight is shown in the local time of whichever end it's currently at —
// departure in the origin airport's zone, arrival in the destination's —
// not the viewer's own timezone, and not a raw regex substring of the ISO
// string (which just echoes whatever offset it happened to be stored with).
const IATA_TIMEZONES: Record<string, string> = {
  SYD: "Australia/Sydney",
  MEL: "Australia/Melbourne",
  BNE: "Australia/Brisbane",
  PER: "Australia/Perth",
  NRT: "Asia/Tokyo",
  HND: "Asia/Tokyo",
};

function formatFlightDuration(departure: string | null, arrival: string | null): string | null {
  if (!departure || !arrival) return null;
  const start = Date.parse(departure);
  const end = Date.parse(arrival);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const minutes = Math.round((end - start) / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function timezoneForIata(iata: string | null | undefined): string {
  return (iata && IATA_TIMEZONES[iata]) || "Australia/Sydney";
}

export function extractClockTimeInZone(dateStr: string | null, timeZone: string): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/**
 * Builds the editor's day/timeline from a real package's flights, hotels,
 * and activities — none of which carry a day number, only calendar dates.
 * The earliest date across all of them anchors day 1.
 */
export function buildDaysFromPackage(pkg: CreatorPackageDetail): BuilderDay[] {
  // Anchor day 1 on activity/hotel dates only: AI-selected flights are matched
  // by route and price, not date, so a flight can depart months before the
  // stay — anchoring on it would push every activity onto the final day.
  const stayDates = [
    ...pkg.activities.map((a) => parseDay(a.activity_date)),
    ...pkg.hotels.map((h) => parseDay(h.check_in_date)),
  ].filter((t): t is number => t !== null);
  const flightDates = pkg.flights
    .map((f) => parseDay(f.departure_datetime))
    .filter((t): t is number => t !== null);
  const anchor = stayDates.length
    ? Math.min(...stayDates)
    : flightDates.length
      ? Math.min(...flightDates)
      : Date.now();
  const dayIndexFor = (dateStr: string | null, fallback = 0) => {
    const parsed = parseDay(dateStr);
    const raw = parsed === null ? fallback : Math.round((parsed - anchor) / 86_400_000);
    return Math.min(Math.max(raw, 0), days.length - 1);
  };

  const dayCount = Math.max(pkg.duration_days || 1, 1);
  const dayMeta = new Map(pkg.days.map((d) => [d.day_number, d]));
  const days: BuilderDay[] = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const meta = dayMeta.get(dayNumber);
    return {
      id: `day-${dayNumber}`,
      day: dayNumber,
      title: meta?.title || `Day ${dayNumber}`,
      // The AI day description is edited in the "Your story" textarea; the
      // day tab derives its subtitle from story, so meta stays empty here.
      meta: "",
      items: [],
      story: meta?.summary || "",
      photos: [],
    };
  });

  let nextId = 0;
  for (const activity of [...pkg.activities].sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0))) {
    nextId += 1;
    days[dayIndexFor(activity.activity_date)].items.push({
      id: nextId,
      time: "09:00",
      type: "ACTIVITY",
      title: activity.activity_name || "Activity",
      price: `$${activity.price_aud ?? 0}`,
      icon: "star",
      status: "pass",
      address: activity.city || undefined,
      duration: activity.duration_hours ? String(Math.round(activity.duration_hours * 60)) : undefined,
      notes: activity.description || undefined,
    });
  }

  for (const flight of pkg.flights) {
    nextId += 1;
    // The flight is placed on its arrival day, at its arrival time in the
    // destination's zone — the day/time it actually delivers you into,
    // shown in local Japan (or wherever) time so it lines up with that
    // day's activities instead of the day/zone it merely left from.
    const scheduleDatetime = flight.arrival_datetime ?? flight.departure_datetime;
    const time = extractClockTimeInZone(scheduleDatetime, timezoneForIata(flight.destination_iata ?? flight.origin_iata)) ?? "09:00";
    days[dayIndexFor(scheduleDatetime)].items.push({
      id: nextId,
      time,
      type: "FLIGHT",
      title: [flight.origin_iata, flight.destination_iata].filter(Boolean).join(" to ") || flight.airline || "Flight",
      subtitle: [flight.airline, formatFlightDuration(flight.departure_datetime, flight.arrival_datetime)].filter(Boolean).join(" · ") || undefined,
      price: `$${flight.price_aud ?? 0}`,
      icon: "plane",
      status: "pass",
    });
  }

  for (const hotel of pkg.hotels) {
    const checkInIndex = dayIndexFor(hotel.check_in_date);
    const checkOutIndex = hotel.check_out_date ? dayIndexFor(hotel.check_out_date) : checkInIndex;
    const nights = Math.max(1, checkOutIndex - checkInIndex);
    const stayGroupId = `hotel-${hotel.hotel_id ?? hotel.hotel_name ?? nextId}`;
    for (let offset = 0; offset <= nights; offset += 1) {
      const dayIndex = checkInIndex + offset;
      if (dayIndex >= days.length) break;
      const isCheckOut = offset === nights;
      nextId += 1;
      days[dayIndex].items.push({
        id: nextId,
        // "15:00"/"11:00" would look like real check-in/out times when
        // they're not — hotel bookings only carry a date, never a time —
        // so this reads honestly instead of implying a fact we don't have.
        time: offset === 0 ? "Check-in" : isCheckOut ? "Check-out" : "Overnight stay",
        type: "HOTEL",
        title: isCheckOut
          ? `${hotel.hotel_name ?? "Hotel"} (Check-out)`
          : nights > 1 ? `${hotel.hotel_name ?? "Hotel"} (Night ${offset + 1} of ${nights})` : hotel.hotel_name ?? "Hotel",
        price: `$${hotel.price_per_night_aud ?? 0}/night`,
        icon: "hotel",
        status: "pass",
        address: hotel.address || hotel.city || undefined,
        checkIn: hotel.check_in_date || undefined,
        checkOut: hotel.check_out_date || undefined,
        roomType: hotel.room_type || undefined,
        starRating: hotel.star_rating || undefined,
        stayMarker: offset === 0 ? "check-in" : isCheckOut ? "check-out" : undefined,
        stayGroupId,
      });
    }
  }

  for (const day of days) day.items.sort((a, b) => a.time.localeCompare(b.time));
  return days;
}
