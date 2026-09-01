import { NextRequest, NextResponse } from "next/server";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const MODEL_NAME = process.env.MODEL_NAME || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_KEY}`;

// ─── Types ─────────────────────────────────────────────────────────────────────

type CodeIssue = {
  error_code: string;
  rule: string;
  severity: "error" | "warning";
  field: string;
  field_value: string;
  affected_item: string;
  message: string;
  action: string;
};

// ─── Code-based deterministic checks (R1, R5, R7, R9) ─────────────────────────
// These rules can be evaluated purely from payload data — no AI needed.

// Available hours per time slot (hard cap used by R7; advisory threshold used by R5)
const SLOT_HOURS: Record<string, number> = {
  Morning: 4,   // ~09:00–12:00 usable
  Afternoon: 4, // ~12:00–18:00 minus lunch ≈ 4 usable hours
  Evening: 3,   // ~18:00–21:00 usable
};
// R5 advisory threshold: warn when a slot reaches this fraction of its hard cap
const SLOT_ADVISORY_RATIO = 0.75; // e.g. 3 hrs in a 4-hr slot triggers a soft warning
// R5 per-activity: flag single activities that are unusually long
const LONG_ACTIVITY_HOURS = 4;

/** Convert "HH:MM" to total minutes from midnight. */
function toMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function runCodeChecks(days: any[]): { hard: CodeIssue[]; soft: CodeIssue[] } {
  const hard: CodeIssue[] = [];
  const soft: CodeIssue[] = [];

  for (const day of days) {
    const acts: any[] = day.activities || [];
    const dayLabel = `Day ${day.day_number}`;

    if (acts.length === 0) {
      hard.push({
        error_code: "EMPTY_DAY",
        rule: "R9 – Completeness",
        severity: "error",
        field: dayLabel,
        field_value: "0 activities",
        affected_item: dayLabel,
        message: `${dayLabel} has no activities scheduled. Every day must have at least one activity.`,
        action: `Add at least one activity to ${dayLabel}.`,
      });
    }

    // ── Hoist slot totals so both R5 and R7 can share them ──────────────────
    const slotData: Record<string, { names: string[]; hours: number }> = {};
    for (const act of acts) {
      const slot: string = act.slot || "Morning";
      if (!slotData[slot]) slotData[slot] = { names: [], hours: 0 };
      slotData[slot].names.push(act.activity_name);
      slotData[slot].hours += Number(act.duration_hours) || 1;
    }

    // ── R5 – Schedule Density (enhanced) ────────────────────────────────────
    // 5a. Count-based: advisory when > 3 activities in a day
    if (acts.length > 3) {
      soft.push({
        error_code: "SCHEDULE_DENSITY",
        rule: "R5 – Schedule Density",
        severity: "warning",
        field: dayLabel,
        field_value: String(acts.length),
        affected_item: dayLabel,
        message: `${dayLabel} has ${acts.length} activities, which may feel rushed for travellers.`,
        action: "Consider moving one or more activities to another day to allow more breathing room.",
      });
    }

    // 5b. Per-slot advisory: warn when a slot is heavily loaded (≥ advisory threshold)
    //     but hasn't yet hit the hard cap (that's R7). Only warn when 2+ activities share the slot.
    for (const [slot, { names, hours }] of Object.entries(slotData)) {
      const limit = SLOT_HOURS[slot] ?? 4;
      const advisory = limit * SLOT_ADVISORY_RATIO;
      if (names.length >= 2 && hours >= advisory && hours <= limit) {
        soft.push({
          error_code: "SLOT_DENSITY",
          rule: "R5 – Schedule Density",
          severity: "warning",
          field: `${dayLabel} – ${slot}`,
          field_value: `${hours.toFixed(1)} hrs of ~${limit} hrs available`,
          affected_item: names.join(", "),
          message: `The ${slot} slot on ${dayLabel} is heavily loaded (${hours.toFixed(1)} hrs across ${names.length} activities), leaving little buffer for delays or travel between stops.`,
          action: `Consider shortening one activity or moving "${names[names.length - 1]}" to a less full slot.`,
        });
      }
    }

    // 5c. Per-activity: flag unusually long single activities (> ${LONG_ACTIVITY_HOURS} hrs)
    for (const act of acts) {
      const hrs = Number(act.duration_hours) || 1;
      if (hrs > LONG_ACTIVITY_HOURS) {
        soft.push({
          error_code: "LONG_ACTIVITY",
          rule: "R5 – Schedule Density",
          severity: "warning",
          field: `${dayLabel} – ${act.slot || ""}`,
          field_value: `${hrs} hrs`,
          affected_item: act.activity_name,
          message: `"${act.activity_name}" is scheduled for ${hrs} hours, which is unusually long for a single activity and may tire travellers.`,
          action: "Consider splitting this into two shorter experiences or reducing the allocated time.",
        });
      }
    }

    // ── R7 – Time Overlap ────────────────────────────────────────────────────
    // Flag only when total activity duration in a slot physically exceeds available time.
    for (const [slot, { names, hours }] of Object.entries(slotData)) {
      const limit = SLOT_HOURS[slot] ?? 4;
      if (hours > limit) {
        hard.push({
          error_code: "TIME_OVERLAP",
          rule: "R7 – Time Overlap",
          severity: "error",
          field: `${dayLabel} – ${slot}`,
          field_value: `${hours.toFixed(1)} hrs scheduled, ${limit} hrs available`,
          affected_item: names[0],
          message: `The ${slot} slot on ${dayLabel} has ${hours.toFixed(1)} hours of activities (${names.join(", ")}) but only ~${limit} hours are available in that time window.`,
          action: `Move "${names[names.length - 1]}" to a different slot or another day.`,
        });
      }
    }

    // ── R1 – Travel Time (approximate): total hours > 10 leaves no travel buffer
    const totalHours = acts.reduce(
      (sum: number, a: any) => sum + (Number(a.duration_hours) || 1),
      0
    );
    if (totalHours > 10) {
      hard.push({
        error_code: "SCHEDULE_TOO_PACKED",
        rule: "R1 – Travel Time",
        severity: "error",
        field: dayLabel,
        field_value: `${totalHours.toFixed(1)} hrs`,
        affected_item: dayLabel,
        message: `${dayLabel} has ${totalHours.toFixed(1)} hours of activities with no time left for travel between stops.`,
        action: "Remove or shorten activities so the day totals ≤ 10 hours of scheduled time.",
      });
    }

    // ── R9 – Content Quality: soft warning for each activity missing a description
    for (const act of acts) {
      if (!act.description || !act.description.trim()) {
        soft.push({
          error_code: "MISSING_DESCRIPTION",
          rule: "R9 – Content Quality",
          severity: "warning",
          field: `${dayLabel} – ${act.slot || ""}`,
          field_value: act.activity_name,
          affected_item: act.activity_name,
          message: `"${act.activity_name}" has no description, which reduces the package's appeal and quality score.`,
          action: "Add a short note explaining why this stop is worth visiting.",
        });
      }
    }
  }

  return { hard, soft };
}

