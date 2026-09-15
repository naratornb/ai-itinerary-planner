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

test("R7: a single long activity alone in a slot is not a hard TIME_OVERLAP error", () => {
  // A day tour / gallery pass that alone runs longer than the slot's nominal cap isn't a
  // scheduling conflict — it's just a long activity, already covered by R5c below.
  const days = [day(1, [activity("Denpasar Museum & Gallery Pass", { duration_hours: 4.4 })])];

  const { hard, soft } = runCodeChecks(days);
  assert.ok(hard.every((issue) => issue.error_code !== "TIME_OVERLAP"));
  assert.ok(soft.some((issue) => issue.error_code === "LONG_ACTIVITY"));
});

test("R7: two activities that together exceed the slot cap is still a hard TIME_OVERLAP error", () => {
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
  assert.deepEqual(codes, ["R3", "R4", "R6", "R8", "R10", "R11", "R12", "R14", "R15"]);
});

test("R2: domestic arrival with less than 60 min before first activity is a hard error", () => {
  const days = [
    day(1, [activity("City Walking Tour", { start_time: "10:30" })], [flight("10:00", "domestic")]),
  ];

  const { hard } = runCodeChecks(days);
  const issue = hard.find((i) => i.error_code === "SHORT_TRANSFER");
  assert.ok(issue, "expected a SHORT_TRANSFER hard error (30 min gap < 60 min domestic buffer)");
  assert.equal(issue?.rule, "R2 – Transfer Time");
});

test("R2: domestic arrival with exactly 60 min before first activity passes", () => {
  const days = [
    day(1, [activity("City Walking Tour", { start_time: "11:00" })], [flight("10:00", "domestic")]),
  ];

  const { hard } = runCodeChecks(days);
  assert.ok(hard.every((i) => i.error_code !== "SHORT_TRANSFER"));
});

test("R2: international arrival needs 90 min, not just the domestic 60", () => {
  const days = [
    day(1, [activity("City Walking Tour", { start_time: "11:00" })], [flight("10:00", "international")]),
  ];

  const { hard } = runCodeChecks(days);
  const issue = hard.find((i) => i.error_code === "SHORT_TRANSFER");
  assert.ok(issue, "60 min gap is short for an international arrival (needs 90 min)");
  assert.match(issue!.field_value, /90 min required/);
});

test("R2: a return/departure flight later than the day's first activity is not flagged", () => {
  const days = [
    day(
      3,
      [activity("Mt. Fuji 5th Station & Lake Kawaguchiko Excursion", { start_time: "08:30" })],
      [flight("19:00", "domestic", "Return flight from Tokyo Haneda (HND)")]
    ),
  ];

  const { hard } = runCodeChecks(days);
  assert.ok(
    hard.every((i) => i.error_code !== "SHORT_TRANSFER"),
    "a flight departing after the first activity already started must not be treated as an arrival"
  );
});
