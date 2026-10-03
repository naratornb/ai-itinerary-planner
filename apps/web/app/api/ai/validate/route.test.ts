import assert from "node:assert/strict";
import test from "node:test";

import {
  runHardBlockFilters,
  findDayContainingText,
  isTransferTimeIssue,
  partitionAiHardErrors,
  PROFANITY_WORDS,
  SENSITIVE_WORDS,
  findWordingWarnings,
  buildIllegalActError,
  checkFailedResult,
  dropIllegalActDuplicates,
  keepKnownRules,
  dropRepeatedDuplicates,
  aiCacheKey,
  getCachedAiResult,
  putCachedAiResult,
  geminiGenerationConfig,
  withDayField,
  dropSingleActivityDailyRange,
  dedupeSimilarPairs,
  verifyTransferGaps,
  keepRealAiRules,
  verifyOpeningHours,
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
  // Context-dependent words moved to SENSITIVE_WORDS (warn, don't block) — still covered.
  for (const word of originalWords) {
    assert.ok(
      PROFANITY_WORDS.includes(word) || SENSITIVE_WORDS.includes(word),
      `expected "${word}" to still be in PROFANITY_WORDS or SENSITIVE_WORDS`,
    );
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

test("partitionAiHardErrors keeps R3, R4 and R12 as hard errors, demoting everything else to a warning", () => {
  // Agreed requirement: travel time between activities, opening hours and day-specific
  // closures are hard blocks. Every other AI rule stays a warning — e.g. a hard error
  // about read-only flight data (R6 below) must never block publishing.
  const issues = [
    { error_code: "SHORT_TRANSFER_ACTIVITY", rule: "R12 – Activity Transfer Time", severity: "error" },
    { error_code: "OPENING_HOURS", rule: "R3 – Opening Hours", severity: "error" },
    { error_code: "DAY_CLOSURE", rule: "R4 – Day Closure", severity: "error" },
    { error_code: "AMBIGUOUS_FLIGHT_INFO", rule: "R6 – Route Efficiency", severity: "error" },
  ];

  const { allowed, downgraded } = partitionAiHardErrors(issues);

  assert.deepEqual(allowed.map((i) => i.error_code), ["SHORT_TRANSFER_ACTIVITY", "OPENING_HOURS", "DAY_CLOSURE"]);
  assert.deepEqual(downgraded.map((i) => i.error_code), ["AMBIGUOUS_FLIGHT_INFO"]);
  assert.equal(downgraded[0].severity, "warning");
});

const CONFLICT = ["russia", "iran", "north korea"];

// The route receives days inside the package as days_json, so the whole-package scan
// sees them too — tests must send them the same way or that scan is never exercised.
function withDays(days: any[], overrides: Record<string, any> = {}) {
  return pkg({ ...overrides, days_json: JSON.stringify(days) });
}

test("place names that merely contain a conflict country's name are not blocked", () => {
  for (const place of ["Russian Hill cable car ride", "Walking tour of Tirana", "Miranda beach day"]) {
    const days = [{ day_number: 1, summary: "", activities: [{ activity_name: place }] }];
    const result = runHardBlockFilters(withDays(days, { country: "United States" }), CONFLICT, days);
    assert.equal(result.blocked, false, `expected "${place}" not to be blocked`);
  }
});

test("a package whose destination is a conflict country is still blocked", () => {
  const result = runHardBlockFilters(pkg({ country: "Russia" }), CONFLICT, []);
  assert.equal(result.blocked, true);
  assert.equal(result.type, "SafetyStatus");
});

test("a conflict country mentioned in the text warns instead of blocking", () => {
  const days = [
    { day_number: 1, summary: "", activities: [] },
    { day_number: 2, summary: "Views across the border to Russia", activities: [] },
  ];
  const p = withDays(days, { country: "Finland" });
  assert.equal(runHardBlockFilters(p, CONFLICT, days).blocked, false);
  const warnings = findWordingWarnings(p, CONFLICT, days);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.equal(warnings[0].field, "Day 2");
  assert.match(warnings[0].message, /russia/i);
});

test("everyday phrases with context-dependent words are not blocked", () => {
  for (const text of [
    "Killer whale watching in the bay",
    "Up at the crack of dawn for sunrise",
    "Prawn crackers at the night market",
    "Murder mystery dinner cruise",
  ]) {
    const days = [{ day_number: 1, summary: text, activities: [] }];
    const result = runHardBlockFilters(withDays(days), NO_WAR_ZONES, days);
    assert.equal(result.blocked, false, `expected "${text}" not to be blocked`);
  }
});

test("a context-dependent word warns and names the word and its day", () => {
  const days = [
    { day_number: 1, summary: "", activities: [] },
    { day_number: 3, summary: "", activities: [{ activity_name: "Killer whale watching" }] },
  ];
  const warnings = findWordingWarnings(withDays(days), NO_WAR_ZONES, days);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].field, "Day 3");
  assert.match(warnings[0].message, /killer/);
});

