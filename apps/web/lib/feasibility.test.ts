import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_RULES,
  buildSystemPrompt,
  buildUserPrompt,
  checkPackagePhotos,
  runCodeChecks,
} from "./feasibility";

function day(dayNumber: number, activities: any[], flights: any[] = [], overrides: Record<string, any> = {}) {
  return { day_number: dayNumber, activities, flights, has_accommodation: true, ...overrides };
}

function flight(arrivalTime: string, flightType: "domestic" | "international", title = "Flight") {
  return { arrival_time: arrivalTime, flight_type: flightType, title };
}

function activity(name: string, overrides: Record<string, any> = {}) {
  return {
    activity_name: name,
    slot: "Morning",
    start_time: "09:00",
    duration_hours: 1,
    description: "desc",
    price: "$0",
    ...overrides,
  };
}

test("duplicate activity across days is a soft warning, not a hard error", () => {
  const days = [
    day(1, [activity("Senso-ji Temple")]),
    day(2, [activity("Senso-ji Temple")]),
  ];

  const { hard, soft } = runCodeChecks(days);

  assert.ok(
    hard.every((issue) => issue.error_code !== "DUPLICATE_ACTIVITY"),
    "duplicate activity must never be a hard error"
  );
  const warning = soft.find((issue) => issue.error_code === "DUPLICATE_ACTIVITY");
  assert.ok(warning, "expected a DUPLICATE_ACTIVITY soft warning");
  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.affected_item, "Senso-ji Temple");
});

test("duplicate detection is case/whitespace-insensitive and trip-wide", () => {
  const days = [
    day(1, [activity("  Shibuya Crossing  ")]),
    day(3, [activity("shibuya crossing")]),
  ];

  const { soft } = runCodeChecks(days);
  const warning = soft.find((issue) => issue.error_code === "DUPLICATE_ACTIVITY");
  assert.ok(warning, "expected duplicate to be caught across non-adjacent days regardless of case/whitespace");
});

test("no warning when all activity names are distinct", () => {
  const days = [day(1, [activity("Tokyo Tower"), activity("Meiji Shrine")])];

  const { soft } = runCodeChecks(days);
  assert.ok(soft.every((issue) => issue.error_code !== "DUPLICATE_ACTIVITY"));
});

test("R19: an activity with a corrupted start time is a hard error", () => {
  const days = [day(4, [activity("Historic Madrid City Walking Tour", { start_time: "NaN:NaN" })])];

  const { hard } = runCodeChecks(days);
  const issue = hard.find((i) => i.error_code === "INVALID_START_TIME");
  assert.ok(issue, "expected an INVALID_START_TIME hard error");
  assert.equal(issue?.severity, "error");
  assert.equal(issue?.affected_item, "Historic Madrid City Walking Tour");
});

test("R19: a missing start time is also a hard error", () => {
  const days = [day(1, [activity("Prado Museum Visit", { start_time: undefined })])];

  const { hard } = runCodeChecks(days);
  assert.ok(hard.some((i) => i.error_code === "INVALID_START_TIME"));
});

test("R19: an out-of-range clock time (e.g. 25:99) is a hard error", () => {
  const days = [day(1, [activity("Late Night Tapas", { start_time: "25:99" })])];

  const { hard } = runCodeChecks(days);
  assert.ok(hard.some((i) => i.error_code === "INVALID_START_TIME"));
});

test("R19: a normal start time is not flagged", () => {
  const days = [day(1, [activity("Prado Museum Visit", { start_time: "09:30" })])];

  const { hard } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "INVALID_START_TIME"));
});

test("R7: a single long activity alone in a slot is not a hard TIME_OVERLAP error", () => {
  // A day tour / gallery pass that alone runs longer than the slot's nominal cap isn't a
  // scheduling conflict — it's just a long activity.
  const days = [day(1, [activity("Denpasar Museum & Gallery Pass", { duration_hours: 4.4 })])];

  const { hard } = runCodeChecks(days);
  assert.ok(hard.every((issue) => issue.error_code !== "TIME_OVERLAP"));
});

