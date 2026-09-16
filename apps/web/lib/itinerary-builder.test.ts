import assert from "node:assert/strict";
import test from "node:test";

import {
  appendItemToDay,
  buildPackageUpdate,
  buildDaysFromPackage,
  computePackagePrice,
  copilotSuggestionToTimelineItem,
  daySubtitle,
  extractClockTimeInZone,
  flightArrivalDayOffset,
  flightDurationMinutes,
  formatMinutes,
  getEndTime,
  insertItemInDay,
  moveItemInDay,
  recomputeHotelStayLabels,
  removeDay,
  summarizeDay,
  summarizePackageComponents,
  timezoneForIata,
  updateItemInDay,
  type BuilderDay,
  type TimelineItem,
} from "./itinerary-builder";
import type { CopilotSuggestionV1 } from "./copilot";
import type { CreatorPackageDetail } from "./creator-api";

const firstItem: TimelineItem = {
  id: 1,
  time: "09:00",
  type: "ACTIVITY",
  title: "Breakfast",
  price: "$20",
  icon: "star",
  status: "pass",
};

const secondItem: TimelineItem = {
  ...firstItem,
  id: 2,
  time: "11:00",
  title: "Museum",
};

function makeDays(): BuilderDay[] {
  return [
    { id: "day-1", day: 1, title: "Arrival", meta: "City", items: [firstItem], story: "", photos: [] },
    { id: "day-2", day: 2, title: "Culture", meta: "Museums", items: [secondItem], story: "", photos: [] },
  ];
}

test("appendItemToDay adds only to the requested day", () => {
  const nextItem = { ...secondItem, id: 3, title: "Dinner" };
  const result = appendItemToDay(makeDays(), "day-1", nextItem);

  assert.deepEqual(result[0].items.map((item) => item.title), ["Breakfast", "Dinner"]);
  assert.deepEqual(result[1].items.map((item) => item.title), ["Museum"]);
});

test("updateItemInDay updates an item without changing another day", () => {
  const result = updateItemInDay(makeDays(), "day-1", 1, { title: "Ramen breakfast" });

  assert.equal(result[0].items[0].title, "Ramen breakfast");
  assert.equal(result[1].items[0].title, "Museum");
});

test("insertItemInDay inserts after the given index without touching another day", () => {
  const result = insertItemInDay(makeDays(), "day-1", 0, { ...secondItem, id: 3 });

  assert.deepEqual(result[0].items.map((item) => item.id), [1, 3]);
  assert.deepEqual(result[1].items.map((item) => item.id), [2]);
});

test("moveItemInDay reorders only the requested day", () => {
  const days = appendItemToDay(makeDays(), "day-1", { ...secondItem, id: 3 });
  const result = moveItemInDay(days, "day-1", 1, 0);

  assert.deepEqual(result[0].items.map((item) => item.id), [3, 1]);
  assert.deepEqual(result[1].items.map((item) => item.id), [2]);
});

test("removeDay renumbers remaining days and preserves their items", () => {
  const result = removeDay(makeDays(), "day-1");

  assert.equal(result.length, 1);
  assert.equal(result[0].day, 1);
  assert.equal(result[0].id, "day-2");
  assert.deepEqual(result[0].items.map((item) => item.id), [2]);
});

test("getEndTime adds duration minutes and wraps past midnight", () => {
  assert.equal(getEndTime("09:00", "90"), "10:30");
  assert.equal(getEndTime("23:30", "90"), "01:00");
});

const foodSuggestion: CopilotSuggestionV1 = {
  item_id: "AC-NRT-001",
  item_name: "Tokyo Street Food Walking Tour",
  item_type: "activity",
  city: "Tokyo",
  country: "Japan",
  category: "food",
  suitable_for: "Foodies",
  duration_hours: 3.6,
  price_aud: 144,
  price_unit: "per_person",
  rating: 4.5,
  why_recommended: "Matches your interest in local food.",
};

test("copilotSuggestionToTimelineItem maps suggestion fields onto a timeline item", () => {
  const item = copilotSuggestionToTimelineItem(foodSuggestion, 42, []);

  assert.equal(item.id, 42);
  assert.equal(item.title, "Tokyo Street Food Walking Tour");
  assert.equal(item.type, "ACTIVITY");
  assert.equal(item.icon, "star");
  assert.equal(item.price, "$144");
  assert.equal(item.duration, "216");
  assert.equal(item.category, "food");
  assert.equal(item.notes, "Matches your interest in local food.");
  assert.equal(item.sourceId, "AC-NRT-001");
  assert.equal(item.status, "pass");
  assert.equal(item.time, "09:00");
});