test("clean content produces no wording warnings", () => {
  const days = [{ day_number: 1, summary: "A relaxing cocktail hour", activities: [] }];
  assert.deepEqual(findWordingWarnings(withDays(days), CONFLICT, days), []);
});

test("unambiguous slurs and strong swear words still block", () => {
  for (const text of ["What a fucking view", "This cunt of a hike"]) {
    const days = [{ day_number: 1, summary: text, activities: [] }];
    assert.equal(runHardBlockFilters(pkg(), NO_WAR_ZONES, days).blocked, true, `expected "${text}" to block`);
  }
});

test("a place name containing a competitor's name is not blocked", () => {
  const days = [{ day_number: 1, summary: "", activities: [{ activity_name: "Shwedagon Pagoda at sunset" }] }];
  assert.equal(runHardBlockFilters(withDays(days, { country: "Myanmar" }), NO_WAR_ZONES, days).blocked, false);
});

test("a competitor with a dot in its name is still matched as a whole name", () => {
  const days = [{ day_number: 1, summary: "Cheaper on Booking.com", activities: [] }];
  assert.equal(runHardBlockFilters(pkg(), NO_WAR_ZONES, days).type, "BrandSafety");
});

test("an AI-suspected illegal activity becomes a blocking error naming the activity and its day", () => {
  const days = [
    { day_number: 1, activities: [{ activity_name: "Harbour cruise" }] },
    { day_number: 2, activities: [{ activity_name: "Buy animals part from the dark market" }] },
  ];
  const error = buildIllegalActError(
    { scores: { illegal_act: true }, illegal_evidence: "Buy animals part from the dark market" },
    days,
  );
  assert.ok(error, "expected an error when illegal_act is true");
  assert.equal(error.severity, "error");
  assert.equal(error.error_code, "POLICY_VIOLATION");
  assert.equal(error.rule, "SafetyStatus");
  assert.equal(error.field, "Day 2");
  assert.match(error.message, /Buy animals part from the dark market/);
  assert.match(error.message, /Day 2/);
});

test("an illegal-activity flag with no evidence still explains itself instead of a silent 0 score", () => {
  const error = buildIllegalActError({ scores: { illegal_act: true } }, []);
  assert.ok(error);
  assert.equal(error.field, "package_content");
  assert.ok(error.message.length > 0);
});

test("no illegal-activity error when the AI doesn't flag one", () => {
  assert.equal(buildIllegalActError({ scores: { illegal_act: false } }, []), null);
  assert.equal(buildIllegalActError({}, []), null);
});

test("a crashed check blocks submission with a retry message instead of passing with a fake score", () => {
  const result = checkFailedResult();
  assert.equal(result.is_feasible, false);
  assert.equal(result.can_publish, false);
  assert.equal(result.quality_score, undefined, "no made-up score when nothing was actually checked");
  assert.equal(result.hard_errors.length, 1);
  assert.equal(result.hard_errors[0].error_code, "CHECK_FAILED");
  assert.equal(result.hard_errors[0].severity, "error");
});

