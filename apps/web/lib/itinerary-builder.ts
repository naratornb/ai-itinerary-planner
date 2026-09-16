export type IconName =
  | "plane"
  | "star"
  | "hotel"
  | "plus"
  | "alert"
  | "check"
  | "clock"
  | "chevron"
  | "pin"
  | "hourglass"
  | "trash"
  | "pencil"
  | "refresh";

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
  bookingRequired?: boolean | null;
  /** Short factual line under the title (e.g. a flight's airline + duration). */
  subtitle?: string;
  notes?: string;
  photos?: DayPhoto[];
  sequenceOrder?: number;
  checkIn?: string;
  checkOut?: string;
  roomType?: string;
  starRating?: number;
  stayMarker?: "check-in" | "check-out";
  stayGroupId?: string;
  /** Inventory ID from the Co-Pilot suggestion this item was added from. */
  sourceId?: string;
  // Raw source-record fields, undecorated by display formatting — kept
  // alongside title/price/time so a save can round-trip real flight/hotel/
  // activity data instead of re-parsing it back out of display strings.
  originIata?: string;
  destinationIata?: string;
  airline?: string;
  flightNumber?: string;
  departureDatetime?: string;
  arrivalDatetime?: string;
  departureTime?: string;
  arrivalTime?: string;
  cabinClass?: string;
  hotelName?: string;
  city?: string;
  activityDate?: string;
};