test("a long activity alongside another is no longer flagged — catalog durations can't be changed", () => {
  // Regression: "Bangkok Museum & Gallery Pass — Evening Edition" (4.3 h, from the
  // catalog) was warned as unusually long, though the creator can't edit its duration.
  const days = [
    day(1, [
      activity("Denpasar Museum & Gallery Pass", { duration_hours: 4.4 }),
      activity("Sunset Beach Walk", { start_time: "15:00", duration_hours: 1 }),
    ]),
  ];
  const { soft } = runCodeChecks(days);
  assert.ok(soft.every((issue) => issue.error_code !== "LONG_ACTIVITY"));
});

test("activities in the same rough time window that don't actually overlap are fine", () => {
  // Regression: a cooking class 13:00–16:18 and a museum pass 17:00–21:18, both tagged
  // "Afternoon", were blocked for exceeding a ~4 h "Afternoon window".
  const days = [
    day(1, [
      activity("Bangkok Cooking Class", { slot: "Afternoon", start_time: "13:00", duration_hours: 3.3 }),
      activity("Bangkok Museum & Gallery Pass", { slot: "Afternoon", start_time: "17:00", duration_hours: 4.3 }),
    ]),
  ];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((issue) => issue.error_code !== "TIME_OVERLAP"));
  assert.ok(soft.every((issue) => issue.error_code !== "SLOT_DENSITY"));
});

test("two activities whose real times overlap are a hard error naming both times", () => {
  const days = [
    day(1, [
      activity("Sunrise Yoga", { start_time: "06:00", duration_hours: 1.5 }),
      activity("Kayak Tour", { start_time: "07:00", duration_hours: 3.3 }),
    ]),
  ];
  const overlap = runCodeChecks(days).hard.filter((issue) => issue.error_code === "TIME_OVERLAP");
  assert.equal(overlap.length, 1);
  assert.match(overlap[0].message, /Sunrise Yoga.*07:30/);
  assert.match(overlap[0].message, /Kayak Tour.*07:00/);
});

test("R7: two activities starting at the same time is still a hard TIME_OVERLAP error", () => {
  const days = [
    day(1, [
      activity("Museum Tour", { duration_hours: 2.5 }),
      activity("Gallery Walk", { duration_hours: 2 }),
    ]),
  ];

  const { hard } = runCodeChecks(days);
  assert.ok(hard.some((issue) => issue.error_code === "TIME_OVERLAP"));
});

test("R16: a stop with no price set is a hard error", () => {
  const days = [day(1, [activity("Free Walking Tour", { price: undefined })])];
  const { hard } = runCodeChecks(days);
  assert.ok(hard.some((issue) => issue.error_code === "MISSING_PRICE"));
});

test("R16: a free stop priced at $0 is NOT flagged — 0 is a valid price", () => {
  const days = [day(1, [activity("Free Walking Tour", { price: "$0" })])];
  const { hard } = runCodeChecks(days);
  assert.ok(hard.every((issue) => issue.error_code !== "MISSING_PRICE"));
});

test("R9: an empty middle day is a suggestion asking to confirm it, e.g. as a free day", () => {
  const days = [
    day(1, [activity("Arrival Transfer")]),
    day(2, []),
    day(3, [activity("Departure Transfer")]),
  ];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "EMPTY_DAY"), "an empty middle day must not block submission");
  const issue = soft.find((i) => i.error_code === "EMPTY_DAY");
  assert.ok(issue, "expected an EMPTY_DAY suggestion for the empty middle day");
  assert.equal(issue?.severity, "warning");
  assert.equal(issue?.field, "Day 2");
  assert.match(issue!.message, /confirm this is intentional/);
  assert.match(issue!.message, /free day.*day summary/);
});

test("R9: an empty first day is a soft warning, not a hard block — arrival days often have no activity", () => {
  const days = [day(1, []), day(2, [activity("City Walking Tour")])];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "EMPTY_DAY"), "empty first day must not be a hard error");
  const issue = soft.find((i) => i.error_code === "EMPTY_DAY");
  assert.ok(issue, "expected an EMPTY_DAY soft warning for the empty first day");
  assert.equal(issue?.severity, "warning");
  assert.equal(issue?.field, "Day 1");
});

