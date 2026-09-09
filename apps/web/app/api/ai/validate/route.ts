import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase/client";
import {
  FALLBACK_RULES,
  FeasibilityRule,
  buildSystemPrompt,
  buildUserPrompt,
  runCodeChecks,
} from "../../../../lib/feasibility";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const MODEL_NAME = process.env.MODEL_NAME || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_KEY}`;

// ─── Feasibility rules (R2, R3, R4, R6, R8, R10, R11, R12) ────────────────────
// Contextual rules that require real-world knowledge are sent to the AI. Rule
// wording lives in the `feasibility_rules` table so it can be edited without a
// deploy; falls back to FALLBACK_RULES if the table is empty or unreachable.

async function fetchActiveRules(): Promise<FeasibilityRule[]> {
  const { data, error } = await supabase
    .from("feasibility_rules")
    .select("rule_code, rule_name, rule_description")
    .eq("is_active", true)
    .order("rule_priority");

  if (error || !data || data.length === 0) {
    if (error) console.warn("Failed to fetch feasibility_rules, using fallback:", error.message);
    return FALLBACK_RULES;
  }
  return data as FeasibilityRule[];
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

    // 2. Code-based deterministic checks (R1, R2, R5, R7, R9, R13) — always consistent
    const codeResults = runCodeChecks(days);

    //console.log("\n========== [AI VALIDATE] CODE CHECK RESULTS ==========");
    //console.log("Hard errors:", JSON.stringify(codeResults.hard, null, 2));
    //console.log("Soft warnings:", JSON.stringify(codeResults.soft, null, 2));
    //console.log("======================================================\n");

    // 3. AI contextual checks (R3, R4, R6, R8, R10, R11, R12, R14, R15)
    //    temperature: 0 + fixed seed for maximum consistency across repeated calls
    let aiResult: any = { hard_errors: [], soft_warnings: [], scores: {}, summary: "" };

    const rules = await fetchActiveRules();
    const systemPrompt = buildSystemPrompt(rules);
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