test("the AI's own note about the illegal activity isn't repeated as a warning under the critical issue", () => {
  const illegal = buildIllegalActError(
    { scores: { illegal_act: true }, illegal_evidence: "Buy animals part from the dark market" },
    [],
  );
  const warnings = [
    { rule: "R15 – General Feasibility", affected_item: "Buy animals part from the dark market", message: "suggests illegal or unethical trade" },
    { rule: "R14 – Similar Duplicate Activity", affected_item: "Harbour cruise", message: "similar to another" },
  ];
  const kept = dropIllegalActDuplicates(warnings, illegal);
  assert.deepEqual(kept.map((w) => w.affected_item), ["Harbour cruise"]);
  assert.equal(dropIllegalActDuplicates(warnings, null).length, 2);
});

test("database rules the code doesn't know are ignored, so retired rows stop reaching the AI", () => {
  // Regression: an uncoded legacy row ("at most one activity on the first/last day")
  // and the removed R8 kept being sent to the AI while still active in the table.
  const rows = [
    { rule_code: "R3", rule_name: "Opening Hours", rule_description: "db wording" },
    { rule_code: null, rule_name: null, rule_description: "First and last days must have at most one activity" },
    { rule_code: "R8", rule_name: "Capacity/Suitability", rule_description: "group size" },
  ];
  assert.deepEqual(keepKnownRules(rows as any).map((r) => r.rule_code), ["R3"]);
  assert.equal(keepKnownRules(rows as any)[0].rule_description, "db wording", "database wording still wins");
});

test("an AI duplicate warning that only repeats the exact-name duplicate check is dropped", () => {
  // Regression: "Sapporo Bike Tour" on Day 1 and Day 4 was reported twice — once by
  // R13 (exact name) and once by the AI's R14 (similar activities).
  const days = [
    { day_number: 1, activities: [{ activity_name: "Sapporo Bike Tour" }] },
    { day_number: 4, activities: [{ activity_name: "Sapporo Bike Tour" }, { activity_name: "Sapporo Bike Tour — Premium Edition" }] },
  ];
  const codeSoft = [{ error_code: "DUPLICATE_ACTIVITY", affected_item: "Sapporo Bike Tour" }];
  const ai = [
    { rule: "R14 – Similar Duplicate Activity", affected_item: "Sapporo Bike Tour (Day 1), Sapporo Bike Tour (Day 4)", message: "The activity 'Sapporo Bike Tour' appears on Day 1 and Day 4." },
    { rule: "R14 – Similar Duplicate Activity", affected_item: "Sapporo Bike Tour — Premium Edition", message: "Very similar to 'Sapporo Bike Tour' on Day 1." },
    { rule: "R3 – Opening Hours", affected_item: "Sapporo Bike Tour", message: "Starts after closing." },
  ];
  const kept = dropRepeatedDuplicates(ai, codeSoft, days);
  assert.deepEqual(kept.map((i) => i.rule), ["R14 – Similar Duplicate Activity", "R3 – Opening Hours"]);
  assert.match(kept[0].affected_item, /Premium Edition/, "a genuinely different near-duplicate is still reported");
});

test("the same package content gets the same cached AI result", () => {
  // Regression: two checks of byte-identical content scored 80 and 64.
  const key = aiCacheKey("gemini-2.5-flash", "system prompt", "itinerary A");
  assert.equal(key, aiCacheKey("gemini-2.5-flash", "system prompt", "itinerary A"));
  const result = { scores: { grammar_score: 0.9 } };
  putCachedAiResult(key, result);
  assert.deepEqual(getCachedAiResult(key), result);
});