test("R9: an empty last day is a soft warning, not a hard block — departure days often have no activity", () => {
  const days = [day(1, [activity("City Walking Tour")]), day(2, [])];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "EMPTY_DAY"), "empty last day must not be a hard error");
  const issue = soft.find((i) => i.error_code === "EMPTY_DAY");
  assert.ok(issue, "expected an EMPTY_DAY soft warning for the empty last day");
  assert.equal(issue?.severity, "warning");
  assert.equal(issue?.field, "Day 2");
});

test("R9: a single-day trip that's empty is still first AND last — stays a soft warning", () => {
  const days = [day(1, [])];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "EMPTY_DAY"));
  assert.ok(soft.some((i) => i.error_code === "EMPTY_DAY"));
});

test("R9: last-day classification is based on day_number vs. day count, so it tracks a renumbered trip after a day is deleted", () => {
  // Simulates deleting day 2 from a 3-day trip: removeDay() re-numbers the remaining
  // days 1..N, so what used to be "day 3" is now "day 2" — the new last day — and an
  // empty day there must be treated as the (soft) empty-last-day case, not a hard error.
  const days = [day(1, [activity("Arrival Transfer")]), day(2, [])];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "EMPTY_DAY"));
  assert.ok(soft.some((i) => i.error_code === "EMPTY_DAY" && i.field === "Day 2"));
});

test("R17: a day with no accommodation is a hard error naming that specific day", () => {
  const days = [
    day(1, [activity("City Walking Tour")], [], { has_accommodation: true }),
    day(2, [activity("Beach Day")], [], { has_accommodation: false }),
  ];
  const { hard } = runCodeChecks(days);
  const issue = hard.find((i) => i.error_code === "MISSING_ACCOMMODATION");
  assert.ok(issue, "expected a MISSING_ACCOMMODATION error");
  assert.equal(issue?.field, "Day 2");
  assert.match(issue?.message ?? "", /Day 2 has no accommodation/);
});

test("R17: a day with accommodation is not flagged", () => {
  const days = [day(1, [activity("City Walking Tour")], [], { has_accommodation: true })];
  const { hard } = runCodeChecks(days);
  assert.ok(hard.every((issue) => issue.error_code !== "MISSING_ACCOMMODATION"));
});

test("R18: a package with zero photos anywhere is a hard error", () => {
  const issue = checkPackagePhotos({ photo_count: 0 });
  assert.equal(issue?.error_code, "MISSING_PHOTOS");
});

test("R18: a package with at least one photo passes", () => {
  const issue = checkPackagePhotos({ photo_count: 1 });
  assert.equal(issue, null);
});

test("slang costs more writing marks than a typo, and a trip name the activities don't match costs completeness", () => {
  // Regression: "u gonna luv dis place nxt lvl fr fr" only cost 0.1 (grammar 0.9), and a
  // "Beach & Relaxation Tour" of city culture activities cost nothing.
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /subtract 0\.3 for each[^.]*slang or text-speak/);
  assert.match(prompt, /subtract 0\.3 if the trip name/);
  const r23 = FALLBACK_RULES.find((rule) => rule.rule_code === "R23");
  assert.equal(r23?.rule_name, "Trip Name Match");
  assert.match(r23!.rule_description, /SOFT WARNING/);
  assert.match(r23!.rule_description, /Never flag a general name or a broad theme/, "\"Cultural Exploration\" was wrongly flagged");
  assert.match(r23!.rule_description, /Never compare the number of days in the name/, "a \"5 Day\" trip was flagged for its day count");
});

test("buildSystemPrompt renders the supplied rule list", () => {
  const prompt = buildSystemPrompt([
    { rule_code: "R14", rule_name: "Similar Duplicate Activity", rule_description: "Test description." },
  ]);

  assert.match(prompt, /R14 \(Similar Duplicate Activity\): Test description\./);
});