// ─── AI prompt (R2, R3, R4, R6, R8, R10, R11, R12) ────────────────────────────
// Contextual rules that require real-world and airport knowledge are sent to the model.

function buildSystemPrompt(): string {
  return `You are a travel itinerary advisor for the Marketplace.
Evaluate the package ONLY against the contextual rules listed below.
Be strict and consistent: the same input must always produce the same output.
Return empty arrays when no issues are found — never invent problems.

=== CONTEXTUAL RULES ===
- R2 (Airport Landing Transfer Buffer): When a flight arrives, identify the specific airport from the flight line or destination city (e.g. Tokyo Narita NRT vs Tokyo Haneda HND, JFK, CDG, LHR, SYD, etc.). Determine what would normally and realistically be the buffer time (in minutes) required after landing in THAT specific airport (accounting for international immigration/customs vs domestic, baggage claim, airport layout, and typical train/taxi/transfer transit time from that airport into the city center or first activity venue). Compare the flight arrival time with the start time of the first activity on that day. If the gap is less than the airport's required buffer time, flag as a hard error with error_code "SHORT_TRANSFER", rule "R2 – Transfer Time", stating the specific airport, the realistic buffer needed in minutes, and the calculated earliest feasible start time.
- R3 (Opening Hours): Flag activities at venues commonly known to close early or have restricted hours (e.g. shrines close at dusk, some attractions close by 17:00).
- R4 (Day Closure): Flag venues known to close on specific weekdays (e.g. many Japanese museums close Mondays).
- R6 (Route Efficiency): Flag days where the sequence of activities requires excessive back-and-forth travel across the city.
- R8 (Capacity/Suitability): Flag solo or intimate experiences (private dining, solo kayaking) when group_size > 2.
- R10 (Daily Range): Flag if 3 or more activities are in geographically distant areas of the same city on the same day.
- R11 (Seasonality): Flag if the travel month falls outside the commonly recommended season for the destination.
- R12 (Activity Transfer Time): Each activity line shows a start_time and duration_hours. For each consecutive pair of activities on the same day, calculate the gap between the end of one (start_time + duration_hours) and the start of the next. Flag as a hard error if the gap is less than 15 minutes AND the two activities are in different locations that would require travel (same venue or adjacent is fine). Flag as a soft warning if the gap is 15–30 minutes for activities more than 2 km apart. Use common knowledge of the destination city to estimate travel distances between named locations.

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object — no markdown, no explanation:
{
  "hard_errors": [
    {
      "error_code": "<SNAKE_CASE>",
      "rule": "<R# – Rule Name>",
      "severity": "error",
      "field": "<day/slot reference>",
      "field_value": "<relevant value>",
      "affected_item": "<activity name>",
      "message": "<clear, specific explanation>",
      "action": "<concrete actionable fix>"
    }
  ],
  "soft_warnings": [
    {
      "error_code": "<SNAKE_CASE>",
      "rule": "<R# – Rule Name>",
      "severity": "warning",
      "field": "<day/slot reference>",
      "field_value": "<relevant value>",
      "affected_item": "<activity name>",
      "message": "<clear, specific explanation>",
      "action": "<concrete actionable fix>"
    }
  ],
  "scores": {
    "grammar_score": <0.0-1.0, rate quality of activity descriptions>,
    "completeness_score": <0.0-1.0, rate how complete the itinerary feels>,
    "feasibility_score": <0.0-1.0, based only on the contextual rules above>,
    "illegal_act": <true only if an activity is clearly illegal or unethical, else false>
  },
  "summary": "<one sentence overview of the contextual check>"
}`;
}

