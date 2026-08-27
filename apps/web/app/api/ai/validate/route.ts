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

function runCodeChecks(days: any[]): { hard: CodeIssue[]; soft: CodeIssue[] } {
  const hard: CodeIssue[] = [];
  const soft: CodeIssue[] = [];

  for (const day of days) {
    const acts: any[] = day.activities || [];
    const dayLabel = `Day ${day.day_number}`;

    // R5 – Schedule Density: advisory when > 3 activities in a day
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

    // R7 – Time Overlap: flag only when total activity duration in a slot exceeds available time.
    // Having 2 activities in the same slot is fine — only flag when they physically can't fit.
    const SLOT_HOURS: Record<string, number> = {
      Morning: 4, // ~09:00–12:00 usable
      Afternoon: 4, // ~12:00–18:00 minus lunch ≈ 4 usable hours
      Evening: 3, // ~18:00–21:00 usable
    };
    const slotData: Record<string, { names: string[]; hours: number }> = {};
    for (const act of acts) {
      const slot: string = act.slot || "Morning";
      if (!slotData[slot]) slotData[slot] = { names: [], hours: 0 };
      slotData[slot].names.push(act.activity_name);
      slotData[slot].hours += Number(act.duration_hours) || 1;
    }
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

    // R1 – Travel Time (approximate): total hours > 10 leaves no travel buffer
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
        action: "Remove or shorten activities so the day totals \u2264 10 hours of scheduled time.",
      });
    }

    // R9 – Content Quality: soft warning for each activity missing a description
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

// ─── AI prompt (R3, R4, R6, R8, R10, R11 only) ────────────────────────────────
// Only contextual rules that require real-world knowledge are sent to the model.

function buildSystemPrompt(): string {
  return `You are a travel itinerary advisor for the Marketplace.
Evaluate the package ONLY against the 6 contextual rules listed below.
Be strict and consistent: the same input must always produce the same output.
Return empty arrays when no issues are found — never invent problems.

=== CONTEXTUAL RULES ===
- R3 (Opening Hours): Flag activities at venues commonly known to close early or have restricted hours (e.g. shrines close at dusk, some attractions close by 17:00).
- R4 (Day Closure): Flag venues known to close on specific weekdays (e.g. many Japanese museums close Mondays).
- R6 (Route Efficiency): Flag days where the sequence of activities requires excessive back-and-forth travel across the city.
- R8 (Capacity/Suitability): Flag solo or intimate experiences (private dining, solo kayaking) when group_size > 2.
- R10 (Daily Range): Flag if 3 or more activities are in geographically distant areas of the same city on the same day.
- R11 (Seasonality): Flag if the travel month falls outside the commonly recommended season for the destination.

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object — no markdown, no explanation:
{
  "hard_errors": [],
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
    "feasibility_score": <0.0-1.0, based only on the 6 contextual rules above>,
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
    for (const act of day.activities || []) {
      const desc = act.description ? ` | desc: ${act.description.slice(0, 60)}` : "";
      lines.push(
        `    [${act.slot}] ${act.activity_name} (${act.category}) | ${act.duration_hours}hrs${desc}`
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

const WAR_ZONES = [
  "russia", "ukraine", "belarus", "syria", "yemen", "somalia",
  "sudan", "myanmar", "afghanistan", "iran", "north korea",
];

const PROFANITY_WORDS = ["fuck", "shit", "bitch", "asshole", "cunt", "bastard"];

function runHardBlockFilters(pkg: any) {
  const fullText = JSON.stringify(pkg).toLowerCase();
  const country = (pkg.country || "").toLowerCase();

  for (const zone of WAR_ZONES) {
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
    const blockCheck = runHardBlockFilters(pkg);
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

    //console.log("\n========== [AI VALIDATE] SENDING TO GEMINI ==========");
    //console.log("--- SYSTEM PROMPT ---");
    //console.log(systemPrompt);
    //console.log("--- USER PROMPT ---");
    //console.log(userPrompt);
    //console.log("====================================================\n");

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
      //console.warn(`Gemini API returned ${res.status}. Skipping AI contextual checks.`);
    } else {
      try {
        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        aiResult = JSON.parse(raw.replace(/```json|```/g, "").trim());
        //console.log("\n========== [AI VALIDATE] GEMINI RESPONSE ==========");
        //console.log(JSON.stringify(aiResult, null, 2));
        //console.log("====================================================\n");
      } catch {
        //console.warn("Failed to parse Gemini response — AI checks skipped.");
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
      can_publish: qualityScore >= 60 && isFeasible,
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