test("buildSystemPrompt asks the AI to recheck for profanity missed by a static filter", () => {
  const prompt = buildSystemPrompt(FALLBACK_RULES);

  assert.match(prompt, /re-check the ENTIRE package text/i);
  assert.match(prompt, /"contains_profanity"/);
  assert.match(prompt, /"profanity_evidence"/);
});

test("buildSystemPrompt tells the AI flight data is read-only and arrival-only by design, not a defect", () => {
  // Regression: the AI flagged a departure-day flight showing only its arrival time
  // (SYD) as "ambiguous" and unhelpful for planning — but creators can only select
  // from a fixed flight inventory, they can't add departure-time data that doesn't
  // exist in the catalog, so that complaint was never actionable.
  const prompt = buildSystemPrompt(FALLBACK_RULES);

  assert.match(prompt, /creator\s+cannot edit a flight's details/i);
  assert.match(prompt, /Do NOT flag this as ambiguous/);
});

test("buildSystemPrompt caps AI hard errors to R12 only — everything else must be a soft warning", () => {
  // Regression: R4/R6/R8/R11 had no severity guidance at all, so the AI was free to
  // hard-block on any judgment call, including ones about read-only flight data the
  // creator has no way to fix.
  const prompt = buildSystemPrompt(FALLBACK_RULES);

  assert.match(prompt, /Only flag something as a hard error[\s\S]*if the rule below explicitly says to/i);
});

test("buildUserPrompt describes a return/departure flight without the word ARRIVAL sitting next to the wrong city", () => {
  // Regression: the old "[FLIGHT ARRIVAL @time] DPS to SYD" phrasing read as if the
  // flight arrives INTO that day's own location (Denpasar), even though arrival_time
  // is always the landing time at the flight's actual destination (Sydney here) —
  // which confused the AI into flagging a real return flight as a factual error.
  const days = [
    {
      day_number: 4,
      summary: "",
      flights: [{ arrival_time: "20:06", flight_type: "international", title: "DPS to SYD" }],
      activities: [],
    },
  ];
  const prompt = buildUserPrompt({}, days);

  assert.match(prompt, /\[FLIGHT\] DPS to SYD \(international\) — arrives 20:06/);
  assert.doesNotMatch(prompt, /FLIGHT ARRIVAL/);
});

test("buildSystemPrompt tells the AI never to flag transfer time, with no 'unless it's actually short' carve-out", () => {
  // Regression: the old wording said "do NOT flag... EXCEPT if the gap is shorter
  // than the threshold" — but that's exactly when the deterministic R2 check ALSO
  // fires, so the carve-out guaranteed a duplicate every time R2 caught something.
  const prompt = buildSystemPrompt(FALLBACK_RULES);

  assert.match(prompt, /EVEN IF that gap looks too short/);
  assert.doesNotMatch(prompt, /Only raise a post-landing transfer concern/);
});

test("buildUserPrompt includes a day's summary/story text so the AI recheck can see it too", () => {
  const days = [
    { day_number: 1, summary: "Loved the shitty little cafe on the corner", flights: [], activities: [] },
  ];
  const prompt = buildUserPrompt({}, days);

  assert.match(prompt, /\[DAY SUMMARY\] Loved the shitty little cafe on the corner/);
});

test("FALLBACK_RULES still covers every contextual rule code previously hardcoded", () => {
  const codes = FALLBACK_RULES.map((r) => r.rule_code);
  // R8 (group size) was removed: the editor has no group-size input, so the AI was
  // judging "Private Edition" activities against a group size it never had.
  // R23 (Trip Name Match) was added after these.
  assert.deepEqual(codes, ["R3", "R4", "R6", "R10", "R11", "R12", "R14", "R15", "R23"]);
});

function longDayCodes(days: any[]) {
  const { hard, soft } = runCodeChecks(days);
  return {
    hard: hard.filter((i) => i.error_code === "LONG_TRAVEL_DAY"),
    soft: soft.filter((i) => i.error_code === "LONG_TRAVEL_DAY"),
  };
}

test("arrival day with more than 6 hours of activities warns that travellers may be tired, without blocking", () => {
  const days = [
    day(1, [activity("Bike tour", { duration_hours: 4 }), activity("Cooking class", { start_time: "14:00", duration_hours: 3.5 })]),
    day(2, [activity("Museum")]),
    day(3, [activity("Market")]),
  ];
  const { hard, soft } = longDayCodes(days);
  assert.equal(hard.length, 0);
  assert.equal(soft.length, 1);
  assert.equal(soft[0].severity, "warning");
  assert.equal(soft[0].field, "Day 1");
  assert.match(soft[0].message, /7\.5 hours/);
  assert.match(soft[0].message, /arrival day/);
});

test("departure day with more than 6 hours of activities also warns", () => {
  const days = [day(1, [activity("Museum")]), day(2, [activity("Day trip", { duration_hours: 6.5 })])];
  const { soft } = longDayCodes(days);
  assert.equal(soft.length, 1);
  assert.equal(soft[0].field, "Day 2");
  assert.match(soft[0].message, /departure day/);
});

test("several activities on the first or last day are fine when the total stays within 6 hours", () => {
  // Regression: an AI rule capped first/last days at one activity, flagging an ordinary
  // two-activity arrival day even when it was only a few hours long.
  const days = [
    day(1, [activity("Bike tour", { duration_hours: 3 }), activity("Cooking class", { start_time: "14:00", duration_hours: 3 })]),
    day(2, [activity("Museum")]),
    day(3, [activity("A", { duration_hours: 2 }), activity("B", { duration_hours: 2 }), activity("C", { duration_hours: 2 })]),
  ];
  assert.equal(longDayCodes(days).soft.length, 0);
});

test("a long middle day is left to the normal 10-hour rule, not the arrival/departure warning", () => {
  const days = [day(1, [activity("A")]), day(2, [activity("Safari", { duration_hours: 8 })]), day(3, [activity("B")])];
  assert.equal(longDayCodes(days).soft.length, 0);
});

test("buildUserPrompt no longer sends a group size to the AI", () => {
  const prompt = buildUserPrompt({ group_size: 4 }, []);
  assert.doesNotMatch(prompt, /Group Size/i);
});

function returnFlight(departureTime: string, flightType: "domestic" | "international" = "international") {
  return { departure_time: departureTime, arrival_time: "23:59", flight_type: flightType, title: "BKK to SYD" };
}

function returnCodes(days: any[]) {
  return runCodeChecks(days).hard.filter((i) => i.error_code === "SHORT_DEPARTURE_BUFFER");
}

test("an activity ending less than 3 hours before an international return flight is a hard error", () => {
  const days = [
    day(1, [activity("Temple")], [{ ...flight("10:00", "international", "SYD to BKK"), departure_time: "06:00" }]),
    day(2, [activity("Market", { start_time: "13:00", duration_hours: 2 })], [returnFlight("17:00")]),
  ];
  const errors = returnCodes(days);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "Day 2");
  assert.match(errors[0].message, /17:00/);
  assert.match(errors[0].message, /3 hours/);
});