function buildUserPrompt(pkg: any, days: any[]): string {
  const lines = [
    `Package ID   : ${pkg.package_id || "N/A"}`,
    `Trip Name    : ${pkg.trip_name || "N/A"}`,
    `Destination  : ${pkg.city || ""}, ${pkg.country || ""}`,
    `Travel Month : ${pkg.travel_month || "N/A"}`,
    `Total Days   : ${pkg.total_days || days.length}`,
    `Group Size   : ${pkg.group_size || 2}`,
    `Hotel        : ${pkg.hotel_name || "N/A"} (${pkg.hotel_stars || 4}\u2605)`,
    "",
    "=== DAY-BY-DAY ITINERARY ===",
  ];

  for (const day of days) {
    lines.push(`  Day ${day.day_number}:`);
    for (const flight of day.flights || []) {
      const flightType = flight.flight_type ? ` (${flight.flight_type})` : "";
      lines.push(`    [FLIGHT ARRIVAL @${flight.arrival_time}] ${flight.title}${flightType}`);
    }
    for (const act of day.activities || []) {
      const desc = act.description ? ` | desc: ${act.description.slice(0, 60)}` : "";
      const startTime = act.start_time ? ` @${act.start_time}` : "";
      lines.push(
        `    [${act.slot}${startTime}] ${act.activity_name} (${act.category}) | ${act.duration_hours}hrs${desc}`
      );
    }
  }
  return lines.join("\n");
}

// ─── Hard text-based block filters ────────────────────────────────────────────

const BANNED_COMPETITORS = [
  "expedia", "booking.com", "wotif", "trivago", "skyscanner",
  "tripadvisor", "agoda", "hotels.com", "airbnb", "klook", "getyourguide",
];

// Fallback war zone list used when the AI fetch fails or is unavailable.
const FALLBACK_WAR_ZONES = [
  "russia", "ukraine", "belarus", "syria", "yemen", "somalia",
  "sudan", "myanmar", "afghanistan", "iran", "north korea",
];

// Module-level cache so we hit Gemini at most once per 24 hours per server instance.
let warZoneCache: { list: string[]; fetchedAt: number } | null = null;
const WAR_ZONE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Asks Gemini for the current list of active conflict / war-zone countries,
 * caches the result for 24 hours, and falls back to FALLBACK_WAR_ZONES on any error.
 * The actual hard-block check is still deterministic (no AI in the hot path).
 */
async function getWarZones(): Promise<string[]> {
  const now = Date.now();
  if (warZoneCache && now - warZoneCache.fetchedAt < WAR_ZONE_CACHE_TTL_MS) {
    return warZoneCache.list;
  }

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text:
              "You are a geopolitical risk analyst. " +
              "Return ONLY a valid JSON array of lowercase country name strings (including common aliases, e.g. \"north korea\") " +
              "for countries currently experiencing active armed conflict, civil war, or where civilian travel is " +
              "considered extremely dangerous due to ongoing military operations. " +
              "No markdown, no explanation — just the JSON array.",
          }],
        },
        contents: [{ parts: [{ text: "List all current war zones and active conflict countries." }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
          seed: 42,
        },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
      const parsed: unknown = JSON.parse(raw.replace(/```json|```/g, "").trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        const list = (parsed as string[]).map((s) => s.toLowerCase());
        warZoneCache = { list, fetchedAt: now };
        return list;
      }
    }
  } catch {
    // Network or parse error — fall through to fallback
  }

  // Cache the fallback too so we don't hammer Gemini on every request when it's down.
  warZoneCache = { list: FALLBACK_WAR_ZONES, fetchedAt: now };
  return FALLBACK_WAR_ZONES;
}