test("copilotSuggestionToTimelineItem starts right after the day's last item", () => {
  const previousItem: TimelineItem = { ...firstItem, time: "09:00", duration: "20" };

  const item = copilotSuggestionToTimelineItem(
    { ...foodSuggestion, item_type: "hotel", item_id: "HT-001" },
    43,
    [previousItem],
  );

  assert.equal(item.time, "09:20");
  assert.equal(item.type, "HOTEL");
  assert.equal(item.icon, "hotel");
});

test("a suggestion with no price, duration, or category renders blanks instead of $null and NaN", () => {
  const item = copilotSuggestionToTimelineItem(
    {
      ...foodSuggestion,
      item_id: "HT-002",
      item_type: "hotel",
      price_aud: null,
      price_unit: "per_night",
      duration_hours: null,
      rating: null,
      category: null,
    },
    44,
    [],
  );

  assert.equal(item.price, "");
  assert.equal(item.duration, "60");
  assert.equal(item.category, "hotel");
});

test("a flight lands on its arrival day, at its arrival time in the destination's zone", () => {
  // Departure and arrival fall on different UTC calendar days on purpose —
  // the flight must key off arrival, not departure, for both its day and
  // its displayed clock time. Day 1 is anchored on the first activity/hotel
  // date (not the earlier departure): AI-selected flights are matched by
  // route, not date, so departures can't be trusted to start the timeline.
  const pkg: CreatorPackageDetail = {
    package_id: "pkg-1",
    title: "Tokyo Street Food & Culture Week",
    duration_days: 2,
    days: [],
    hotels: [],
    activities: [
      {
        activity_id: "act-1",
        sequence_order: 1,
        activity_name: "Tokyo Cooking Class",
        activity_date: "2026-07-12",
        city: "Tokyo",
        duration_hours: 3,
        price_aud: 128,
        description: null,
        booking_required: null,
      },
    ],
    flights: [
      {
        flight_id: "fl-1",
        airline: "Qantas",
        flight_number: "QF25",
        origin_iata: "SYD",
        destination_iata: "NRT",
        departure_datetime: "2026-07-12T20:00:00Z",
        // JST (UTC+9, no DST in Japan) — lands 14:00 local on July 13, a day
        // after it departed and a day after the anchoring activity.
        arrival_datetime: "2026-07-13T05:00:00Z",
        cabin_class: null,
        price_aud: 850,
      },
    ],
  };

  const days = buildDaysFromPackage(pkg);

  assert.equal(days[0].items.length, 1);
  assert.equal(days[0].items[0].type, "ACTIVITY");
  const flightItem = days[1].items.find((item) => item.type === "FLIGHT");
  assert.equal(flightItem?.time, "14:00");
});

test("extractClockTimeInZone renders a flight's real instant in the given zone, not a raw ISO substring", () => {
  // Stored with a +14:00 offset: the digits right after "T" ("08:00") match
  // neither Sydney's nor Tokyo's clock — only a real zone-aware conversion
  // of the underlying UTC instant (2026-04-01T18:00:00Z) does.
  const instant = "2026-04-02T08:00:00+14:00";

  assert.equal(extractClockTimeInZone(instant, "Australia/Sydney"), "05:00");
  assert.equal(extractClockTimeInZone(instant, "Asia/Tokyo"), "03:00");
});

test("flightArrivalDayOffset flags an overnight flight that lands the next local day", () => {
  // Departs London 21:15 local (UTC), lands Reykjavik 00:30 local the same
  // UTC clock hour range next day — one calendar day later in both zones.
  const departure = "2026-04-01T21:15:00Z";
  const arrival = "2026-04-02T00:30:00Z";
  assert.equal(flightArrivalDayOffset(departure, "Europe/London", arrival, "Atlantic/Reykjavik"), 1);
});

test("flightArrivalDayOffset is 0 for a same-day flight and null when a time is missing", () => {
  // Well clear of Sydney's UTC+10/+11 midnight crossing either way.
  assert.equal(flightArrivalDayOffset("2026-04-01T01:00:00Z", "Australia/Sydney", "2026-04-01T05:00:00Z", "Australia/Sydney"), 0);
  assert.equal(flightArrivalDayOffset(null, "Australia/Sydney", "2026-04-01T13:00:00Z", "Australia/Sydney"), null);
});