test("an activity finishing with enough time before the return flight is fine", () => {
  const days = [
    day(1, [activity("Temple")], [{ ...flight("10:00", "international", "SYD to BKK"), departure_time: "06:00" }]),
    day(2, [activity("Market", { start_time: "10:00", duration_hours: 2 })], [returnFlight("17:00")]),
  ];
  assert.equal(returnCodes(days).length, 0);
});

test("a domestic return flight needs 2 hours, not 3", () => {
  const days = [
    day(1, [activity("A")], [{ ...flight("10:00", "domestic", "SYD to MEL"), departure_time: "08:30" }]),
    day(2, [activity("B", { start_time: "13:00", duration_hours: 2 })], [returnFlight("17:30", "domestic")]),
  ];
  assert.equal(returnCodes(days).length, 0);
});

test("a single full-day tour over 10 hours is allowed", () => {
  const days = [day(1, [activity("Mt Fuji day tour", { start_time: "07:00", duration_hours: 12 })]), day(2, [activity("A")]), day(3, [activity("B")])];
  const packed = runCodeChecks(days).hard.filter((i) => i.error_code === "SCHEDULE_TOO_PACKED");
  assert.equal(packed.length, 0);
});

test("several activities adding up to more than 10 hours are a suggestion, not a block", () => {
  const days = [
    day(1, [activity("A")]),
    day(2, [activity("Tour", { duration_hours: 8 }), activity("Show", { start_time: "19:00", duration_hours: 3 })]),
    day(3, [activity("B")]),
  ];
  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "SCHEDULE_TOO_PACKED"), "a long day must not block submission");
  const packed = soft.filter((i) => i.error_code === "SCHEDULE_TOO_PACKED");
  assert.equal(packed.length, 1);
  assert.equal(packed[0].severity, "warning");
  assert.match(packed[0].message, /Day 2 has 11\.0 hours of activities/);
});

