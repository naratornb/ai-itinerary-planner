import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase/client";
import {
  ACTIVITY_GAP_MIN,
  FALLBACK_RULES,
  FeasibilityRule,
  buildSystemPrompt,
  buildUserPrompt,
  checkPackagePhotos,
  isValidClockTime,
  minutesToTime,
  runCodeChecks,
  toMinutes,
} from "../../../../lib/feasibility";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const MODEL_NAME = process.env.MODEL_NAME || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_KEY}`;

// ─── AI rules (R3, R4, R6, R10, R11, R12, R14, R15) ─────────────────────────
// Contextual rules that require real-world knowledge are sent to the AI. Rule
// wording lives in the `feasibility_rules` table so it can be edited without a
// deploy; falls back to FALLBACK_RULES if the table is empty or unreachable.

async function fetchActiveRules(): Promise<FeasibilityRule[]> {
  const { data, error } = await supabase
    .from("feasibility_rules")
    .select("rule_code, rule_name, rule_description")
    .eq("is_active", true)
    .order("rule_priority");

  const rules = keepKnownRules((data ?? []) as FeasibilityRule[]);
  if (error || rules.length === 0) {
    if (error) console.warn("Failed to fetch feasibility_rules, using fallback:", error.message);
    return FALLBACK_RULES;
  }
  return rules;
}

/**
 * The table supplies each rule's wording, but only for rule codes the code knows
 * (FALLBACK_RULES). A retired rule — or an old uncoded row — still marked active in
 * the database then can't keep reaching the AI before a migration switches it off.
 */
export function keepKnownRules(rows: FeasibilityRule[]): FeasibilityRule[] {
  const known = new Set(FALLBACK_RULES.map((r) => r.rule_code));
  return rows.filter((r) => known.has(r.rule_code));
}

// ─── AI result consistency ─────────────────────────────────────────────────────
// Gemini isn't fully deterministic even at temperature 0, so the same package could
// score 80 on one check and 64 on the next. A successful AI result is cached by the
// exact prompt it answered: re-checking unchanged content returns the same result,
// and any edit (or a rule/model change) asks again. Per server instance, in memory.

const AI_CACHE_MAX = 500;
const aiResultCache = new Map<string, unknown>();

export function aiCacheKey(model: string, systemPrompt: string, userPrompt: string): string {
  return createHash("sha256").update(`${model}\n${systemPrompt}\n${userPrompt}`).digest("hex");
}

export function getCachedAiResult(key: string): any | undefined {
  const hit = aiResultCache.get(key);
  return hit === undefined ? undefined : structuredClone(hit);
}

export function putCachedAiResult(key: string, result: unknown): void {
  aiResultCache.delete(key);
  aiResultCache.set(key, structuredClone(result));
  // Map keeps insertion order — drop the oldest entries past the cap.
  while (aiResultCache.size > AI_CACHE_MAX) aiResultCache.delete(aiResultCache.keys().next().value!);
}

/**
 * temperature 0 + fixed seed + topK 1 for the most repeatable answers. Gemini 2.5
 * Flash's thinking is capped at a small fixed budget: with none, it stopped catching
 * things like a museum booked at 06:00; unlimited, its answers varied run to run.
 * Only set on 2.5 Flash models, so switching MODEL_NAME can't break the request.
 */
export function geminiGenerationConfig(model: string) {
  return {
    responseMimeType: "application/json",
    temperature: 0,
    seed: 42,
    topK: 1,
    ...(model.startsWith("gemini-2.5-flash") ? { thinkingConfig: { thinkingBudget: 1024 } } : {}),
  };
}

// ─── Hard text-based block filters ────────────────────────────────────────────

const BANNED_COMPETITORS = [
  "expedia", "booking.com", "wotif", "trivago", "skyscanner",
  "tripadvisor", "agoda", "hotels.com", "airbnb", "klook", "getyourguide",
];

// Fixed list, not fetched from the AI daily: an AI-regenerated list let the same
// package pass one day and fail the next. The destination picker already keeps these
// out of new packages; this is the backstop plus the source for text-mention warnings.
export const CONFLICT_COUNTRIES = [
  "russia", "ukraine", "belarus", "syria", "yemen", "somalia",
  "sudan", "myanmar", "afghanistan", "iran", "north korea",
];

// `\bword\b` only matches the exact standalone word — it does NOT match
// inflected/suffixed forms (e.g. \bfuck\b misses "fucking", "fucked", "fucker").
// There's no single suffix rule that covers English inflection (doubled
// consonants, dropped "e", etc.) without false-positiving on unrelated words
// (a naive "cock" prefix match would also catch "cocktail"), so common
// inflected forms are listed explicitly per root word instead.
export const PROFANITY_WORDS = [
  // Strong expletives
  "fuck", "fucks", "fucked", "fucking", "fuckin", "fucker", "fuckers", "motherfucker", "motherfucking",
  "shit", "shits", "shitty", "shitting", "shitted", "bullshit",
  "bitch", "bitches", "bitchy", "bitching",
  "asshole", "assholes",
  "cunt", "cunts",
  "bastard", "bastards",
  "dickhead", "dickheads",
  "wanker", "wankers", "wanking",
  "arsehole", "arseholes",
  "twat", "twats",
  "pussy", "pussies",
  "slut", "sluts", "slutty",
  "whore", "whores", "whoring",
  // Slurs (racial / ethnic / identity)
  "nigger", "niggers", "nigga", "niggas",
  "chink", "chinks", "spic", "spics", "kike", "kikes", "gook", "gooks", "wetback", "wetbacks",
  "faggot", "faggots", "fag", "fags",
  "dyke", "dykes", "tranny", "trannies",
  "retard", "retards", "retarded",
  // Leetspeak / evasion variants
  "b4dw0rd",
  // Drug / illegal references
  "cocaine", "heroin", "methamphetamine", "mdma", "fentanyl",
  // Violence / threat language
  "rape", "raped", "raping", "rapist",
  "pedophile", "pedophiles", "paedophile", "paedophiles",
  "molest", "molested", "molesting", "molester",
];

// Words with an everyday travel meaning ("killer whale", "crack of dawn", "prawn
// crackers", "murder mystery dinner", "cock-a-leekie") — a match only warns, so the
// creator can check the wording without being blocked.
export const SENSITIVE_WORDS = [
  "kill", "kills", "killed", "killing", "killer",
  "murder", "murders", "murdered", "murdering", "murderer",
  "crack", "cracker", "crackers",
  "ecstasy", "meth",
  "cock", "prick", "pricks", "arse", "arses",
];

/** Whole-word, case-insensitive match — so "iran" misses "Tirana" and "agoda" misses "Pagoda". */
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

// A day's own text — summary plus every activity's name/description — used to
// localize a profanity or banned-competitor match to a specific day so the UI can
// offer a "Go to Day N" button instead of a generic package-wide message.
function dayTextBlob(day: any): string {
  const parts: string[] = [];
  if (day.summary) parts.push(String(day.summary));
  for (const act of day.activities || []) {
    if (act.activity_name) parts.push(String(act.activity_name));
    if (act.description) parts.push(String(act.description));
  }
  return parts.join(" ").toLowerCase();
}

/** Finds the first day whose own text contains `needle` (case-insensitive substring). */
export function findDayContainingText(days: any[], needle: string | undefined): number | null {
  const n = (needle || "").trim().toLowerCase();
  if (!n) return null;
  for (const day of days) {
    if (dayTextBlob(day).includes(n)) return day.day_number;
  }
  return null;
}

/**
 * True for an AI-generated issue that duplicates R2 (post-landing transfer time) —
 * fully owned by the deterministic code check in runCodeChecks. The system prompt
 * tells the model never to flag this itself, but that's not a hard guarantee, so
 * entries matching it are filtered out of the AI's output as a safety net.
 */
export function isTransferTimeIssue(issue: any): boolean {
  return issue?.error_code === "SHORT_TRANSFER" || issue?.rule === "R2 – Transfer Time";
}

/**
 * R3, R4 and R12 are the contextual rules allowed to hard-block (opening hours, day
 * closures, travel time between activities — all fixable by moving something). Every
 * other AI hard_error is a judgment call about content the creator often can't act
 * on (e.g. flight data is read-only, catalog-selected) — this splits
 * the AI's hard_errors into ones that are allowed through as-is and ones that get
 * demoted to a warning, independent of whether the model actually followed that
 * instruction in the prompt.
 */
/**
 * R13 (code) already reports activities with exactly the same name. Drop an AI R14
 * issue that only names those activities, so the same repeat isn't shown twice; an
 * R14 issue that also names a differently worded activity is a real near-duplicate
 * and stays.
 */
export function dropRepeatedDuplicates(aiIssues: any[], codeSoft: any[], days: any[]): any[] {
  const repeated = new Set(
    codeSoft.filter((i) => i.error_code === "DUPLICATE_ACTIVITY").map((i) => String(i.affected_item).toLowerCase()),
  );
  if (repeated.size === 0) return aiIssues;
  const names = [...new Set(days.flatMap((d: any) => (d.activities || []).map((a: any) => String(a.activity_name || "").toLowerCase())))]
    .filter(Boolean)
    // Longest first, so "X — Premium Edition" is matched before plain "X".
    .sort((a, b) => b.length - a.length);
  return aiIssues.filter((issue) => {
    if (!String(issue?.rule ?? "").startsWith("R14")) return true;
    let text = `${issue.affected_item ?? ""} ${issue.field_value ?? ""} ${issue.message ?? ""}`.toLowerCase();
    const mentioned: string[] = [];
    for (const name of names) {
      if (text.includes(name)) {
        mentioned.push(name);
        text = text.split(name).join(" ");
      }
    }
    return !(mentioned.length > 0 && mentioned.every((name) => repeated.has(name)));
  });
}

/**
 * The editor's Go to Day button needs `field` to start with "Day N". The AI sometimes
 * writes something else there (once, the prompt's own placeholder text), so fall back
 * to the first "Day N" anywhere in the issue, then to the day containing an activity
 * it names.
 */
export function withDayField(issue: any, days: any[]): any {
  if (/^Day \d+/.test(String(issue?.field ?? ""))) return issue;
  const text = `${issue?.field_value ?? ""} ${issue?.affected_item ?? ""} ${issue?.message ?? ""}`;
  const mentioned = text.match(/\bDay (\d+)/);
  if (mentioned) return { ...issue, field: `Day ${mentioned[1]}` };
  for (const name of String(issue?.affected_item ?? "").split(/[;,]/)) {
    const day = findDayContainingText(days, name);
    if (day !== null) return { ...issue, field: `Day ${day}` };
  }
  return issue;
}

/**
 * R10 (Daily Range) is about combining a far excursion with other activities, so it
 * can't apply to a day with a single activity — drop it there, whatever the AI says.
 * Runs after withDayField, so `field` names the day.
 */
export function dropSingleActivityDailyRange(issues: any[], days: any[]): any[] {
  return issues.filter((issue) => {
    if (!String(issue?.rule ?? "").startsWith("R10")) return true;
    const dayNumber = Number(String(issue.field ?? "").match(/^Day (\d+)/)?.[1]);
    const day = days.find((d: any) => d.day_number === dayNumber);
    return !day || (day.activities || []).length >= 2;
  });
}

type Verdict = "block" | "drop" | "warn";

/** Splits AI issues by a code verdict: confirmed → block, disproved → dropped, can't tell → warning. */
function splitByVerdict(issues: any[], verdict: (issue: any) => Verdict): { blocks: any[]; warnings: any[] } {
  const blocks: any[] = [];
  const warnings: any[] = [];
  for (const issue of issues) {
    const v = verdict(issue);
    if (v === "block") blocks.push(issue);
    else if (v === "warn") warnings.push({ ...issue, severity: "warning" });
  }
  return { blocks, warnings };
}

/**
 * The AI's R12 travel-time claim only ever warns — travel time between catalog
 * activities is worked out from coordinates instead (checkTravelTimes), because the
 * AI's estimate kept rising with the gap. Find the two activities it names on one
 * day: drop it when coordinates already cover that pair, when the gap is under
 * ACTIVITY_GAP_MIN (R22 blocks it), or when the gap covers the AI's own estimate
 * ("about N min", or the top of a range); otherwise it's a warning.
 */
export function verifyTransferGaps(
  issues: any[],
  days: any[],
  coveredByCoordinates: (first: string, second: string) => boolean = () => false,
): { blocks: any[]; warnings: any[] } {
  return splitByVerdict(issues, (issue): Verdict => {
    const text = `${issue.affected_item ?? ""} ${issue.message ?? ""}`.toLowerCase();
    const range = String(issue.message ?? "").match(/about (\d+)(?:\s*[-–]\s*(\d+))?\s*min/i);
    const estimate = range ? Number(range[2] ?? range[1]) : NaN;
    for (const day of days) {
      const acts = (day.activities || [])
        .filter((a: any) => a.activity_name && isValidClockTime(a.start_time))
        .map((a: any) => ({ name: String(a.activity_name).toLowerCase(), start: toMinutes(a.start_time), end: toMinutes(a.start_time) + (Number(a.duration_hours) || 1) * 60 }))
        .sort((a: any, b: any) => a.start - b.start);
      for (let k = 1; k < acts.length; k += 1) {
        if (text.includes(acts[k - 1].name) && text.includes(acts[k].name)) {
          const gap = acts[k].start - acts[k - 1].end;
          if (coveredByCoordinates(acts[k - 1].name, acts[k].name)) return "drop";
          if (gap < ACTIVITY_GAP_MIN) return "drop";
          return Number.isNaN(estimate) || gap < estimate ? "warn" : "drop";
        }
      }
    }
    return "warn";
  });
}

// ─── R12 travel time from coordinates ─────────────────────────────────────────
// Assumed mode: taxi / ride-share in city traffic — 10 min to get going, then about
// 20 km/h door to door (traffic, and roads ~30% longer than a straight line).
const TAXI_BASE_MIN = 10;
const TAXI_MIN_PER_KM = 3;

type LatLng = { lat: number; lng: number };

export function taxiMinutes(km: number): number {
  return Math.ceil(TAXI_BASE_MIN + TAXI_MIN_PER_KM * km - 1e-9);
}

/** Straight-line (great-circle) distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Coordinates for an activity: by its catalog id, else by its name. */
function coordsFor(act: any, coords: Map<string, LatLng>): LatLng | undefined {
  return (act.source_id && coords.get(String(act.source_id))) || coords.get(String(act.activity_name || "").toLowerCase());
}

/**
 * R12 – Activity Transfer Time: for back-to-back activities that both have catalog
 * coordinates, the gap must cover the taxi time between them. Gaps under
 * ACTIVITY_GAP_MIN are left to R22.
 */
export function checkTravelTimes(days: any[], coords: Map<string, LatLng>): any[] {
  const issues: any[] = [];
  for (const day of days) {
    const acts = (day.activities || [])
      .filter((a: any) => a.activity_name && isValidClockTime(a.start_time))
      .map((a: any) => ({ act: a, start: toMinutes(a.start_time), end: toMinutes(a.start_time) + (Number(a.duration_hours) || 1) * 60 }))
      .sort((a: any, b: any) => a.start - b.start);
    for (let k = 1; k < acts.length; k += 1) {
      const prev = acts[k - 1];
      const next = acts[k];
      const from = coordsFor(prev.act, coords);
      const to = coordsFor(next.act, coords);
      const gap = next.start - prev.end;
      if (!from || !to || gap < ACTIVITY_GAP_MIN) continue;
      const km = distanceKm(from, to);
      const needed = taxiMinutes(km);
      if (gap >= needed) continue;
      issues.push({
        error_code: "SHORT_TRAVEL_TIME",
        rule: "R12 – Activity Transfer Time",
        severity: "error",
        field: `Day ${day.day_number}`,
        field_value: `${gap} min gap, ${needed} min by taxi`,
        affected_item: next.act.activity_name,
        message: `Not enough time to get from "${prev.act.activity_name}" to "${next.act.activity_name}": they're ${km.toFixed(1)} km apart, about ${needed} min by taxi, but you've left ${gap} min.`,
        action: `Start "${next.act.activity_name}" at ${minutesToTime(prev.end + needed)} or later.`,
      });
    }
  }
  return issues;
}

/**
 * Catalog coordinates for the package's activities, keyed by activity id and by
 * lower-cased name (looked up within the trip's city). Empty on any error, so the
 * travel-time rule simply doesn't apply rather than breaking the check.
 */
async function fetchActivityCoordinates(days: any[], city: string): Promise<Map<string, LatLng>> {
  const acts = days.flatMap((d: any) => d.activities || []);
  const ids = [...new Set(acts.map((a: any) => a.source_id).filter(Boolean))] as string[];
  const names = [...new Set(acts.map((a: any) => a.activity_name).filter(Boolean))] as string[];
  const coords = new Map<string, LatLng>();
  const add = (rows: any[] | null) => {
    for (const r of rows ?? []) {
      if (typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
      const point = { lat: r.latitude, lng: r.longitude };
      coords.set(String(r.activity_id), point);
      coords.set(String(r.activity_name).toLowerCase(), point);
    }
  };
  try {
    const select = "activity_id, activity_name, latitude, longitude";
    if (ids.length) add((await supabase.from("activities").select(select).in("activity_id", ids)).data);
    if (names.length && city) add((await supabase.from("activities").select(select).eq("city", city).in("activity_name", names)).data);
  } catch (err: any) {
    console.warn("Couldn't load activity coordinates — travel-time check skipped:", err?.message);
  }
  return coords;
}

/**
 * Only issues under a real AI rule (the FALLBACK_RULES codes) reach the editor. The
 * AI has invented rules before — e.g. "Completeness Score" warnings repeating what
 * R9 already reported — and those are dropped.
 */
export function keepRealAiRules(issues: any[]): any[] {
  const codes = FALLBACK_RULES.map((r) => r.rule_code);
  return issues.filter((issue) => {
    const rule = String(issue?.rule ?? "");
    return codes.some((code) => rule === code || rule.startsWith(`${code} `));
  });
}

/**
 * R3 can hard-block, so its claim is checked against the hours the AI itself quotes
 * ("open around 09:00-10:00 … close by 17:00-18:00", most generous reading of each
 * range): the named activity outside them is confirmed (block); inside them it's only
 * a hedge like "might be rushed" (dropped). With no activity or no hours to check —
 * "unusually early", say — it can't be confirmed (warning).
 */
export function verifyOpeningHours(issues: any[], days: any[]): { blocks: any[]; warnings: any[] } {
  const acts = days.flatMap((d: any) => (d.activities || []).map((a: any) => ({ ...a, day_number: d.day_number })))
    .filter((a: any) => a.activity_name && isValidClockTime(a.start_time))
    .sort((a: any, b: any) => String(b.activity_name).length - String(a.activity_name).length);
  const times = (m: RegExpMatchArray | null) => (m ? [m[1], m[2] ?? m[1]].map(toMinutes) : null);
  return splitByVerdict(issues, (issue): Verdict => {
    const message = String(issue.message ?? "");
    const named = acts.filter((a: any) => `${issue.affected_item ?? ""} ${message}`.toLowerCase().includes(String(a.activity_name).toLowerCase()));
    // The same activity can appear on several days: prefer the one on the issue's
    // day, then the one whose start time the message quotes.
    const longest = named.filter((a: any) => String(a.activity_name).length === String(named[0]?.activity_name ?? "").length);
    const issueDay = Number(String(issue.field ?? "").match(/^Day (\d+)/)?.[1]);
    const onDay = longest.filter((a: any) => a.day_number === issueDay);
    const pool = onDay.length ? onDay : longest;
    const act = pool.find((a: any) => message.includes(a.start_time)) ?? pool[0];
    // "opening hours are 09:00 to 17:00" names both ends; otherwise read opening and
    // closing separately ("open around 09:00-10:00 … close by 17:00-18:00").
    const span = message.match(/hours[^.]*?(\d{1,2}:\d{2})\s*(?:to|–|-)\s*(\d{1,2}:\d{2})/i);
    const open = span ? [toMinutes(span[1]), toMinutes(span[1])] : times(message.match(/open\w*[^.]*?(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?/i));
    const close = span ? [toMinutes(span[2]), toMinutes(span[2])] : times(message.match(/clos\w*[^.]*?(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?/i));
    if (!act || (!open && !close)) return "warn";
    const start = toMinutes(act.start_time);
    const end = start + (Number(act.duration_hours) || 1) * 60;
    const fits = (!open || start >= open[0]) && (!close || end <= close[1]);
    return fits ? "drop" : "block";
  });
}

/**
 * R10 (Daily Range) is only about far out-of-city trips or a second city in one day.
 * The AI also used it for "different parts of the city" — distance within a city is
 * the coordinate-based travel-time check's job — so an R10 issue that doesn't
 * mention a day trip, an excursion, leaving the city or another city is dropped.
 */
export function keepOutOfCityDailyRange(issues: any[]): any[] {
  const outOfCity = /day[- ]trip|excursion|outside (?:the |of )?(?:the )?city|out[- ]of[- ]city|another city|different cities|other city|countryside|hours? (?:away|from the city)/i;
  return issues.filter((issue) =>
    !String(issue?.rule ?? "").startsWith("R10") || outOfCity.test(`${issue.message ?? ""} ${issue.affected_item ?? ""}`));
}

// Agreed hard blocks among the AI rules: opening hours, day closures and travel
// time between activities. Every other AI rule is demoted to a warning.
const AI_HARD_RULES = ["R3", "R4"];

export function partitionAiHardErrors(hardErrors: any[], softWarnings: any[] = []): { allowed: any[]; downgraded: any[] } {
  const isHardRule = (issue: any) =>
    typeof issue?.rule === "string" && AI_HARD_RULES.some((code) => issue.rule.startsWith(`${code} `) || issue.rule === code);
  const allowed: any[] = [];
  const downgraded: any[] = [];
  // An agreed hard rule blocks whichever list the AI filed it in.
  for (const issue of [...hardErrors, ...softWarnings]) {
    if (isHardRule(issue)) allowed.push({ ...issue, severity: "error" });
    else downgraded.push({ ...issue, severity: "warning" });
  }
  return { allowed, downgraded };
}

/**
 * The AI sometimes reports one similar pair twice, once from each side ("A is like B",
 * then "B is like A"). Keep the first R14 issue for each set of activities it names.
 */
export function dedupeSimilarPairs(issues: any[], days: any[]): any[] {
  const names = [...new Set(days.flatMap((d: any) => (d.activities || []).map((a: any) => String(a.activity_name || "").toLowerCase())))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (!String(issue?.rule ?? "").startsWith("R14")) return true;
    let text = `${issue.affected_item ?? ""} ${issue.field_value ?? ""} ${issue.message ?? ""}`.toLowerCase();
    const mentioned: string[] = [];
    for (const name of names) {
      if (text.includes(name)) {
        mentioned.push(name);
        text = text.split(name).join(" ");
      }
    }
    if (mentioned.length < 2) return true;
    const key = mentioned.sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The AI's illegal_act flag used to only zero the score, leaving the creator with a
 * 0/100 and no reason. It's now a blocking error naming the activity (from the AI's
 * illegal_evidence quote) and its day, so the creator can see what to change.
 */
export function buildIllegalActError(aiResult: any, days: any[]): any | null {
  if (!aiResult?.scores?.illegal_act) return null;
  const evidence = String(aiResult.illegal_evidence || "").trim();
  const evidenceDay = findDayContainingText(days, evidence);
  const where = evidenceDay !== null ? ` on Day ${evidenceDay}` : "";
  return {
    error_code: "POLICY_VIOLATION",
    rule: "SafetyStatus",
    severity: "error",
    field: evidenceDay !== null ? `Day ${evidenceDay}` : "package_content",
    field_value: evidence || "N/A",
    affected_item: evidence || "Entire Package",
    message: evidence
      ? `"${evidence}"${where} may be illegal or unethical (AI-detected).`
      : "An activity in this package may be illegal or unethical (AI-detected).",
    action: "Change or remove this activity to continue.",
  };
}

const AI_UNAVAILABLE_WARNING = {
  error_code: "AI_CHECKS_UNAVAILABLE",
  rule: "System",
  severity: "warning",
  field: "package_content",
  field_value: "N/A",
  affected_item: "Entire Package",
  message: "Some AI checks couldn't run this time, so only the standard checks were applied.",
  action: "Run Check content again for the full set of checks.",
};

/**
 * Returned when the check itself fails. It must never pass: a package nobody could
 * check stays blocked until a check actually succeeds, and carries no made-up score.
 */
export function checkFailedResult() {
  return {
    package_id: "package",
    is_feasible: false,
    has_warnings: false,
    hard_errors: [{
      error_code: "CHECK_FAILED",
      rule: "System",
      severity: "error",
      field: "package_content",
      field_value: "N/A",
      affected_item: "Entire Package",
      message: "We couldn't finish checking your package. Please try again.",
      action: "Run Check content again. If it keeps failing, contact support.",
    }],
    soft_warnings: [],
    summary: "The check couldn't run.",
    quality_score: undefined,
    can_publish: false,
  };
}

/**
 * The AI usually also describes the illegal activity in its own issue list, which
 * partitionAiHardErrors demotes to a warning — drop that copy so the same activity
 * isn't shown both as a critical issue and as a warning.
 */
export function dropIllegalActDuplicates(issues: any[], illegalActError: any | null): any[] {
  const evidence = String(illegalActError?.field_value ?? "").trim().toLowerCase();
  if (!illegalActError || !evidence || evidence === "n/a") return issues;
  return issues.filter((issue) => String(issue?.affected_item ?? "").trim().toLowerCase() !== evidence);
}

export function runHardBlockFilters(pkg: any, warZones: string[], days: any[] = []) {
  const fullText = JSON.stringify(pkg).toLowerCase();
  const country = (pkg.country || "").toLowerCase();

  // Only the destination itself blocks; a mention in the text is a warning
  // (see findWordingWarnings).
  for (const zone of warZones) {
    if (country.trim() === zone) {
      return {
        blocked: true,
        type: "SafetyStatus",
        message: `Geopolitical Safety: Packages to ${zone} are restricted.`,
      };
    }
  }
  // Check per-day first (in day order) so a match can be attributed to a specific
  // day; a match that only shows up in a package-level field (trip name, hotel name)
  // falls through to the whole-package scan below with no day to point to.
  for (const day of days) {
    const dayText = dayTextBlob(day);
    for (const comp of BANNED_COMPETITORS) {
      if (hasWord(dayText, comp)) {
        return {
          blocked: true,
          type: "BrandSafety",
          message: `Brand Safety: Mentions of competitor '${comp}' are blocked, in Day ${day.day_number}.`,
          field: `Day ${day.day_number}`,
        };
      }
    }
  }
  for (const comp of BANNED_COMPETITORS) {
    if (hasWord(fullText, comp)) {
      return {
        blocked: true,
        type: "BrandSafety",
        message: `Brand Safety: Mentions of competitor '${comp}' are blocked.`,
      };
    }
  }
  for (const day of days) {
    const dayText = dayTextBlob(day);
    for (const word of PROFANITY_WORDS) {
      if (hasWord(dayText, word)) {
        return {
          blocked: true,
          type: "SafetyStatus",
          message: `Profanity detected in Day ${day.day_number}.`,
          field: `Day ${day.day_number}`,
        };
      }
    }
  }
  for (const word of PROFANITY_WORDS) {
    if (hasWord(fullText, word)) {
      return { blocked: true, type: "SafetyStatus", message: "Profanity detected in package content." };
    }
  }
  return { blocked: false };
}

/**
 * Non-blocking warnings for text that needs a second look: a context-dependent word
 * (SENSITIVE_WORDS) or a conflict country named in the text. One warning per word,
 * pointing at the first day it appears in when there is one.
 */
export function findWordingWarnings(pkg: any, warZones: string[], days: any[] = []): any[] {
  const fullText = JSON.stringify(pkg).toLowerCase();
  const warnings: any[] = [];
  const firstDayWith = (word: string) => days.find((day) => hasWord(dayTextBlob(day), word))?.day_number ?? null;

  for (const zone of warZones) {
    if (!hasWord(fullText, zone)) continue;
    const day = firstDayWith(zone);
    warnings.push({
      error_code: "CONFLICT_ZONE_MENTION",
      rule: "SafetyStatus",
      severity: "warning",
      field: day !== null ? `Day ${day}` : "package_content",
      field_value: zone,
      affected_item: day !== null ? `Day ${day}` : "Entire Package",
      message: `${day !== null ? `Day ${day}` : "This package"} mentions ${zone}, which is on the restricted travel list.`,
      action: "Make sure the trip doesn't travel there. A reviewer may ask about it.",
    });
  }
  for (const word of SENSITIVE_WORDS) {
    if (!hasWord(fullText, word)) continue;
    const day = firstDayWith(word);
    warnings.push({
      error_code: "CHECK_WORDING",
      rule: "SafetyStatus",
      severity: "warning",
      field: day !== null ? `Day ${day}` : "package_content",
      field_value: word,
      affected_item: day !== null ? `Day ${day}` : "Entire Package",
      message: `Check the wording of "${word}"${day !== null ? ` on Day ${day}` : ""}.`,
      action: "Make sure it reads as intended. A reviewer may ask about it.",
    });
  }
  return warnings;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const pkg = await req.json();

    if (!GEMINI_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured in apps/web/.env.local" },
        { status: 500 }
      );
    }

    // Parse days from payload
    let days: any[] = [];
    try {
      days = typeof pkg.days_json === "string" ? JSON.parse(pkg.days_json) : (pkg.days || []);
    } catch {
      days = [];
    }

    // 1. Text-based hard block filters (competitors, conflict destination, profanity)
    const blockCheck = runHardBlockFilters(pkg, CONFLICT_COUNTRIES, days);
    const wordingWarnings = findWordingWarnings(pkg, CONFLICT_COUNTRIES, days);
    let brandSafety = 1;
    let safetyStatus = 1;
    let hardBlockError: any = null;

    if (blockCheck.blocked) {
      if (blockCheck.type === "BrandSafety") brandSafety = 0;
      if (blockCheck.type === "SafetyStatus") safetyStatus = 0;
      hardBlockError = {
        error_code: "POLICY_VIOLATION",
        rule: blockCheck.type,
        severity: "error",
        field: blockCheck.field || "package_content",
        field_value: "N/A",
        affected_item: "Entire Package",
        message: blockCheck.message,
        action: "Remove prohibited content to proceed.",
      };
    }

    // 2. Code-based deterministic checks (see runCodeChecks) — always consistent
    const codeResults = runCodeChecks(days, pkg.arrival_landing);
    const coords = await fetchActivityCoordinates(days, pkg.city || "");
    const travelTimeErrors = checkTravelTimes(days, coords);
    const photosError = checkPackagePhotos(pkg); // R18 — package-level, not per-day


    // 3. AI contextual checks (R3, R4, R6, R10, R11, R12, R14, R15)
    //    see geminiGenerationConfig and the AI result cache for consistency
    let aiResult: any = { hard_errors: [], soft_warnings: [], scores: {}, summary: "" };
    // The deterministic checks above still gate when the AI can't run, but that must
    // show up as a warning rather than a silently thinner check.
    let aiAvailable = false;

    const rules = await fetchActiveRules();
    const systemPrompt = buildSystemPrompt(rules);
    const userPrompt = buildUserPrompt(pkg, days);

    console.log("\n========== [AI VALIDATE] PROMPT SENT TO GEMINI ==========");
    console.log(userPrompt);
    console.log("=========================================================\n");

    // The model settings are part of the key, so changing them can't serve old answers.
    const cacheKey = aiCacheKey(`${MODEL_NAME} ${JSON.stringify(geminiGenerationConfig(MODEL_NAME))}`, systemPrompt, userPrompt);
    const cached = getCachedAiResult(cacheKey);
    const res = cached ? null : await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: geminiGenerationConfig(MODEL_NAME),
      }),
    }).catch((err) => {
      console.warn("Gemini API unreachable — AI checks skipped:", err?.message);
      return null;
    });

    if (cached) {
      aiResult = cached;
      aiAvailable = true;
      console.log("[AI VALIDATE] Unchanged content — reusing the cached AI result.");
    } else if (!res) {
      // Already logged above.
    } else if (!res.ok) {
      console.warn(`Gemini API returned ${res.status}. Skipping AI contextual checks.`);
    } else {
      try {
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        aiResult = JSON.parse(raw.replace(/```json|```/g, "").trim());
        aiAvailable = true;
        putCachedAiResult(cacheKey, aiResult);
        console.log("\n========== [AI VALIDATE] GEMINI RESPONSE ==========");
        console.log(JSON.stringify(aiResult, null, 2));
        console.log("===================================================\n");
      } catch {
        console.warn("Failed to parse Gemini response — AI checks skipped.");
      }
    }

    // 3b. AI profanity recheck — a semantic second pass behind the static PROFANITY_WORDS
    //     list, catching misspellings/leetspeak/evasions the fixed list would miss.
    let aiProfanityError: any = null;
    if (!hardBlockError && Boolean(aiResult.scores?.contains_profanity)) {
      safetyStatus = 0;
      const evidenceDay = findDayContainingText(days, aiResult.profanity_evidence);
      aiProfanityError = {
        error_code: "POLICY_VIOLATION",
        rule: "SafetyStatus",
        severity: "error",
        field: evidenceDay !== null ? `Day ${evidenceDay}` : "package_content",
        field_value: aiResult.profanity_evidence || "N/A",
        affected_item: "Entire Package",
        message:
          evidenceDay !== null
            ? `Profanity detected in Day ${evidenceDay} (AI-detected).`
            : "Profanity detected in package content (AI-detected).",
        action: "Remove prohibited content to proceed.",
      };
    }

    const illegalActError = buildIllegalActError(aiResult, days);

    // 4. Merge: code results + AI contextual results + any policy block error
    //    R2 (post-landing transfer time) is fully owned by the deterministic code
    //    check above — the system prompt tells the AI never to flag it too, but that's
    //    not a hard guarantee the model always follows, so entries matching it are
    //    dropped here as well rather than relying on prompt wording alone.
    //    See isTransferTimeIssue/partitionAiHardErrors for why each filter exists.
    const cleanAi = (list: any[] | undefined) => keepRealAiRules(list || [])
      .filter((issue: any) => !isTransferTimeIssue(issue))
      .map((issue: any) => withDayField(issue, days));
    const { allowed: aiBlockCandidates, downgraded: aiSoftWarnings } =
      partitionAiHardErrors(cleanAi(aiResult.hard_errors), cleanAi(aiResult.soft_warnings));
    // R3 only blocks once code confirms it (verifyOpeningHours). The AI's R12 only
    // warns, and not for pairs whose travel time came from coordinates.
    const r3 = verifyOpeningHours(aiBlockCandidates.filter((i: any) => i.rule.startsWith("R3")), days);
    const r12 = verifyTransferGaps(
      aiSoftWarnings.filter((i: any) => i.rule.startsWith("R12")),
      days,
      (first, second) => coords.has(first) && coords.has(second),
    );
    const allowedAiHardErrors = [...aiBlockCandidates.filter((i: any) => !i.rule.startsWith("R3")), ...r3.blocks];
    const aiWarnings = [...aiSoftWarnings.filter((i: any) => !i.rule.startsWith("R12")), ...r3.warnings, ...r12.warnings];
    const mergedHardErrors = [
      ...codeResults.hard,
      ...travelTimeErrors,
      ...(photosError ? [photosError] : []),
      ...allowedAiHardErrors,
      ...(hardBlockError ? [hardBlockError] : []),
      ...(aiProfanityError ? [aiProfanityError] : []),
      ...(illegalActError ? [illegalActError] : []),
    ];
    const mergedSoftWarnings = [
      ...codeResults.soft,
      ...wordingWarnings,
      ...dedupeSimilarPairs(
        keepOutOfCityDailyRange(dropSingleActivityDailyRange(
          dropRepeatedDuplicates(dropIllegalActDuplicates(aiWarnings, illegalActError), codeResults.soft, days),
          days,
        )),
        days,
      ),
      ...(aiAvailable ? [] : [AI_UNAVAILABLE_WARNING]),
    ];

    // 5. Quality score: FinalScore = SafetyStatus x BrandSafety x [(Grammar x 0.2) + (Completeness x 0.3) + (Feasibility x 0.5)] x 100
    const scores = aiResult.scores || {};
    const grammar = Number(scores.grammar_score ?? 0.8);
    const completeness = Number(scores.completeness_score ?? 0.8);
    const feasibility = Number(
      scores.feasibility_score ?? (mergedHardErrors.length === 0 ? 0.9 : 0.4)
    );

    if (illegalActError) safetyStatus = 0;

    const weighted = grammar * 0.2 + completeness * 0.3 + feasibility * 0.5;
    const qualityScore = Math.round(safetyStatus * brandSafety * weighted * 100);
    const isFeasible = mergedHardErrors.length === 0;

    return NextResponse.json({
      package_id: pkg.package_id || "package",
      is_feasible: isFeasible,
      has_warnings: mergedSoftWarnings.length > 0,
      hard_errors: mergedHardErrors,
      soft_warnings: mergedSoftWarnings,
      summary:
        aiResult.summary ||
        (isFeasible ? "All checks passed." : "Issues found — review critical errors."),
      quality_score: qualityScore,
      can_publish: qualityScore >= 70 && isFeasible,
      ai_response: aiResult,
    });
  } catch (err: any) {
    console.warn("Validation handler error:", err.message);
    return NextResponse.json(checkFailedResult());
  }
}
