import assert from "node:assert/strict";
import test from "node:test";

import {
  runHardBlockFilters,
  findDayContainingText,
  isTransferTimeIssue,
  partitionAiHardErrors,
  PROFANITY_WORDS,
} from "./route";

const NO_WAR_ZONES: string[] = [];

function pkg(overrides: Record<string, any> = {}) {
  return { country: "Japan", trip_name: "Tokyo Adventure", ...overrides };
}

test("word-boundary regex previously missed inflected profanity — now blocked", () => {
  for (const text of ["This trip is fucking amazing", "What a shitty hotel", "We fucked up the schedule"]) {
    const result = runHardBlockFilters(pkg({ notes: text }), NO_WAR_ZONES);
    assert.equal(result.blocked, true, `expected "${text}" to be blocked`);
    assert.equal(result.type, "SafetyStatus");
  }
});

test("leetspeak evasion word is blocked", () => {
  const result = runHardBlockFilters(pkg({ notes: "this is a b4dw0rd example" }), NO_WAR_ZONES);
  assert.equal(result.blocked, true);
});

test("clean package content is not blocked", () => {
  const result = runHardBlockFilters(
    pkg({ notes: "A relaxing cocktail hour followed by a sunset cruise." }),
    NO_WAR_ZONES
  );
  assert.equal(result.blocked, false);
});

test("profanity in a day's story/summary text is caught once it's part of the payload", () => {
  // The editor's buildValidationPayload() previously omitted day.story from days_json
  // entirely, so profanity typed into the "Your story" textarea never reached this
  // filter — regardless of what the filter itself checked. Fixed in itinerary-editor.tsx
  // by adding `summary: day.story` to each days_json entry; this guards that once the
  // field IS present, the existing full-payload JSON.stringify scan actually catches it.
  const days_json = JSON.stringify([
    { day_number: 1, summary: "This shitty hotel ruined our trip", flights: [], activities: [] },
  ]);
  const result = runHardBlockFilters(pkg({ days_json }), NO_WAR_ZONES);
  assert.equal(result.blocked, true, "expected profanity in the day summary to be blocked");
});

test("PROFANITY_WORDS includes the exact forms reported as missed", () => {
  for (const word of ["fucking", "fucked", "shitty", "b4dw0rd"]) {
    assert.ok(PROFANITY_WORDS.includes(word), `expected PROFANITY_WORDS to include "${word}"`);
  }
});

test("PROFANITY_WORDS still includes every word from the original list — none silently dropped", () => {
  // Regression: rewriting the list to add inflected forms accidentally dropped "cock"
  // entirely (present before, absent after) with nothing to catch the loss.
  const originalWords = [
    "fuck", "shit", "bitch", "asshole", "cunt", "bastard",
    "motherfucker", "fucker", "bullshit", "dickhead", "prick", "wanker",
    "arsehole", "arse", "twat", "cock", "pussy", "slut", "whore",
    "nigger", "nigga", "chink", "spic", "kike", "gook", "wetback",
    "cracker", "faggot", "fag", "dyke", "tranny", "retard",
    "cocaine", "heroin", "meth", "methamphetamine", "ecstasy", "mdma",
    "crack", "fentanyl", "kill", "murder", "rape", "pedophile", "molest",
  ];
  for (const word of originalWords) {
    assert.ok(PROFANITY_WORDS.includes(word), `expected PROFANITY_WORDS to still include "${word}"`);
  }
});

test("profanity found within a specific day's content is attributed to that day, for a Go to Day button", () => {
  const days = [
    { day_number: 1, summary: "A lovely relaxing morning", activities: [] },
    { day_number: 2, summary: "", activities: [{ activity_name: "Old Town Tour", description: "This shitty tour was a waste" }] },
  ];
  const result = runHardBlockFilters(pkg(), NO_WAR_ZONES, days);
  assert.equal(result.blocked, true);
  assert.equal(result.field, "Day 2");
});

test("profanity only in a package-level field (not any day) has no day to attribute — falls back generic", () => {
  const days = [{ day_number: 1, summary: "A lovely relaxing morning", activities: [] }];
  const result = runHardBlockFilters(pkg({ trip_name: "This shitty trip" }), NO_WAR_ZONES, days);
  assert.equal(result.blocked, true);
  assert.equal(result.field, undefined);
});