test("the AI day summary loads into the story textarea, not the day meta", () => {
  const pkg: CreatorPackageDetail = {
    package_id: "pkg-2",
    title: "Paris Long Weekend",
    duration_days: 1,
    days: [{ id: "d1", day_number: 1, title: "Arrive", summary: "Check in and wander." }],
    hotels: [],
    activities: [],
    flights: [],
  };
  const [day] = buildDaysFromPackage(pkg);
  assert.equal(day.title, "Arrive");
  assert.equal(day.story, "Check in and wander.");
  assert.equal(day.meta, "");
});

test("relative day placement and authored details survive a package reload", () => {
  const pkg = {
    package_id: "pkg-relative",
    title: "Date-flexible Kyoto",
    duration_days: 3,
    destination_city: "Kyoto",
    destination_country: "Japan",
    media: [
      { media_id: "day-photo", url: "https://cdn.example.com/day.jpg", caption: "Day view" },
      { media_id: "item-photo", url: "https://cdn.example.com/item.jpg", caption: "Tea ceremony" },
    ],
    days: [
      { id: "d1", day_number: 1, title: "Arrival", summary: "Settle in", meta: "Easy start", media_ids: ["day-photo"] },
      { id: "d2", day_number: 2, title: "Traditions", summary: "Meet local makers", meta: "Culture" },
      { id: "d3", day_number: 3, title: "Departure", summary: null, meta: null },
    ],
    flights: [{
      flight_id: "flight-1",
      origin_iata: "SYD",
      destination_iata: "KIX",
      airline: "Example Air",
      flight_number: "EA1",
      departure_time: "08:30",
      arrival_time: "17:00",
      duration_minutes: 570,
      cabin_class: "economy",
      price_aud: 800,
      day_number: 1,
      sequence_order: 1,
      notes: "Morning departure",
      media_ids: [],
      source_id: "catalog-flight",
    }],
    hotels: [{
      hotel_id: "hotel-1",
      hotel_name: "Kyoto House",
      star_rating: 4,
      city: "Kyoto",
      address: "Gion",
      price_per_night_aud: 250,
      room_type: "Twin",
      check_in_day: 1,
      check_out_day: 3,
      nights: 2,
      sequence_order: 2,
      notes: "Quiet room",
      media_ids: [],
      source_id: "catalog-hotel",
    }],
    activities: [{
      activity_id: "activity-1",
      sequence_order: 1,
      activity_name: "Tea ceremony",
      city: "Kyoto",
      duration_hours: 1.5,
      price_aud: 90,
      description: "Hosted by a tea master",
      booking_required: true,
      day_number: 2,
      start_time: "14:30",
      category: "Culture",
      address: "Gion district",
      notes: "Wear comfortable socks",
      media_ids: ["item-photo"],
      source_id: "catalog-activity",
    }],
  } as unknown as CreatorPackageDetail;

  const days = buildDaysFromPackage(pkg);

  assert.equal(days[0].meta, "Easy start");
  assert.deepEqual(days[0].photos, [{ src: "https://cdn.example.com/day.jpg", alt: "Day view", media_id: "day-photo" }]);
  assert.equal(days[0].date, null);
  assert.deepEqual(days[0].items.map((item) => item.type), ["FLIGHT", "HOTEL"]);
  assert.equal(days[1].items[0].time, "14:30");
  assert.equal(days[1].items[0].category, "Culture");
  assert.equal(days[1].items[0].address, "Gion district");
  assert.equal(days[1].items[0].notes, "Wear comfortable socks");
  assert.deepEqual(days[1].items[0].photos, [{ src: "https://cdn.example.com/item.jpg", alt: "Tea ceremony", media_id: "item-photo" }]);
});