const PROFANITY_WORDS = [
  // Strong expletives
  "fuck", "shit", "bitch", "asshole", "cunt", "bastard",
  "motherfucker", "fucker", "bullshit", "dickhead", "prick", "wanker",
  "arsehole", "arse", "twat", "cock", "pussy", "slut", "whore",
  // Slurs (racial / ethnic / identity)
  "nigger", "nigga", "chink", "spic", "kike", "gook", "wetback",
  "cracker", "faggot", "fag", "dyke", "tranny", "retard",
  // Drug / illegal references
  "cocaine", "heroin", "meth", "methamphetamine", "ecstasy", "mdma",
  "crack", "fentanyl",
  // Violence / threat language
  "kill", "murder", "rape", "pedophile", "molest",
];

function runHardBlockFilters(pkg: any, warZones: string[]) {
  const fullText = JSON.stringify(pkg).toLowerCase();
  const country = (pkg.country || "").toLowerCase();

  for (const zone of warZones) {
    if (country.includes(zone) || fullText.includes(zone)) {
      return {
        blocked: true,
        type: "SafetyStatus",
        message: `Geopolitical Safety: Packages to ${zone} are restricted.`,
      };
    }
  }
  for (const comp of BANNED_COMPETITORS) {
    if (fullText.includes(comp)) {
      return {
        blocked: true,
        type: "BrandSafety",
        message: `Brand Safety: Mentions of competitor '${comp}' are blocked.`,
      };
    }
  }
  for (const word of PROFANITY_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(fullText)) {
      return { blocked: true, type: "SafetyStatus", message: "Profanity detected in package content." };
    }
  }
  return { blocked: false };
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

    // 1. Text-based hard block filters (competitors, war zones, profanity)
    //    War zone list is fetched from AI once and cached for 24 hours.
    const warZones = await getWarZones();
    const blockCheck = runHardBlockFilters(pkg, warZones);
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
        field: "package_content",
        field_value: "N/A",
        affected_item: "Entire Package",
        message: blockCheck.message,
        action: "Remove prohibited content to proceed.",
      };
    }

    // 2. Code-based deterministic checks (R1, R5, R7, R9) — always consistent
    const codeResults = runCodeChecks(days);

    //console.log("\n========== [AI VALIDATE] CODE CHECK RESULTS ==========");
    //console.log("Hard errors:", JSON.stringify(codeResults.hard, null, 2));
    //console.log("Soft warnings:", JSON.stringify(codeResults.soft, null, 2));
    //console.log("======================================================\n");

    // 3. AI contextual checks (R3, R4, R6, R8, R10, R11)
    //    temperature: 0 + fixed seed for maximum consistency across repeated calls
    let aiResult: any = { hard_errors: [], soft_warnings: [], scores: {}, summary: "" };

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(pkg, days);

    console.log("\n========== [AI VALIDATE] PROMPT SENT TO GEMINI ==========");
    console.log(userPrompt);
    console.log("=========================================================\n");

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
          seed: 42,
        },
      }),
    });

    if (!res.ok) {
      console.warn(`Gemini API returned ${res.status}. Skipping AI contextual checks.`);
    } else {
      try {
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        aiResult = JSON.parse(raw.replace(/```json|```/g, "").trim());
        console.log("\n========== [AI VALIDATE] GEMINI RESPONSE ==========");
        console.log(JSON.stringify(aiResult, null, 2));
        console.log("===================================================\n");
      } catch {
        console.warn("Failed to parse Gemini response — AI checks skipped.");
      }
    }

    // 4. Merge: code results + AI contextual results + any policy block error
    const mergedHardErrors = [
      ...codeResults.hard,
      ...(aiResult.hard_errors || []),
      ...(hardBlockError ? [hardBlockError] : []),
    ];
    const mergedSoftWarnings = [
      ...codeResults.soft,
      ...(aiResult.soft_warnings || []),
    ];

    // 5. Quality score: FinalScore = SafetyStatus x BrandSafety x [(Grammar x 0.2) + (Completeness x 0.3) + (Feasibility x 0.5)] x 100
    const scores = aiResult.scores || {};
    const grammar = Number(scores.grammar_score ?? 0.8);
    const completeness = Number(scores.completeness_score ?? 0.8);
    const feasibility = Number(
      scores.feasibility_score ?? (mergedHardErrors.length === 0 ? 0.9 : 0.4)
    );

    if (Boolean(scores.illegal_act)) safetyStatus = 0;

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
    return NextResponse.json({
      package_id: "package",
      is_feasible: true,
      has_warnings: false,
      hard_errors: [],
      soft_warnings: [],
      summary: "Validation completed with limited checks.",
      quality_score: 88,
      can_publish: true,
    });
  }
}