test("any change to the content, rules or model is a different cache entry", () => {
  const base = aiCacheKey("gemini-2.5-flash", "system prompt", "itinerary A");
  assert.notEqual(base, aiCacheKey("gemini-2.5-flash", "system prompt", "itinerary B"));
  assert.notEqual(base, aiCacheKey("gemini-2.5-flash", "other rules", "itinerary A"));
  assert.notEqual(base, aiCacheKey("gemini-2.0-flash", "system prompt", "itinerary A"));
  assert.equal(getCachedAiResult(aiCacheKey("x", "y", "never stored")), undefined);
});

test("Gemini thinking is capped at a small fixed budget, only on models that support it", () => {
  // Off entirely, it missed a museum booked at 06:00; unlimited, answers varied.
  const flash25 = geminiGenerationConfig("gemini-2.5-flash");
  assert.deepEqual(flash25.thinkingConfig, { thinkingBudget: 1024 });
  assert.equal(flash25.topK, 1);
  assert.equal(flash25.temperature, 0);
  assert.equal(geminiGenerationConfig("gemini-1.5-flash").thinkingConfig, undefined);
});

test("an AI issue whose field isn't a day still gets one, so the Go to Day button shows", () => {
  // Regression: the AI copied the prompt's placeholder ("day/slot reference") into
  // `field`, so the Florence duplicate warning had no Go to Day button.
  const issue = {
    rule: "R14 – Similar Duplicate Activity",
    field: "day/slot reference",
    field_value: "Day 3, Morning; Day 4, Evening",
    affected_item: "Florence Old Town Photography Tour; Florence Old Town Photography Tour — Evening Edition",
  };
  assert.equal(withDayField(issue, []).field, "Day 3");
});

test("with no day number in its text, the issue points at the day containing its activity", () => {
  const days = [
    { day_number: 1, activities: [{ activity_name: "Uffizi Gallery" }] },
    { day_number: 2, activities: [{ activity_name: "Ponte Vecchio walk" }] },
  ];
  assert.equal(withDayField({ field: "", affected_item: "Ponte Vecchio walk", message: "Closes early." }, days).field, "Day 2");
});

test("an issue that already names its day is left alone", () => {
  const issue = { field: "Day 5 – Evening", field_value: "Day 2" };
  assert.equal(withDayField(issue, []).field, "Day 5 – Evening");
});

test("a Daily Range warning on a day with only one activity is dropped", () => {
  // Regression: the Phuket countryside day trip was the only activity on Day 4, yet R10
  // warned about "combining a long day trip with other activities".
  const days = [
    { day_number: 4, activities: [{ activity_name: "Phuket Countryside Day Trip — Premium Edition" }] },
    { day_number: 5, activities: [{ activity_name: "Cooking Class" }, { activity_name: "Ayutthaya day trip" }] },
  ];
  const issues = [
    { rule: "R10 – Daily Range", field: "Day 4 – Morning", affected_item: "Phuket Countryside Day Trip — Premium Edition" },
    { rule: "R10 – Daily Range", field: "Day 5", affected_item: "Ayutthaya day trip" },
    { rule: "R11 – Seasonality", field: "Day 4", affected_item: "Entire Package" },
  ];
  assert.deepEqual(
    dropSingleActivityDailyRange(issues, days).map((i) => `${i.rule} ${i.field}`),
    ["R10 – Daily Range Day 5", "R11 – Seasonality Day 4"],
  );
});

test("partitionAiHardErrors also promotes an agreed hard rule the AI filed as a warning", () => {
  // Regression: a museum at 06:00 came back as an R3 *warning*, so it didn't block.
  const { allowed } = partitionAiHardErrors([], [
    { error_code: "OPENING_HOURS", rule: "R3 – Opening Hours", severity: "warning" },
    { error_code: "SEASONALITY", rule: "R11 – Seasonality", severity: "warning" },
  ]);
  assert.deepEqual(allowed.map((i) => i.error_code), ["OPENING_HOURS"]);
  assert.equal(allowed[0].severity, "error");
});