test("package updates use relative days and never manufacture calendar dates", () => {
  const pkg = {
    package_id: "pkg-relative",
    title: "Date-flexible Kyoto",
    duration_days: 2,
    destination_city: "Kyoto",
    destination_country: "Japan",
    description: "A flexible itinerary",
    max_group_size: 8,
    tags: ["culture"],
    flights: [], hotels: [], activities: [], days: [],
  } as CreatorPackageDetail;
  const days: BuilderDay[] = [
    {
      id: "day-1", day: 1, title: "Arrival", meta: "Easy start", story: "Settle in", date: null,
      photos: [{ src: "https://cdn.example.com/day.jpg", alt: "Day", media_id: "day-media" }],
      items: [{
        id: 1, time: "08:30", type: "FLIGHT", title: "SYD to KIX", price: "$800", icon: "plane", status: "pass",
        originIata: "SYD", destinationIata: "KIX", airline: "Example Air", flightNumber: "EA1",
        arrivalTime: "17:00", duration: "570", notes: "Morning departure", sourceId: "catalog-flight",
      }, {
        id: 3, time: "Check-in", type: "HOTEL", title: "Kyoto House", price: "$250/night", icon: "hotel", status: "pass",
        hotelName: "Kyoto House", starRating: 4, city: "Kyoto", address: "Gion", roomType: "Twin",
        notes: "Quiet room", sourceId: "catalog-hotel", stayGroupId: "stay-1", stayMarker: "check-in",
      }],
    },
    {
      id: "day-2", day: 2, title: "Traditions", meta: "Culture", story: "Meet local makers", date: null, photos: [],
      items: [{
        id: 2, time: "14:30", type: "ACTIVITY", title: "Tea ceremony", price: "$90", icon: "star", status: "pass",
        city: "Kyoto", address: "Gion district", duration: "90", category: "Culture", notes: "Wear comfortable socks",
        photos: [{ src: "https://cdn.example.com/item.jpg", alt: "Tea ceremony", media_id: "item-media" }],
        sourceId: "catalog-activity",
      }, {
        id: 4, time: "Check-out", type: "HOTEL", title: "Kyoto House (Check-out)", price: "$250/night", icon: "hotel", status: "pass",
        hotelName: "Kyoto House", starRating: 4, city: "Kyoto", address: "Gion", roomType: "Twin",
        notes: "Quiet room", sourceId: "catalog-hotel", stayGroupId: "stay-1", stayMarker: "check-out",
      }],
    },
  ];

  const update = buildPackageUpdate(pkg, days, "Date-flexible Kyoto");

  assert.deepEqual(update.days?.[0], {
    day_number: 1,
    title: "Arrival",
    summary: "Settle in",
    meta: "Easy start",
    media_ids: ["day-media"],
  });
  assert.deepEqual(update.flights?.[0], {
    origin_iata: "SYD",
    destination_iata: "KIX",
    airline: "Example Air",
    flight_number: "EA1",
    departure_time: "08:30",
    arrival_time: "17:00",
    duration_minutes: 570,
    cabin_class: null,
    price_aud: 800,
    day_number: 1,
    sequence_order: 1,
    notes: "Morning departure",
    media_ids: [],
    source_id: "catalog-flight",
  });
  assert.deepEqual(update.activities?.[0], {
    activity_name: "Tea ceremony",
    city: "Kyoto",
    duration_hours: 1.5,
    price_aud: 90,
    description: "Wear comfortable socks",
    notes: "Wear comfortable socks",
    booking_required: null,
    day_number: 2,
    sequence_order: 1,
    start_time: "14:30",
    category: "Culture",
    address: "Gion district",
    media_ids: ["item-media"],
    source_id: "catalog-activity",
  });
  assert.deepEqual(update.hotels?.[0], {
    hotel_name: "Kyoto House",
    star_rating: 4,
    city: "Kyoto",
    address: "Gion",
    price_per_night_aud: 250,
    room_type: "Twin",
    check_in_day: 1,
    check_out_day: 2,
    nights: 1,
    sequence_order: 2,
    notes: "Quiet room",
    media_ids: [],
    source_id: "catalog-hotel",
  });
  assert.equal("activity_date" in update.activities![0], false);
  assert.equal("departure_datetime" in update.flights![0], false);
  assert.equal("check_in_date" in update.hotels![0], false);
  assert.equal("check_out_date" in update.hotels![0], false);
});

test("daySubtitle clips the story with an ellipsis and falls back to meta", () => {
  const day = { id: "d", day: 1, title: "T", meta: "Add your first stop", items: [], story: "", photos: [] };
  assert.equal(daySubtitle(day), "Add your first stop");
  const long = { ...day, story: "x".repeat(60) };
  assert.equal(daySubtitle(long), `${"x".repeat(48)}…`);
  const short = { ...day, story: "Short story" };
  assert.equal(daySubtitle(short), "Short story");
});