test("the AI is told places in the same city are never too far apart, and how to word a travel-time issue", () => {
  // Regression: two activities both in Bangkok were flagged as too far apart to be possible.
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /same city[^.]*never too far/i);
  assert.match(prompt, /Not enough time to get from "<first activity>" to "<second activity>"/);
});

test("R12 and R10 wording only objects to genuinely short gaps or out-of-city trips", () => {
  const r12 = FALLBACK_RULES.find((r) => r.rule_code === "R12")!.rule_description;
  const r10 = FALLBACK_RULES.find((r) => r.rule_code === "R10")!.rule_description;
  assert.match(r12, /Not enough time to get from/);
  assert.match(r12, /realistic/i);
  assert.match(r10, /Never flag activities that are all in the same city/);
});


const BKK_LANDING = { day_number: 1, time: "18:31", flight_type: "international", title: "SYD to BKK" };

test("R2: the first activity less than 90 min after an international landing is a hard error", () => {
  const days = [day(1, [activity("Night Market", { start_time: "20:00" })]), day(2, [activity("Temple")])];
  const short = runCodeChecks(days, BKK_LANDING).hard.filter((i) => i.error_code === "SHORT_TRANSFER");
  assert.equal(short.length, 1);
  assert.match(short[0].message, /18:31/);
  assert.match(short[0].action, /20:01/);
});

test("R2: a first activity a full buffer after landing is fine", () => {
  const days = [day(1, [activity("Night Market", { start_time: "20:01" })]), day(2, [activity("Temple")])];
  assert.ok(runCodeChecks(days, BKK_LANDING).hard.every((i) => i.error_code !== "SHORT_TRANSFER"));
});

test("R2: an activity starting before the flight lands is a hard error", () => {
  const days = [day(1, [activity("Museum", { start_time: "10:00" })]), day(2, [activity("Temple")])];
  const before = runCodeChecks(days, BKK_LANDING).hard.filter((i) => i.error_code === "ACTIVITY_BEFORE_LANDING");
  assert.equal(before.length, 1);
  assert.match(before[0].message, /Museum/);
});

test("R2: a domestic landing needs 60 min", () => {
  const days = [day(1, [activity("Walk", { start_time: "11:00" })]), day(2, [activity("B")])];
  const landing = { day_number: 1, time: "10:00", flight_type: "domestic", title: "SYD to MEL" };
  assert.ok(runCodeChecks(days, landing).hard.every((i) => i.error_code !== "SHORT_TRANSFER"));
});

test("R22: a gap under 15 minutes between two stops is a hard error", () => {
  const days = [day(1, [
    activity("Grand Palace", { start_time: "09:00", duration_hours: 1 }),
    activity("Wat Arun", { start_time: "10:05", duration_hours: 1 }),
  ])];
  const gap = runCodeChecks(days).hard.filter((i) => i.error_code === "SHORT_ACTIVITY_GAP");
  assert.equal(gap.length, 1);
  assert.match(gap[0].message, /Only 5 min to get from "Grand Palace" to "Wat Arun"/);
});