test("the same similar pair reported in both directions is shown once", () => {
  const days = [
    { day_number: 1, activities: [{ activity_name: "Historic Phuket City Walking Tour" }] },
    { day_number: 5, activities: [{ activity_name: "Historic Phuket City Walking Tour — Evening Edition" }] },
  ];
  const issues = [
    { rule: "R14 – Similar Duplicate Activity", affected_item: "Historic Phuket City Walking Tour", message: '"Historic Phuket City Walking Tour" on Day 1 is very similar to "Historic Phuket City Walking Tour — Evening Edition" on Day 5.' },
    { rule: "R14 – Similar Duplicate Activity", affected_item: "Historic Phuket City Walking Tour — Evening Edition", message: '"Historic Phuket City Walking Tour — Evening Edition" on Day 5 is very similar to "Historic Phuket City Walking Tour" on Day 1.' },
    { rule: "R11 – Seasonality", affected_item: "Entire Package", message: "Rainy season." },
  ];
  const kept = dedupeSimilarPairs(issues, days);
  assert.deepEqual(kept.map((i) => i.rule), ["R14 – Similar Duplicate Activity", "R11 – Seasonality"]);
});

test("an AI travel-time issue is dropped when the real gap already covers its own estimate", () => {
  const days = [{
    day_number: 5,
    activities: [
      { activity_name: "Phuket Cooking Class with Local Chef — Afternoon Edition", start_time: "13:00", duration_hours: 3.5 },
      { activity_name: "Historic Phuket City Walking Tour — Evening Edition", start_time: "18:00", duration_hours: 2.8 },
      { activity_name: "Night Market", start_time: "21:08", duration_hours: 1 },
    ],
  }];
  const wrong = {
    rule: "R12 – Activity Transfer Time",
    message: 'Not enough time to get from "Phuket Cooking Class with Local Chef — Afternoon Edition" to "Historic Phuket City Walking Tour — Evening Edition": 30 min between them, but the trip takes about 40 min.',
  };
  const real = {
    rule: "R12 – Activity Transfer Time",
    message: 'Not enough time to get from "Historic Phuket City Walking Tour — Evening Edition" to "Night Market": 20 min between them, but the trip takes about 25 min.',
  };
  const other = { rule: "R3 – Opening Hours", message: "Closed." };
  const { blocks, warnings } = verifyTransferGaps([wrong, real], days);
  assert.deepEqual(blocks, [real]);
  assert.deepEqual(warnings, []);
  void other;
});

test("AI issues under a rule that doesn't exist are dropped", () => {
  // Regression: the AI turned its completeness score deductions into extra warnings
  // under an invented "Completeness Score" rule, duplicating R9's empty-day warning.
  const issues = [
    { rule: "Completeness Score", error_code: "COMPLETENESS_ISSUE", field: "Day 8" },
    { rule: "R14 – Similar Duplicate Activity", field: "Day 1" },
    { rule: "R3 – Opening Hours", field: "Day 3" },
    { rule: "R1", field: "Day 2" },
  ];
  assert.deepEqual(keepRealAiRules(issues).map((i) => i.rule), ["R14 – Similar Duplicate Activity", "R3 – Opening Hours"]);
});

test("an AI travel-time issue for a gap under 15 min is dropped — R22 already blocks it", () => {
  const days = [{ day_number: 1, activities: [
    { activity_name: "Grand Palace", start_time: "09:00", duration_hours: 1 },
    { activity_name: "Wat Arun", start_time: "10:05", duration_hours: 1 },
  ] }];
  const issue = { rule: "R12 – Activity Transfer Time", message: 'Not enough time to get from "Grand Palace" to "Wat Arun": 5 min between them, but the trip takes about 25 min.' };
  assert.deepEqual(verifyTransferGaps([issue], days), { blocks: [], warnings: [] });
});