const stayRow = (id: number, marker?: TimelineItem["stayMarker"]): TimelineItem => ({
  ...firstItem,
  id,
  type: "HOTEL",
  title: "Shibuya Inn",
  price: "$100/night",
  icon: "hotel",
  stayGroupId: "stay-1",
  stayMarker: marker,
});

test("removeDay recomputes a hotel stay's night counts and check-in marker after the first day is deleted", () => {
  // A 4-day/3-night stay (day-1..day-4): deleting day-1 leaves a 2-night stay
  // over 3 days, so the remaining rows must be relabeled "Night 1 of 2" /
  // "Night 2 of 2" / "(Check-out)" and day-2 must pick up the check-in marker.
  const days: BuilderDay[] = [
    { id: "day-1", day: 1, title: "In", meta: "", items: [stayRow(1, "check-in")], story: "", photos: [] },
    { id: "day-2", day: 2, title: "Stay", meta: "", items: [{ ...stayRow(2), title: "Shibuya Inn (Night 1 of 3)" }], story: "", photos: [] },
    { id: "day-3", day: 3, title: "Stay", meta: "", items: [{ ...stayRow(3), title: "Shibuya Inn (Night 2 of 3)" }], story: "", photos: [] },
    { id: "day-4", day: 4, title: "Out", meta: "", items: [{ ...stayRow(4, "check-out"), title: "Shibuya Inn (Check-out)" }], story: "", photos: [] },
  ];

  const result = removeDay(days, "day-1");

  assert.equal(result.length, 3);
  assert.equal(result[0].items[0].stayMarker, "check-in");
  assert.equal(result[0].items[0].title, "Shibuya Inn (Night 1 of 2)");
  assert.equal(result[1].items[0].stayMarker, undefined);
  assert.equal(result[1].items[0].title, "Shibuya Inn (Night 2 of 2)");
  assert.equal(result[2].items[0].stayMarker, "check-out");
  assert.equal(result[2].items[0].title, "Shibuya Inn (Check-out)");
});

test("recomputeHotelStayLabels collapses a 2-night stay to a single night when a middle day is deleted", () => {
  const days: BuilderDay[] = [
    { id: "day-1", day: 1, title: "In", meta: "", items: [stayRow(1, "check-in")], story: "", photos: [] },
    { id: "day-3", day: 2, title: "Out", meta: "", items: [stayRow(3, "check-out")], story: "", photos: [] },
  ];

  const result = recomputeHotelStayLabels(days);

  assert.equal(result[0].items[0].title, "Shibuya Inn");
  assert.equal(result[0].items[0].stayMarker, "check-in");
  assert.equal(result[1].items[0].title, "Shibuya Inn (Check-out)");
});

test("recomputeHotelStayLabels leaves non-hotel items and unrelated days untouched", () => {
  const result = recomputeHotelStayLabels(makeDays());
  assert.deepEqual(result, makeDays());
});

test("a 2-night stay costs 2 nights — the check-out row is not billed", () => {
  // buildDaysFromPackage renders nights+1 rows, each carrying the per-night
  // price; summing every row would bill 3 nights for a 2-night stay.
  const days: BuilderDay[] = [
    { id: "day-1", day: 1, title: "In", meta: "", items: [stayRow(1, "check-in")], story: "", photos: [] },
    { id: "day-2", day: 2, title: "Stay", meta: "", items: [stayRow(2)], story: "", photos: [] },
    { id: "day-3", day: 3, title: "Out", meta: "", items: [stayRow(3, "check-out")], story: "", photos: [] },
  ];

  assert.equal(computePackagePrice(days), 200);
});

test("computePackagePrice parses a plain dollar price and treats Free/blank as 0", () => {
  const days: BuilderDay[] = [
    {
      id: "day-1",
      day: 1,
      title: "Mixed",
      meta: "",
      items: [
        { ...firstItem, id: 1, price: "$144" },
        { ...firstItem, id: 2, price: "Free" },
        { ...firstItem, id: 3, price: "" },
      ],
      story: "",
      photos: [],
    },
  ];

  assert.equal(computePackagePrice(days), 144);
});

test("computePackagePrice of no days is 0", () => {
  assert.equal(computePackagePrice([]), 0);
});

test("a creator pick's price never counts toward the package total", () => {
  const days: BuilderDay[] = [
    {
      id: "day-1",
      day: 1,
      title: "Mixed",
      meta: "",
      items: [
        { ...firstItem, id: 1, price: "$50" },
        { ...firstItem, id: 2, type: "CREATOR PICK", price: "$999" },
      ],
      story: "",
      photos: [],
    },
  ];

  assert.equal(computePackagePrice(days), 50);
});