export type BuilderDay = {
  id: string;
  day: number;
  title: string;
  meta: string;
  items: TimelineItem[];
  story: string;
  photos: DayPhoto[];
  /** This day's real calendar date (YYYY-MM-DD), when one is known. */
  date?: string | null;
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

/** The next legacy calendar date, or null for a date-flexible package. */
export function nextCalendarDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T00:00:00Z`).getTime();
  return new Date(base + 86_400_000).toISOString().slice(0, 10);
}

/** Day-tab subtitle: the day's story, clipped for the narrow tab. */
export function daySubtitle(day: BuilderDay, limit = 48): string {
  const text = day.story || day.meta;
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

export type DaySummary = {
  flightMinutes: number;
  activityCount: number;
  hotelName: string | null;
};

const STAY_LABEL_SUFFIX = /\s*\((Check-in|Check-out|Night \d+ of \d+)\)\s*$/i;

/** Collapsed-card rollup for the Finalise & Review page's day timeline. */
export function summarizeDay(day: BuilderDay): DaySummary {
  let flightMinutes = 0;
  let activityCount = 0;
  let hotelName: string | null = null;
  for (const item of day.items) {
    if (item.type === "FLIGHT") {
      flightMinutes += Number(item.duration ?? 0);
    } else if (item.type === "HOTEL") {
      if (hotelName === null) hotelName = item.title.replace(STAY_LABEL_SUFFIX, "");
    } else {
      activityCount += 1;
    }
  }
  return { flightMinutes, activityCount, hotelName };
}

export type PackageComponentCounts = {
  flightCount: number;
  hotelCount: number;
  activityCount: number;
};

/** Package-wide totals for the Finalise & Review page's info strip. */
export function summarizePackageComponents(days: BuilderDay[]): PackageComponentCounts {
  const items = days.flatMap((day) => day.items);
  const stayGroups = new Set(
    items
      .filter((item) => item.type === "HOTEL")
      .map((item) => item.stayGroupId ?? `single-${item.id}`),
  );
  return {
    flightCount: items.filter((item) => item.type === "FLIGHT").length,
    hotelCount: stayGroups.size,
    activityCount: items.filter((item) => item.type !== "FLIGHT" && item.type !== "HOTEL").length,
  };
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

/** "150" -> "2h 30m", "120" -> "2h", "45" -> "45m", "0" -> "0m". */
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
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
    city: suggestion.city,
  };
}
import type { CopilotSuggestionV1 } from "./copilot";
import type { CreatorPackageDetail, UpdatePackageInput } from "./creator-api";

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

/** Flight duration in minutes from real timestamps, or undefined if either is missing/invalid. */
export function flightDurationMinutes(
  departureDatetime: string | null | undefined,
  arrivalDatetime: string | null | undefined,
): number | undefined {
  if (!departureDatetime || !arrivalDatetime) return undefined;
  const departure = Date.parse(departureDatetime);
  const arrival = Date.parse(arrivalDatetime);
  if (!Number.isFinite(departure) || !Number.isFinite(arrival) || arrival <= departure) return undefined;
  return Math.round((arrival - departure) / 60_000);
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

/** Builds the editor from relative package days, with dated rows as a legacy fallback. */
export function buildDaysFromPackage(pkg: CreatorPackageDetail): BuilderDay[] {
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
      : null;
  const relativeDayMaximum = Math.max(
    1,
    ...pkg.days.map((day) => day.day_number ?? 1),
    ...pkg.activities.map((activity) => activity.day_number ?? 1),
    ...pkg.flights.map((flight) => flight.day_number ?? 1),
    ...pkg.hotels.map((hotel) => hotel.check_out_day ?? hotel.check_in_day ?? 1),
  );
  const dayCount = Math.max(pkg.duration_days || 1, relativeDayMaximum);
  const dayIndexFor = (dateStr: string | null, fallback = 0) => {
    const parsed = parseDay(dateStr);
    const raw = parsed === null || anchor === null ? fallback : Math.round((parsed - anchor) / 86_400_000);
    return Math.min(Math.max(raw, 0), dayCount - 1);
  };
  const dayIndexFromNumber = (dayNumber: number | null | undefined, fallback = 0) =>
    Math.min(Math.max((dayNumber ?? fallback + 1) - 1, 0), dayCount - 1);
  const mediaById = new Map((pkg.media ?? []).map((media) => [media.media_id, media]));
  const photosFor = (mediaIds: string[] | undefined, fallbackAlt: string): DayPhoto[] =>
    (mediaIds ?? []).flatMap((mediaId) => {
      const media = mediaById.get(mediaId);
      return media ? [{ src: media.url, alt: media.caption || fallbackAlt, media_id: mediaId }] : [];
    });

  const dayMeta = new Map(pkg.days.map((d) => [d.day_number, d]));
  const days: BuilderDay[] = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const meta = dayMeta.get(dayNumber);
    return {
      id: `day-${dayNumber}`,
      day: dayNumber,
      title: meta?.title || `Day ${dayNumber}`,
      meta: meta?.meta || "",
      items: [],
      story: meta?.summary || "",
      photos: photosFor(meta?.media_ids, `Day ${dayNumber} photo`),
      date: anchor === null ? null : new Date(anchor + index * 86_400_000).toISOString().slice(0, 10),
    };
  });

  let nextId = 0;
  for (const activity of pkg.activities) {
    nextId += 1;
    const dayIndex = activity.day_number
      ? dayIndexFromNumber(activity.day_number)
      : dayIndexFor(activity.activity_date ?? null);
    days[dayIndex].items.push({
      id: nextId,
      // No start_time stays empty here — the ordering pass below slots it
      // after the previous activity instead of faking a shared 09:00.
      time: activity.start_time || "",
      type: "ACTIVITY",
      title: activity.activity_name || "Activity",
      price: `$${activity.price_aud ?? 0}`,
      icon: "star",
      status: "pass",
      category: activity.category || undefined,
      address: activity.address || activity.city || undefined,
      duration: activity.duration_hours ? String(Math.round(activity.duration_hours * 60)) : undefined,
      notes: activity.notes || activity.description || undefined,
      photos: photosFor(activity.media_ids, activity.activity_name || "Activity photo"),
      sequenceOrder: activity.sequence_order ?? undefined,
      bookingRequired: activity.booking_required,
      sourceId: activity.source_id || undefined,
      city: activity.city || undefined,
      activityDate: activity.activity_date || undefined,
    });
  }

  for (const flight of pkg.flights) {
    nextId += 1;
    const scheduleDatetime = flight.arrival_datetime ?? flight.departure_datetime;
    const isRelative = flight.day_number !== null && flight.day_number !== undefined;
    const dayIndex = isRelative ? dayIndexFromNumber(flight.day_number) : dayIndexFor(scheduleDatetime ?? null);
    const legacyTime = extractClockTimeInZone(scheduleDatetime ?? null, timezoneForIata(flight.destination_iata ?? flight.origin_iata));
    const departureTime = flight.departure_time
      || extractClockTimeInZone(flight.departure_datetime ?? null, timezoneForIata(flight.origin_iata));
    const arrivalTime = flight.arrival_time
      || extractClockTimeInZone(flight.arrival_datetime ?? null, timezoneForIata(flight.destination_iata));
    days[dayIndex].items.push({
      id: nextId,
      time: isRelative ? departureTime || "09:00" : legacyTime || "09:00",
      type: "FLIGHT",
      title: [flight.origin_iata, flight.destination_iata].filter(Boolean).join(" to ") || flight.airline || "Flight",
      subtitle: [flight.airline, formatFlightDuration(flight.departure_datetime, flight.arrival_datetime)].filter(Boolean).join(" · ") || undefined,
      price: `$${flight.price_aud ?? 0}`,
      icon: "plane",
      status: "pass",
      duration: flight.duration_minutes
        ? String(flight.duration_minutes)
        : (() => {
            const minutes = flightDurationMinutes(flight.departure_datetime, flight.arrival_datetime);
            return minutes === undefined ? undefined : String(minutes);
          })(),
      notes: flight.notes || undefined,
      photos: photosFor(flight.media_ids, flight.airline || "Flight photo"),
      sequenceOrder: flight.sequence_order ?? undefined,
      sourceId: flight.source_id || undefined,
      originIata: flight.origin_iata ?? undefined,
      destinationIata: flight.destination_iata ?? undefined,
      airline: flight.airline ?? undefined,
      flightNumber: flight.flight_number ?? undefined,
      departureDatetime: flight.departure_datetime ?? undefined,
      arrivalDatetime: flight.arrival_datetime ?? undefined,
      departureTime: departureTime ?? undefined,
      arrivalTime: arrivalTime ?? undefined,
      cabinClass: flight.cabin_class ?? undefined,
    });
  }

  for (const hotel of pkg.hotels) {
    const checkInIndex = hotel.check_in_day
      ? dayIndexFromNumber(hotel.check_in_day)
      : dayIndexFor(hotel.check_in_date);
    const checkOutIndex = hotel.check_out_day
      ? dayIndexFromNumber(hotel.check_out_day)
      : hotel.check_out_date ? dayIndexFor(hotel.check_out_date) : checkInIndex;
    const nights = hotel.check_in_day && hotel.check_out_day
      ? Math.max(1, checkOutIndex - checkInIndex)
      : Math.max(1, hotel.nights ?? checkOutIndex - checkInIndex);
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
        notes: hotel.notes || undefined,
        photos: photosFor(hotel.media_ids, hotel.hotel_name || "Hotel photo"),
        sequenceOrder: hotel.sequence_order ?? undefined,
        sourceId: hotel.source_id || undefined,
        address: hotel.address || hotel.city || undefined,
        checkIn: hotel.check_in_date || undefined,
        checkOut: hotel.check_out_date || undefined,
        roomType: hotel.room_type || undefined,
        starRating: hotel.star_rating || undefined,
        stayMarker: offset === 0 ? "check-in" : isCheckOut ? "check-out" : undefined,
        stayGroupId,
        hotelName: hotel.hotel_name ?? undefined,
        city: hotel.city ?? undefined,
      });
    }
  }

  // Check-out leads the day and the stay closes it; flights and activities
  // order chronologically in between. The old sequence_order sort interleaved
  // every component at sequence 1, dropping the hotel row mid-day — and every
  // activity lacking a start_time collapsed onto "09:00", so they all
  // overlapped. Missing activity times chain off the previous activity's end.
  const dayBand = (item: TimelineItem) =>
    item.type === "HOTEL" ? (item.stayMarker === "check-out" ? 0 : 3) : item.type === "FLIGHT" ? 1 : 2;
  for (const day of days) {
    day.items.sort((a, b) => {
      const band = dayBand(a) - dayBand(b);
      if (band !== 0) return band;
      if (REAL_TIME.test(a.time) && REAL_TIME.test(b.time)) return a.time.localeCompare(b.time);
      return (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER);
    });
    let cursor = "09:00";
    for (const item of day.items) {
      if (item.type !== "ACTIVITY") continue;
      if (REAL_TIME.test(item.time)) {
        const end = getEndTime(item.time, item.duration ?? "0");
        if (end > cursor) cursor = end;
      } else {
        item.time = cursor;
        cursor = getEndTime(cursor, item.duration ?? "60");
      }
    }
  }
  return days;
}

const priceNumber = (price: string) => Number(price.replace(/[^0-9.]/g, "")) || null;
const mediaIds = (photos: DayPhoto[] | undefined) =>
  (photos ?? []).flatMap((photo) => photo.media_id ? [photo.media_id] : []);

/** Serializes the date-flexible editor state into the proposed package PUT contract. */
export function buildPackageUpdate(
  pkg: CreatorPackageDetail,
  days: BuilderDay[],
  title: string,
): UpdatePackageInput {
  const flat = days.flatMap((day, dayIndex) =>
    day.items.map((item, itemIndex) => ({ item, dayIndex, itemIndex })));

  const flights = flat
    .filter(({ item }) => item.type === "FLIGHT" && item.originIata && item.destinationIata)
    .map(({ item, dayIndex, itemIndex }) => ({
      origin_iata: item.originIata!,
      destination_iata: item.destinationIata!,
      airline: item.airline || "Unknown",
      flight_number: item.flightNumber || null,
      departure_time: item.departureTime || (REAL_TIME.test(item.time) ? item.time : null),
      arrival_time: item.arrivalTime || null,
      duration_minutes: item.duration ? Number(item.duration) : null,
      cabin_class: item.cabinClass || null,
      price_aud: priceNumber(item.price),
      day_number: dayIndex + 1,
      sequence_order: itemIndex + 1,
      notes: item.notes || null,
      media_ids: mediaIds(item.photos),
      source_id: item.sourceId || null,
    }));

  const activities = flat
    .filter(({ item }) => item.type === "ACTIVITY" || item.type === "CREATOR PICK")
    .map(({ item, dayIndex, itemIndex }) => ({
      activity_name: item.title,
      city: item.city || pkg.destination_city || "",
      duration_hours: item.duration ? Number(item.duration) / 60 : null,
      price_aud: priceNumber(item.price),
      description: item.notes || null,
      notes: item.notes || null,
      booking_required: item.bookingRequired ?? null,
      day_number: dayIndex + 1,
      sequence_order: itemIndex + 1,
      start_time: REAL_TIME.test(item.time) ? item.time : null,
      category: item.category || null,
      address: item.address || null,
      media_ids: mediaIds(item.photos),
      source_id: item.sourceId || null,
    }));

  const stayGroupIds = [...new Set(flat
    .filter(({ item }) => item.type === "HOTEL" && item.stayGroupId)
    .map(({ item }) => item.stayGroupId!))];
  const hotels = stayGroupIds.flatMap((groupId) => {
    const group = flat.filter(({ item }) => item.stayGroupId === groupId);
    const checkIn = group.find(({ item }) => item.stayMarker === "check-in") ?? group[0];
    const checkOut = group.find(({ item }) => item.stayMarker === "check-out") ?? group[group.length - 1];
    const base = checkIn.item;
    if (!base.hotelName) return [];
    const checkInDay = checkIn.dayIndex + 1;
    const checkOutDay = checkOut.dayIndex + 1;
    return [{
      hotel_name: base.hotelName,
      star_rating: base.starRating ?? null,
      city: base.city || pkg.destination_city || "",
      address: base.address || null,
      price_per_night_aud: priceNumber(base.price),
      room_type: base.roomType || null,
      check_in_day: checkInDay,
      check_out_day: checkOutDay,
      nights: Math.max(1, checkOutDay - checkInDay),
      sequence_order: checkIn.itemIndex + 1,
      notes: base.notes || null,
      media_ids: mediaIds(base.photos),
      source_id: base.sourceId || null,
    }];
  });

  return {
    title,
    base_price_aud: Math.round(computePackagePrice(days)),
    description: pkg.description ?? undefined,
    destination_country: pkg.destination_country ?? undefined,
    destination_city: pkg.destination_city ?? undefined,
    duration_days: days.length,
    max_group_size: pkg.max_group_size ?? undefined,
    tags: pkg.tags ?? undefined,
    days: days.map((day, index) => ({
      day_number: index + 1,
      title: day.title === `Day ${index + 1}` ? null : day.title || null,
      summary: day.story || null,
      meta: day.meta || null,
      media_ids: mediaIds(day.photos),
    })),
    flights,
    hotels,
    activities,
  };
}

const REAL_TIME = /^\d{2}:\d{2}$/;