test("an AI travel-time estimate written as a range is understood", () => {
  // Regression: "about 10-40 min" couldn't be read, so an R12 copy of R22's 7-minute
  // gap slipped through as a second critical issue.
  const days = [{ day_number: 2, activities: [
    { activity_name: "Phuket Cooking Class", start_time: "13:00", duration_hours: 3.5 },
    { activity_name: "Old Town Walk", start_time: "16:37", duration_hours: 1.5 },
    { activity_name: "Night Market", start_time: "18:30", duration_hours: 1 },
  ] }];
  const copyOfR22 = { rule: "R12 – Activity Transfer Time", message: 'Not enough time to get from "Phuket Cooking Class" to "Old Town Walk": 7 min between them, but the trip takes about 10-40 min.' };
  const covered = { rule: "R12 – Activity Transfer Time", message: 'Not enough time to get from "Old Town Walk" to "Night Market": 23 min between them, but the trip takes about 10-20 min.' };
  const tight = { rule: "R12 – Activity Transfer Time", message: 'Not enough time to get from "Old Town Walk" to "Night Market": 23 min between them, but the trip takes about 20-30 min.' };
  assert.deepEqual(verifyTransferGaps([copyOfR22, covered, tight], days), { blocks: [tight], warnings: [] });
});

test("an opening-hours issue is dropped when the visit fits the hours the AI itself quoted", () => {
  // Regression: a museum pass 10:00–15:18 was hard-blocked by a hedged R3 note
  // ("open around 09:00-10:00 and close by 17:00-18:00… might be feasible").
  const days = [{ day_number: 3, activities: [
    { activity_name: "Bangkok Museum & Gallery Pass", start_time: "10:00", duration_hours: 5.3 },
    { activity_name: "Phuket Museum & Gallery Pass", start_time: "06:00", duration_hours: 3 },
  ] }];
  const fits = { rule: "R3 – Opening Hours", affected_item: "Bangkok Museum & Gallery Pass", message: "Many museums and galleries in Bangkok typically open around 09:00-10:00 and close by 17:00-18:00. A 5.3-hour pass ending at 15:18 might be feasible for a partial visit." };
  const tooEarly = { rule: "R3 – Opening Hours", affected_item: "Phuket Museum & Gallery Pass", message: "This activity starts at 06:00, but museums typically open around 09:00-10:00." };
  const noHours = { rule: "R3 – Opening Hours", affected_item: "Phuket Museum & Gallery Pass", message: "Closed at this time." };
  const { blocks, warnings } = verifyOpeningHours([fits, tooEarly, noHours], days);
  assert.deepEqual(blocks, [tooEarly]);
  assert.deepEqual(warnings.map((w) => w.message), [noHours.message], "unverifiable → warning, not a block");
  assert.equal(warnings[0].severity, "warning");
});

test("an opening-hours note with no hours to check is a warning, not a block", () => {
  // Regression: "Bangkok Sunrise Yoga Session starts at 06:30, which is unusually early…
  // while possible" blocked submission with nothing to verify it against.
  const days = [{ day_number: 7, activities: [{ activity_name: "Bangkok Sunrise Yoga Session", start_time: "06:30", duration_hours: 1 }] }];
  const issue = { rule: "R3 – Opening Hours", affected_item: "Bangkok Sunrise Yoga Session", message: "The activity 'Bangkok Sunrise Yoga Session' starts at 06:30, which is unusually early for most public venues or studios in Bangkok." };
  const { blocks, warnings } = verifyOpeningHours([issue], days);
  assert.equal(blocks.length, 0);
  assert.equal(warnings.length, 1);
});

test("a travel-time issue whose activities can't be identified is a warning, not a block", () => {
  const issue = { rule: "R12 – Activity Transfer Time", message: "Not enough time between the morning stops: about 30 min needed." };
  assert.deepEqual(verifyTransferGaps([issue], []).blocks, []);
  assert.equal(verifyTransferGaps([issue], []).warnings.length, 1);
});