test("R22: a 15-minute gap is enough, and an overlap is left to R7", () => {
  const ok = [day(1, [activity("A", { start_time: "09:00" }), activity("B", { start_time: "10:15" })])];
  assert.ok(runCodeChecks(ok).hard.every((i) => i.error_code !== "SHORT_ACTIVITY_GAP"));
  const overlap = [day(1, [activity("A", { start_time: "09:00" }), activity("B", { start_time: "09:30" })])];
  assert.ok(runCodeChecks(overlap).hard.every((i) => i.error_code !== "SHORT_ACTIVITY_GAP"));
});

test("the AI may hard-block on R3 and R4, and the prompt says so over any rule wording", () => {
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /R3[^\n]*R4[^\n]*hard error[^\n]*R12[^\n]*soft warning/);
  const r3 = FALLBACK_RULES.find((r) => r.rule_code === "R3")!.rule_description;
  assert.doesNotMatch(r3, /SOFT WARNING, never a hard error/);
});

test("buildUserPrompt marks each activity as catalog or the creator's own pick", () => {
  const days = [{
    day_number: 1, summary: "", flights: [],
    activities: [
      { activity_name: "Madrid Zipline & Ropes Adventure", slot: "Morning", start_time: "09:00", category: "adventure", duration_hours: 2, address: "Calle de Fuencarral", source: "catalog" },
      { activity_name: "My favourite churros spot", slot: "Afternoon", start_time: "15:00", category: "food", duration_hours: 1, address: "", source: "creator" },
    ],
  }];
  const prompt = buildUserPrompt({}, days);
  assert.match(prompt, /\[catalog\] Madrid Zipline/);
  assert.match(prompt, /\[creator pick\] My favourite churros spot/);
});

test("the AI is told not to flag catalog activity details the creator can't edit", () => {
  // Regression: catalog activities were flagged because their address was a city-centre
  // meeting point ("Mountain Hike… city center address"), which the creator can't change.
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /\[catalog\] activities/);
  assert.match(prompt, /meeting or pick-up point/);
  assert.match(prompt, /do not lower any score/i);
});

test("the AI is told exact-name repeats are already reported, so R14 is for differently worded ones", () => {
  assert.match(buildSystemPrompt(FALLBACK_RULES), /exactly the same name/);
});

test("the AI rates each score against the agreed definitions, starting at 1.0 with fixed deductions", () => {
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /=== SCORING ===/);
  assert.match(prompt, /grammar_score[\s\S]*wording/);
  assert.match(prompt, /completeness_score[\s\S]*at least one activity and a hotel[\s\S]*duration/);
  assert.match(prompt, /feasibility_score[\s\S]*after landing[\s\S]*opening/);
  assert.match(prompt, /subtract 0\.1/);
});

