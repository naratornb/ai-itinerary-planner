import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_RULES, buildSystemPrompt, runCodeChecks } from "./feasibility";

function day(dayNumber: number, activities: any[], flights: any[] = []) {
  return { day_number: dayNumber, activities, flights };
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

test("buildSystemPrompt renders the supplied rule list", () => {
  const prompt = buildSystemPrompt([
    { rule_code: "R14", rule_name: "Similar Duplicate Activity", rule_description: "Test description." },
  ]);

  assert.match(prompt, /R14 \(Similar Duplicate Activity\): Test description\./);
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