test("a banned competitor mention within a specific day is attributed to that day, for a Go to Day button", () => {
  const days = [
    { day_number: 1, summary: "A lovely relaxing morning", activities: [] },
    { day_number: 2, summary: "", activities: [{ activity_name: "Book more nights on Expedia", description: "" }] },
  ];
  const result = runHardBlockFilters(pkg(), NO_WAR_ZONES, days);
  assert.equal(result.blocked, true);
  assert.equal(result.type, "BrandSafety");
  assert.equal(result.field, "Day 2");
});

test("a competitor mention across two days lands on the first day, not the second", () => {
  const days = [
    { day_number: 1, summary: "", activities: [{ activity_name: "Compare prices on Agoda", description: "" }] },
    { day_number: 2, summary: "", activities: [{ activity_name: "Also check Expedia", description: "" }] },
  ];
  const result = runHardBlockFilters(pkg(), NO_WAR_ZONES, days);
  assert.equal(result.field, "Day 1");
});

test("a competitor mention only in a package-level field has no day to attribute — falls back generic", () => {
  const days = [{ day_number: 1, summary: "A lovely relaxing morning", activities: [] }];
  const result = runHardBlockFilters(pkg({ trip_name: "Better than Expedia's packages" }), NO_WAR_ZONES, days);
  assert.equal(result.blocked, true);
  assert.equal(result.type, "BrandSafety");
  assert.equal(result.field, undefined);
});

test("findDayContainingText locates the day whose text contains the AI's quoted evidence", () => {
  const days = [
    { day_number: 1, summary: "Morning market visit", activities: [] },
    { day_number: 2, summary: "", activities: [{ activity_name: "Sunset Cruise", description: "Absolutely shitty views, would not recommend" }] },
  ];
  assert.equal(findDayContainingText(days, "shitty views"), 2);
  assert.equal(findDayContainingText(days, "nothing like this exists"), null);
  assert.equal(findDayContainingText(days, ""), null);
});

test("isTransferTimeIssue recognizes an R2 duplicate by error_code or rule, so it can be filtered out of the AI's output", () => {
  // Regression: the system prompt's old wording told the AI not to flag this UNLESS
  // the gap looked short — exactly when the deterministic R2 check already fires —
  // guaranteeing a duplicate "SHORT_TRANSFER" issue in every genuinely-short-transfer
  // case. This is the code-level safety net for when the model does it anyway.
  assert.equal(isTransferTimeIssue({ error_code: "SHORT_TRANSFER", rule: "Something else" }), true);
  assert.equal(isTransferTimeIssue({ error_code: "OTHER", rule: "R2 – Transfer Time" }), true);
  assert.equal(isTransferTimeIssue({ error_code: "OPENING_HOURS", rule: "R3 – Opening Hours" }), false);
  assert.equal(isTransferTimeIssue(undefined), false);
});

test("partitionAiHardErrors keeps only R12 as a real hard error, demoting everything else to a warning", () => {
  // Regression: an AI hard error complaining that a departure-day flight only shows
  // its arrival time (SYD, not DPS) was blocking publish — that's not something a
  // creator can fix (flights are locked catalog selections), so it should never have
  // hard-blocked. This is the code-level safety net for when the model hard-blocks
  // on a judgment-call rule anyway, independent of the prompt wording.
  const issues = [
    { error_code: "SHORT_TRANSFER_ACTIVITY", rule: "R12 – Activity Transfer Time", severity: "error" },
    { error_code: "AMBIGUOUS_FLIGHT_INFO", rule: "R6 – Route Efficiency", severity: "error" },
  ];

  const { allowed, downgraded } = partitionAiHardErrors(issues);

  assert.deepEqual(allowed.map((i) => i.error_code), ["SHORT_TRANSFER_ACTIVITY"]);
  assert.deepEqual(downgraded.map((i) => i.error_code), ["AMBIGUOUS_FLIGHT_INFO"]);
  assert.equal(downgraded[0].severity, "warning");
});