test("a catalog activity's description is the creator's editable notes, so the AI still judges it", () => {
  // Catalog cards let the creator edit only the start time and Notes — and Notes is
  // what's sent as the description.
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /cannot edit their name, address or duration/);
  assert.match(prompt, /description[^.]*creator's own editable notes/);
  assert.match(prompt, /every activity's\s+description, including \[catalog\] ones/);
});

test("the output format tells the AI that field must start with the day number", () => {
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.doesNotMatch(prompt, /<day\/slot reference>/);
  assert.match(prompt, /"field": "Day <number>/);
});

test("the AI is told Daily Range only applies to days with two or more activities", () => {
  assert.match(buildSystemPrompt(FALLBACK_RULES), /R10[^\n]*two or more activities/);
});

test("the AI is told opening hours cover starting before a venue opens, not only running past closing", () => {
  // Regression: a museum pass at 06:00 wasn't flagged — the live R3 wording only
  // talked about venues that close early.
  const prompt = buildSystemPrompt(FALLBACK_RULES);
  assert.match(prompt, /R3[^\n]*before the venue usually opens/);
});

test("buildUserPrompt gives each activity its end time and the real gap to the next one", () => {
  // Regression: the AI worked out the gap itself and got 30 min for a 90-minute gap.
  const days = [{
    day_number: 5, summary: "", flights: [],
    activities: [
      { activity_name: "Cooking Class", slot: "Afternoon", start_time: "13:00", category: "food", duration_hours: 3.5, address: "Old Town", source: "catalog" },
      { activity_name: "Evening Walking Tour", slot: "Evening", start_time: "18:00", category: "culture", duration_hours: 2.8, address: "Old Town", source: "catalog" },
    ],
  }];
  const prompt = buildUserPrompt({}, days);
  assert.match(prompt, /Cooking Class[^\n]*ends 16:30[^\n]*90 min until the next activity/);
  assert.match(prompt, /Evening Walking Tour[^\n]*ends 20:48/);
});

test("the AI is told scoring sets only the three numbers, never extra issues", () => {
  assert.match(buildSystemPrompt(FALLBACK_RULES), /SCORING only sets the three scores/);
});

test("the AI is told to report opening hours only when the time is clearly outside them", () => {
  assert.match(buildSystemPrompt(FALLBACK_RULES), /R3[\s\S]*only when the scheduled time is clearly outside/);
});

test("a same-day connection leg on the outbound day is not the return flight", () => {
  // Regression: returnFlight picked the last leg unconditionally when more
  // than one flight existed, so a SYD→HKG→NRT connection on day 1 made every
  // day-1 activity after 13:30 a bogus SHORT_DEPARTURE_BUFFER hard error.
  const days = [
    day(1, [activity("Evening market", { start_time: "19:00", duration_hours: 2 })], [
      { ...flight("08:00", "international", "SYD to HKG"), departure_time: "08:00" },
      { ...flight("20:00", "international", "HKG to NRT"), departure_time: "15:30" },
    ]),
    day(2, [activity("Temple")]),
    day(3, [activity("Market")]),
  ];
  assert.equal(returnCodes(days).length, 0);
});

test("a mid-trip flight still gets the departure buffer on its own day", () => {
  // A leg the traveller must catch mid-trip (day 3 of 5) keeps the check —
  // it only breaks when the last leg shares the outbound's day.
  const days = [
    day(1, [activity("A")], [{ ...flight("10:00", "international", "SYD to BKK"), departure_time: "06:00" }]),
    day(2, [activity("B")]),
    day(3, [activity("Rushed lunch", { start_time: "14:00", duration_hours: 2 })], [returnFlight("17:00")]),
    day(4, [activity("C")]),
    day(5, [activity("D")]),
  ];
  const errors = returnCodes(days);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "Day 3");
});

test("buildUserPrompt sends each activity's whole description, not a cut-off one", () => {
  // Regression: descriptions were cut to 60 characters ("…stunning evening exhibitions a"),
  // so the AI flagged them as incomplete and marked the writing score down.
  const description = "What you'll see: You will see stunning evening exhibitions and contemporary Thai art in a quiet gallery.";
  const days = [{ day_number: 1, summary: "", flights: [], activities: [
    { activity_name: "Bangkok Museum & Gallery Pass — Evening Edition", slot: "Evening", start_time: "18:00", category: "culture", duration_hours: 2, address: "Siam", description, source: "catalog" },
  ] }];
  assert.ok(buildUserPrompt({}, days).includes(`desc: ${description}`));
});

test("R2: activities on days before the arrival flight lands are hard errors too", () => {
  // Regression: SYD to BKK leaves Day 1 at 15:00 and lands Day 2 at 00:31. A Bangkok
  // museum on Day 1 at 09:09 (traveller still in Sydney) wasn't flagged.
  const landing = { day_number: 2, time: "00:31", departure_time: "15:00", flight_type: "international", title: "SYD to BKK" };
  const days = [
    day(1, [activity("Bangkok Museum & Gallery Pass", { start_time: "09:09", duration_hours: 4.3 }), activity("Night market", { start_time: "19:00" })]),
    day(2, [activity("Grand Palace", { start_time: "10:00" })]),
  ];
  const before = runCodeChecks(days, landing).hard.filter((i) => i.error_code === "ACTIVITY_BEFORE_LANDING");
  assert.deepEqual(before.map((i) => i.affected_item), ["Bangkok Museum & Gallery Pass", "Night market"]);
  assert.match(before[0].message, /SYD to BKK leaves at 15:00 and lands at 00:31 the next day \(Day 2\)/);
  assert.equal(before[0].field, "Day 1");
});
