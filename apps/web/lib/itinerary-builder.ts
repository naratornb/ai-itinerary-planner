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
  /** Index into CreatorPackageDetail.flights, for FLIGHT rows only. */
  flightIndex?: number;
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
  CNS: "Australia/Brisbane",
  AKL: "Pacific/Auckland",
  ZQN: "Pacific/Auckland",

  NRT: "Asia/Tokyo",
  HND: "Asia/Tokyo",
  KIX: "Asia/Tokyo",
  ITM: "Asia/Tokyo",
  CTS: "Asia/Tokyo",

  ICN: "Asia/Seoul",
  GMP: "Asia/Seoul",
  PUS: "Asia/Seoul",
  TPE: "Asia/Taipei",
  HKG: "Asia/Hong_Kong",
  PVG: "Asia/Shanghai",
  SIN: "Asia/Singapore",
  BKK: "Asia/Bangkok",
  DMK: "Asia/Bangkok",
  CNX: "Asia/Bangkok",
  HKT: "Asia/Bangkok",
  KUL: "Asia/Kuala_Lumpur",
  DPS: "Asia/Makassar",
  CGK: "Asia/Jakarta",
  MNL: "Asia/Manila",
  HAN: "Asia/Ho_Chi_Minh",
  SGN: "Asia/Ho_Chi_Minh",
  DAD: "Asia/Ho_Chi_Minh",
  DEL: "Asia/Kolkata",
  BOM: "Asia/Kolkata",
  CMB: "Asia/Colombo",
  DXB: "Asia/Dubai",
  DOH: "Asia/Qatar",

  CAI: "Africa/Cairo",
  RAK: "Africa/Casablanca",
  CPT: "Africa/Johannesburg",
  NBO: "Africa/Nairobi",

  LHR: "Europe/London",
  LGW: "Europe/London",
  STN: "Europe/London",
  LTN: "Europe/London",
  EDI: "Europe/London",
  CDG: "Europe/Paris",
  ORY: "Europe/Paris",
  NCE: "Europe/Paris",
  AMS: "Europe/Amsterdam",
  BER: "Europe/Berlin",
  VIE: "Europe/Vienna",
  PRG: "Europe/Prague",
  KRK: "Europe/Warsaw",
  ZRH: "Europe/Zurich",
  FCO: "Europe/Rome",
  CIA: "Europe/Rome",
  FLR: "Europe/Rome",
  VCE: "Europe/Rome",
  BCN: "Europe/Madrid",
  MAD: "Europe/Madrid",
  VLC: "Europe/Madrid",
  LIS: "Europe/Lisbon",
  OPO: "Europe/Lisbon",
  ATH: "Europe/Athens",
  JTR: "Europe/Athens",
  IST: "Europe/Istanbul",
  SAW: "Europe/Istanbul",
  KEF: "Atlantic/Reykjavik",

  JFK: "America/New_York",
  EWR: "America/New_York",
  LGA: "America/New_York",
  YYZ: "America/Toronto",
  LAX: "America/Los_Angeles",
  SFO: "America/Los_Angeles",
  YVR: "America/Vancouver",
  HNL: "Pacific/Honolulu",
  CUN: "America/Cancun",
  MEX: "America/Mexico_City",
  EZE: "America/Argentina/Buenos_Aires",
  GIG: "America/Sao_Paulo",
  CUZ: "America/Lima",
  MDE: "America/Bogota",
};

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

/** Calendar date at the airport itself, not the UTC date of the stored instant. */
export function extractDateInZone(dateStr: string | null, timeZone: string): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

function clockToHours(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour + minute / 60;
}

