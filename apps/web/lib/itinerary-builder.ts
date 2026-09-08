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
  photos: { src: string; alt: string }[];
};

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
    price: `$${suggestion.price_aud}`,
    icon: COPILOT_TYPE_ICON[type] ?? "star",
    status: "pass",
    category: suggestion.category,
    duration: String(Math.round(suggestion.duration_hours * 60)),
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

/**
 * Builds the editor's day/timeline from a real package's flights, hotels,
 * and activities — none of which carry a day number, only calendar dates.
 * The earliest date across all of them anchors day 1.
 */
export function buildDaysFromPackage(pkg: CreatorPackageDetail): BuilderDay[] {
  const anchor = Math.min(
    ...[
      ...pkg.activities.map((a) => parseDay(a.activity_date)),
      ...pkg.flights.map((f) => parseDay(f.departure_datetime)),
      ...pkg.hotels.map((h) => parseDay(h.check_in_date)),
    ].filter((t): t is number => t !== null),
    Date.now(),
  );
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
      meta: meta?.summary || "",
      items: [],
      story: "",
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
    const time = flight.departure_datetime?.match(/T(\d{2}:\d{2})/)?.[1] ?? "09:00";
    days[dayIndexFor(flight.departure_datetime)].items.push({
      id: nextId,
      time,
      type: "FLIGHT",
      title: [flight.origin_iata, flight.destination_iata].filter(Boolean).join(" to ") || flight.airline || "Flight",
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
        time: offset === 0 ? "15:00" : isCheckOut ? "11:00" : "Overnight stay",
        type: "HOTEL",
        title: isCheckOut
          ? `${hotel.hotel_name ?? "Hotel"} (Check-out)`
          : nights > 1 ? `${hotel.hotel_name ?? "Hotel"} (Night ${offset + 1} of ${nights})` : hotel.hotel_name ?? "Hotel",
        price: `$${hotel.price_per_night_aud ?? 0}/night`,
        icon: "hotel",
        status: "pass",
        address: hotel.address || hotel.city || undefined,
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