test("timezoneForIata knows Sydney and Tokyo, and falls back to Sydney for an unknown code", () => {
  assert.equal(timezoneForIata("SYD"), "Australia/Sydney");
  assert.equal(timezoneForIata("NRT"), "Asia/Tokyo");
  assert.equal(timezoneForIata("XXX"), "Australia/Sydney");
  assert.equal(timezoneForIata(null), "Australia/Sydney");
});

test("flightDurationMinutes computes real elapsed minutes across a date change", () => {
  assert.equal(flightDurationMinutes("2026-07-12T20:00:00Z", "2026-07-13T05:00:00Z"), 540);
});

test("flightDurationMinutes is undefined for missing or non-positive spans", () => {
  assert.equal(flightDurationMinutes(null, "2026-07-13T05:00:00Z"), undefined);
  assert.equal(flightDurationMinutes("2026-07-13T05:00:00Z", "2026-07-13T05:00:00Z"), undefined);
  assert.equal(flightDurationMinutes("2026-07-13T05:00:00Z", "2026-07-12T20:00:00Z"), undefined);
});

test("buildDaysFromPackage carries a flight's real duration onto its timeline item", () => {
  const pkg: CreatorPackageDetail = {
    package_id: "pkg-3",
    title: "Trip",
    duration_days: 2,
    days: [],
    hotels: [],
    activities: [],
    flights: [{
      flight_id: "fl-1",
      airline: "Qantas",
      flight_number: "QF25",
      origin_iata: "SYD",
      destination_iata: "NRT",
      departure_datetime: "2026-07-12T20:00:00Z",
      arrival_datetime: "2026-07-12T21:30:00Z",
      cabin_class: null,
      price_aud: 850,
    }],
  };
  const [day] = buildDaysFromPackage(pkg);
  assert.equal(day.items[0]?.duration, "90");
});

test("formatMinutes renders hours, minutes, or both", () => {
  assert.equal(formatMinutes(150), "2h 30m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(0), "0m");
});

function makeDay(overrides: Partial<BuilderDay> = {}): BuilderDay {
  return { id: "day-1", day: 1, title: "Day 1", meta: "", items: [], story: "", photos: [], ...overrides };
}

test("summarizeDay totals flight minutes, counts activities, and names the hotel", () => {
  const day = makeDay({
    items: [
      { ...firstItem, id: 1, type: "FLIGHT", title: "SYD to NRT", duration: "90" },
      { ...firstItem, id: 2, type: "ACTIVITY", title: "Ramen crawl" },
      { ...firstItem, id: 3, type: "HOTEL", title: "Shibuya Inn (Check-in)", stayMarker: "check-in" },
    ],
  });

  assert.deepEqual(summarizeDay(day), { flightMinutes: 90, activityCount: 1, hotelName: "Shibuya Inn" });
});

test("summarizeDay strips the check-in/out/night suffix from the hotel name", () => {
  const day = makeDay({ items: [{ ...firstItem, id: 1, type: "HOTEL", title: "Shibuya Inn (Night 2 of 3)" }] });
  assert.equal(summarizeDay(day).hotelName, "Shibuya Inn");
});

test("summarizeDay reports a day with nothing planned yet", () => {
  assert.deepEqual(summarizeDay(makeDay()), { flightMinutes: 0, activityCount: 0, hotelName: null });
});

test("summarizePackageComponents counts a multi-night stay as one hotel, not one per night", () => {
  const days: BuilderDay[] = [
    makeDay({ id: "day-1", items: [stayRow(1, "check-in"), { ...firstItem, id: 4, type: "FLIGHT", title: "Flight" }] }),
    makeDay({ id: "day-2", day: 2, items: [stayRow(2), { ...firstItem, id: 5, type: "ACTIVITY", title: "Museum" }] }),
    makeDay({ id: "day-3", day: 3, items: [stayRow(3, "check-out")] }),
  ];

  assert.deepEqual(summarizePackageComponents(days), { flightCount: 1, hotelCount: 1, activityCount: 1 });
});

test("summarizePackageComponents of no days is all zero", () => {
  assert.deepEqual(summarizePackageComponents([]), { flightCount: 0, hotelCount: 0, activityCount: 0 });
});