function hoursToClock(value: number): string {
  const safe = Math.max(0, Math.min(23.75, value));
  let hour = Math.floor(safe);
  let minute = Math.round(((safe - hour) * 60) / 15) * 15;
  if (minute === 60) {
    hour = Math.min(23, hour + 1);
    minute = 0;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const ARRIVAL_BUFFER_HOURS = 2;
const DEPARTURE_BUFFER_HOURS = 3;
const NORMAL_DAY_START_HOUR = 9;
const NORMAL_DAY_END_HOUR = 20;
const ACTIVITY_GAP_HOURS = 0.5;


/**
 * Builds the editor's day/timeline from a real package's flights, hotels,
 * and activities — none of which carry a day number, only calendar dates.
 * The earliest date across all of them anchors day 1.
 */
export function buildDaysFromPackage(pkg: CreatorPackageDetail): BuilderDay[] {
  const DAY_MS = 86_400_000;

  const sortedFlights = [...pkg.flights].sort(
    (a, b) => (a.departure_datetime ?? "").localeCompare(b.departure_datetime ?? ""),
  );

  // The first airport the traveller leaves from is "home".
  const homeIata = sortedFlights[0]?.origin_iata ?? null;

  const isReturnLeg = (flight: CreatorPackageDetail["flights"][number]) =>
    Boolean(homeIata)
    && flight.destination_iata === homeIata
    && flight.origin_iata !== homeIata;

  const outboundFlight =
    sortedFlights.find(
      (flight) =>
        Boolean(homeIata)
        && flight.origin_iata === homeIata
        && flight.destination_iata !== homeIata,
    )
    ?? sortedFlights.find((flight) => !isReturnLeg(flight))
    ?? null;

  const returnFlight =
    sortedFlights.find((flight) => isReturnLeg(flight))
    ?? null;

  // Day 1 is based on the LOCAL ARRIVAL DATE at the destination.
  // This is the key rule that prevents a flight landing on Apr 28 New York
  // time from being placed on Apr 29 just because the stored UTC instant is
  // already Apr 29.
  const outboundArrivalZone = timezoneForIata(
    outboundFlight?.destination_iata ?? outboundFlight?.origin_iata,
  );
  const outboundArrivalDate = outboundFlight
    ? extractDateInZone(
        outboundFlight.arrival_datetime ?? outboundFlight.departure_datetime,
        outboundArrivalZone,
      )
    : null;
  const outboundArrivalTime = outboundFlight
    ? extractClockTimeInZone(
        outboundFlight.arrival_datetime ?? outboundFlight.departure_datetime,
        outboundArrivalZone,
      )
    : null;

  // Return planning uses LOCAL DEPARTURE DATE/TIME at the destination.
  const returnDepartureZone = timezoneForIata(
    returnFlight?.origin_iata ?? returnFlight?.destination_iata,
  );
  const returnDepartureDate = returnFlight
    ? extractDateInZone(
        returnFlight.departure_datetime ?? returnFlight.arrival_datetime,
        returnDepartureZone,
      )
    : null;
  const returnDepartureTime = returnFlight
    ? extractClockTimeInZone(
        returnFlight.departure_datetime ?? returnFlight.arrival_datetime,
        returnDepartureZone,
      )
    : null;

  const stayDates = [
    ...pkg.activities.map((activity) => parseDay(activity.activity_date)),
    ...pkg.hotels.map((hotel) => parseDay(hotel.check_in_date)),
  ].filter((value): value is number => value !== null);

  const scheduledFlightDates = pkg.flights
    .map((flight) => {
      const returnLeg = isReturnLeg(flight);
      const value = returnLeg
        ? (flight.departure_datetime ?? flight.arrival_datetime)
        : (flight.arrival_datetime ?? flight.departure_datetime);
      const iata = returnLeg
        ? (flight.origin_iata ?? flight.destination_iata)
        : (flight.destination_iata ?? flight.origin_iata);
      return parseDay(extractDateInZone(value, timezoneForIata(iata)));
    })
    .filter((value): value is number => value !== null);

  const outboundAnchor = parseDay(outboundArrivalDate);
  const fallbackFlightAnchor = scheduledFlightDates.length
    ? Math.min(...scheduledFlightDates)
    : null;

  const anchor =
    outboundAnchor
    ?? (stayDates.length ? Math.min(...stayDates) : null)
    ?? fallbackFlightAnchor
    ?? Date.now();

  // Do not squash an actual later return flight / hotel checkout onto the
  // requested last day. If the backend picked a flight beyond duration_days,
  // show the real extra calendar day instead of creating a false collision.
  const latestCandidates = [
    ...pkg.activities.map((activity) => parseDay(activity.activity_date)),
    ...pkg.hotels.map((hotel) => parseDay(hotel.check_out_date ?? hotel.check_in_date)),
    ...scheduledFlightDates,
  ].filter((value): value is number => value !== null);

  const minimumLastDay =
    anchor + (Math.max(pkg.duration_days || 1, 1) - 1) * DAY_MS;

  const latest = latestCandidates.length
    ? Math.max(minimumLastDay, ...latestCandidates)
    : minimumLastDay;

  const calendarSpan = Math.max(1, Math.round((latest - anchor) / DAY_MS) + 1);
  const dayCount = Math.max(pkg.duration_days || 1, calendarSpan);

  const dayMeta = new Map(pkg.days.map((day) => [day.day_number, day]));

  const days: BuilderDay[] = Array.from({ length: dayCount }, (_, index) => {
    const dayNumber = index + 1;
    const meta = dayMeta.get(dayNumber);

    return {
      id: `day-${dayNumber}`,
      day: dayNumber,
      title: meta?.title || `Day ${dayNumber}`,
      meta: "",
      items: [],
      story: meta?.summary || "",
      photos: [],
    };
  });

  const dayIndexForDate = (dateStr: string | null, fallback = 0) => {
    const parsed = parseDay(dateStr);
    if (parsed === null) return fallback;
    const raw = Math.round((parsed - anchor) / DAY_MS);
    return Math.min(Math.max(raw, 0), days.length - 1);
  };

  // ---------------------------------------------------------------------------
  // ACTIVITIES
  //
  // start_time is not stored in the package activity table. Therefore the
  // editor MUST NOT hard-code every activity to 09:00. Rebuild the clock from:
  //
  //   real local arrival -> arrival buffer -> activities
  //   normal days        -> 09:00 onward
  //   return day         -> activities must finish before departure - 3h
  //
  // The activity date and duration already exist in the package, so this
  // requires no database schema change.
  // ---------------------------------------------------------------------------

  const cursorByDay = new Map<number, number>();

  const sortedActivities = [...pkg.activities].sort((a, b) => {
    const dateCompare = (a.activity_date ?? "").localeCompare(b.activity_date ?? "");
    if (dateCompare !== 0) return dateCompare;
    return (a.sequence_order ?? 0) - (b.sequence_order ?? 0);
  });

  let nextId = 0;

  for (const activity of sortedActivities) {
    const dayIndex = dayIndexForDate(activity.activity_date);
    const activityDate = activity.activity_date?.slice(0, 10) ?? null;

    let windowStart = NORMAL_DAY_START_HOUR;
    let windowEnd = NORMAL_DAY_END_HOUR;

    if (activityDate && activityDate === outboundArrivalDate) {
      const arrivalHour = clockToHours(outboundArrivalTime);
      if (arrivalHour !== null) {
        windowStart = Math.max(
          windowStart,
          arrivalHour + ARRIVAL_BUFFER_HOURS,
        );
      }
    }

    if (activityDate && activityDate === returnDepartureDate) {
      const departureHour = clockToHours(returnDepartureTime);
      if (departureHour !== null) {
        windowEnd = Math.min(
          windowEnd,
          departureHour - DEPARTURE_BUFFER_HOURS,
        );
      }
    }

    // Nothing fits on this day (for example: land at 21:15 + 2h buffer).
    if (windowStart >= windowEnd) continue;

    const durationHours =
      typeof activity.duration_hours === "number"
      && Number.isFinite(activity.duration_hours)
      && activity.duration_hours > 0
        ? Math.min(Math.max(activity.duration_hours, 0.5), 8)
        : 2;

    const cursor = Math.max(
      windowStart,
      cursorByDay.get(dayIndex) ?? windowStart,
    );

    const activityEnd = cursor + durationHours;

    // Do not display an impossible activity that would overlap the airport
    // window. The backend package data remains untouched; this only prevents
    // the editor from presenting a physically impossible timeline.
    if (activityEnd > windowEnd) continue;

    nextId += 1;

    days[dayIndex].items.push({
      id: nextId,
      time: hoursToClock(cursor),
      type: "ACTIVITY",
      title: activity.activity_name || "Activity",
      price: `$${activity.price_aud ?? 0}`,
      icon: "star",
      status: "pass",
      address: activity.city || undefined,
      duration: String(Math.round(durationHours * 60)),
      notes: activity.description || undefined,
    });

    cursorByDay.set(
      dayIndex,
      activityEnd + ACTIVITY_GAP_HOURS,
    );
  }

  // ---------------------------------------------------------------------------
  // FLIGHTS
  //
  // Outbound is displayed at local ARRIVAL time/date.
  // Return is displayed at local DEPARTURE time/date.
  // ---------------------------------------------------------------------------

  for (const [flightIndex, flight] of pkg.flights.entries()) {
    nextId += 1;

    const returnLeg = isReturnLeg(flight);

    const scheduleDatetime = returnLeg
      ? (flight.departure_datetime ?? flight.arrival_datetime)
      : (flight.arrival_datetime ?? flight.departure_datetime);

    const zoneIata = returnLeg
      ? (flight.origin_iata ?? flight.destination_iata)
      : (flight.destination_iata ?? flight.origin_iata);

    const timeZone = timezoneForIata(zoneIata);

    const localDate =
      extractDateInZone(scheduleDatetime, timeZone);

    const time =
      extractClockTimeInZone(scheduleDatetime, timeZone)
      ?? "09:00";

    const route = [
      flight.origin_iata,
      flight.destination_iata,
    ].filter(Boolean);

    const title =
      route.length === 2
        ? (
            returnLeg
              ? `Depart ${route[0]} for ${route[1]}`
              : `Arrive ${route[1]} from ${route[0]}`
          )
        : (flight.airline || "Flight");

    days[dayIndexForDate(localDate)].items.push({
      id: nextId,
      time,
      type: "FLIGHT",
      title,
      price: `$${flight.price_aud ?? 0}`,
      icon: "plane",
      status: "pass",
      flightIndex,
    });
  }

  // ---------------------------------------------------------------------------
  // HOTELS
  // ---------------------------------------------------------------------------

  for (const hotel of pkg.hotels) {
    const checkInIndex = dayIndexForDate(hotel.check_in_date);
    const checkOutIndex = hotel.check_out_date
      ? dayIndexForDate(hotel.check_out_date)
      : checkInIndex;

    const nights = Math.max(1, checkOutIndex - checkInIndex);
    const stayGroupId = `hotel-${hotel.hotel_id ?? hotel.hotel_name ?? nextId}`;

    for (let offset = 0; offset <= nights; offset += 1) {
      const dayIndex = checkInIndex + offset;
      if (dayIndex >= days.length) break;

      const isCheckOut = offset === nights;
      nextId += 1;

      days[dayIndex].items.push({
        id: nextId,
        time:
          offset === 0
            ? "Check-in"
            : isCheckOut
              ? "Check-out"
              : "Overnight stay",
        type: "HOTEL",
        title:
          isCheckOut
            ? `${hotel.hotel_name ?? "Hotel"} (Check-out)`
            : nights > 1
              ? `${hotel.hotel_name ?? "Hotel"} (Night ${offset + 1} of ${nights})`
              : hotel.hotel_name ?? "Hotel",
        price: `$${hotel.price_per_night_aud ?? 0}/night`,
        icon: "hotel",
        status: "pass",
        address: hotel.address || hotel.city || undefined,
        checkIn: hotel.check_in_date || undefined,
        checkOut: hotel.check_out_date || undefined,
        roomType: hotel.room_type || undefined,
        starRating: hotel.star_rating || undefined,
        stayMarker:
          offset === 0
            ? "check-in"
            : isCheckOut
              ? "check-out"
              : undefined,
        stayGroupId,
      });
    }
  }

  // Real clock rows sort chronologically. Non-clock hotel markers follow them.
  const sortKey = (item: TimelineItem) => {
    const hours = clockToHours(item.time);
    return hours === null ? Number.POSITIVE_INFINITY : hours;
  };

  for (const day of days) {
    day.items.sort((a, b) => sortKey(a) - sortKey(b));
  }

  return days;
}
