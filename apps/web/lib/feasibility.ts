// ─── Types ─────────────────────────────────────────────────────────────────────

export type CodeIssue = {
  error_code: string;
  rule: string;
  severity: "error" | "warning";
  field: string;
  field_value: string;
  affected_item: string;
  message: string;
  action: string;
};

export type FeasibilityRule = {
  rule_code: string;
  rule_name: string;
  rule_description: string;
};

// ─── Code-based deterministic checks (R1, R2, R5, R7, R9, R13) ───────────────
// These rules can be evaluated purely from payload data — no AI needed.

// Available hours per time slot (hard cap used by R7; advisory threshold used by R5)
export const SLOT_HOURS: Record<string, number> = {
  Morning: 4,   // ~09:00–12:00 usable
  Afternoon: 4, // ~12:00–18:00 minus lunch ≈ 4 usable hours
  Evening: 3,   // ~18:00–21:00 usable
};
// R5 advisory threshold: warn when a slot reaches this fraction of its hard cap
export const SLOT_ADVISORY_RATIO = 0.75; // e.g. 3 hrs in a 4-hr slot triggers a soft warning
// R5 per-activity: flag single activities that are unusually long
export const LONG_ACTIVITY_HOURS = 4;
// R2 fixed post-landing transfer buffer, by flight type — replaces the old
// AI airport lookup with a flat, always-consistent number.
export const TRANSFER_BUFFER_MIN: Record<string, number> = {
  domestic: 60,
  international: 90,
};

/** Convert "HH:MM" to total minutes from midnight. */
export function toMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** Convert total minutes from midnight back to "HH:MM", wrapping into a 24h day. */
export function minutesToTime(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function runCodeChecks(days: any[]): { hard: CodeIssue[]; soft: CodeIssue[] } {
  const hard: CodeIssue[] = [];
  const soft: CodeIssue[] = [];

  for (const day of days) {
    const acts: any[] = day.activities || [];
    const flights: any[] = day.flights || [];
    const dayLabel = `Day ${day.day_number}`;

    // ── R2 – Airport Landing Transfer Buffer: fixed minutes by flight type
    //     (no AI airport lookup — same buffer every time, for consistency).
    if (acts.length > 0) {
      const firstActivity = acts.reduce((earliest: any, a: any) =>
        a.start_time && (!earliest || toMinutes(a.start_time) < toMinutes(earliest.start_time))
          ? a
          : earliest,
      null as any);

      if (firstActivity) {
        for (const flight of flights) {
          if (!flight.arrival_time) continue;
          // day.flights holds both arrivals and departures/return flights (the payload
          // labels every flight's time "arrival_time" regardless of direction). Only a
          // flight landing before the day's first activity is one you need to clear
          // before it — a flight later in the day (e.g. the return flight home) isn't.
          if (toMinutes(flight.arrival_time) >= toMinutes(firstActivity.start_time)) continue;
          const buffer = TRANSFER_BUFFER_MIN[flight.flight_type] ?? TRANSFER_BUFFER_MIN.domestic;
          const gap = toMinutes(firstActivity.start_time) - toMinutes(flight.arrival_time);
          if (gap < buffer) {
            hard.push({
              error_code: "SHORT_TRANSFER",
              rule: "R2 – Transfer Time",
              severity: "error",
              field: dayLabel,
              field_value: `${gap} min gap, ${buffer} min required`,
              affected_item: firstActivity.activity_name,
              message: `${flight.title || "The flight"} arrives at ${flight.arrival_time}, but "${firstActivity.activity_name}" starts at ${firstActivity.start_time} — only ${gap} minutes later. ${flight.flight_type === "international" ? "International" : "Domestic"} arrivals need at least ${buffer} minutes to clear the airport and reach the first stop.`,
              action: `Push "${firstActivity.activity_name}" to start no earlier than ${minutesToTime(toMinutes(flight.arrival_time) + buffer)}, or move it later in the day.`,
            });
          }
        }
      }
    }

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

  // ── R13 – Duplicate Activity: exact-name match, scheduled more than once across the
  //     trip. Advisory only — a traveller may genuinely want to revisit a spot, so this
  //     never hard-blocks. Near-duplicates with differently worded names (not caught by
  //     an exact match) are R14, an AI-contextual rule — see FALLBACK_RULES below.
  const occurrences: Record<string, { label: string; dayLabel: string }[]> = {};
  for (const day of days) {
    const dayLabel = `Day ${day.day_number}`;
    for (const act of day.activities || []) {
      const name = String(act.activity_name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!occurrences[key]) occurrences[key] = [];
      occurrences[key].push({ label: name, dayLabel });
    }
  }
  for (const entries of Object.values(occurrences)) {
    if (entries.length < 2) continue;
    const name = entries[0].label;
    const dayLabels = entries.map((e) => e.dayLabel);
    soft.push({
      error_code: "DUPLICATE_ACTIVITY",
      rule: "R13 – Duplicate Activity",
      severity: "warning",
      field: dayLabels.join(", "),
      field_value: String(entries.length),
      affected_item: name,
      message: `"${name}" is scheduled ${entries.length} times across the trip (${dayLabels.join(", ")}), which may be unintentional.`,
      action: "Remove the extra occurrence or swap it for a different activity if repeating it wasn't intended.",
    });
  }

  return { hard, soft };
}

// ─── AI prompt (R3, R4, R6, R8, R10, R11, R12, R14, R15) ──────────────────────
// Contextual rules that require real-world knowledge or semantic judgment are
// sent to the model (R2's airport transfer buffer moved to a fixed-number code
// check above — see TRANSFER_BUFFER_MIN). Rule wording is normally supplied by
// the caller from the `feasibility_rules` DB table (active rows, ordered by
// rule_priority); FALLBACK_RULES below is used only when that fetch fails or
// returns nothing, so the checks degrade gracefully.

export const FALLBACK_RULES: FeasibilityRule[] = [
  {
    rule_code: "R3",
    rule_name: "Opening Hours",
    rule_description:
      "Flag activities at venues commonly known to close early or have restricted hours (e.g. shrines close at dusk, some attractions close by 17:00, Tsukiji Outer Market stalls generally close by 14:00-15:00). Always classify these as a SOFT WARNING, never a hard error, with error_code \"OPENING_HOURS\", rule \"R3 – Opening Hours\", since opening hours can vary or the creator may intend a partial visit, so it doesn't block publishing on its own.",
  },
  {
    rule_code: "R4",
    rule_name: "Day Closure",
    rule_description:
      "Flag venues known to close on specific weekdays (e.g. many Japanese museums close Mondays).",
  },
  {
    rule_code: "R6",
    rule_name: "Route Efficiency",
    rule_description:
      "Flag days where the sequence of activities requires excessive back-and-forth travel across the city.",
  },
  {
    rule_code: "R8",
    rule_name: "Capacity/Suitability",
    rule_description:
      "Flag solo or intimate experiences (private dining, solo kayaking) when group_size > 2.",
  },
  {
    rule_code: "R10",
    rule_name: "Daily Range",
    rule_description:
      "Flag if 2 or more activities on the same day are in geographically distant areas — including combining a far out-of-city day-trip excursion (e.g. Mt. Fuji, Nikko, Hakone, or anywhere requiring 1+ hours of one-way travel from the city center) with ANY other activity that same day, not just 3+ activities spread across a city. This is often intentional (an early start and late finish on a packed day), so always classify these as a SOFT WARNING, never a hard error, with error_code \"DAILY_RANGE\", rule \"R10 – Daily Range\", so it doesn't block publishing on its own.",
  },
  {
    rule_code: "R11",
    rule_name: "Seasonality",
    rule_description:
      "Flag if the travel month falls outside the commonly recommended season for the destination.",
  },
  {
    rule_code: "R12",
    rule_name: "Activity Transfer Time",
    rule_description:
      "Each activity line shows a start_time and duration_hours. For each consecutive pair of activities on the same day, calculate the gap between the end of one (start_time + duration_hours) and the start of the next. Flag as a hard error if the gap is less than 15 minutes AND the two activities are in different locations that would require travel (same venue or adjacent is fine). Flag as a soft warning if the gap is 15–30 minutes for activities more than 2 km apart. Use common knowledge of the destination city to estimate travel distances between named locations.",
  },
  {
    rule_code: "R14",
    rule_name: "Similar Duplicate Activity",
    rule_description:
      "Compare activity names across ALL days of the itinerary, not just within a single day. Flag pairs that are very likely the same real-world activity even though the wording differs — reordered words, added/removed filler words, minor spelling or translation differences, or the same venue described slightly differently (e.g. \"Senso-ji Temple Visit\" vs \"Visit Senso-ji Temple\", \"Tsukiji Fish Market Tour\" vs \"Tsukiji Market Walking Tour\"). Do NOT flag activities that are merely in the same category or area but are clearly different experiences. Always classify these as a SOFT WARNING, never a hard error, with error_code \"SIMILAR_DUPLICATE_ACTIVITY\", rule \"R14 – Similar Duplicate Activity\", naming both activities and the days they fall on.",
  },
  {
    rule_code: "R15",
    rule_name: "General Feasibility",
    rule_description:
      "Beyond the specific numbered rules above, use your general travel-planning judgment to catch any other concrete, real-world feasibility problem a professional travel agent would object to and that isn't already covered — for example an itinerary item that's factually wrong for the destination, a logistically impossible sequence, or anything else clearly unworkable. Only flag issues you are reasonably confident about; do not invent minor, subjective, or speculative issues, and do not repeat something already covered by another rule. Always classify these as a SOFT WARNING, never a hard error, with error_code \"GENERAL_FEASIBILITY\", rule \"R15 – General Feasibility\", so a novel judgment call never blocks publishing on its own.",
  },
];

export function buildSystemPrompt(rules: FeasibilityRule[]): string {
  const rulesText = rules
    .map((r) => `- ${r.rule_code} (${r.rule_name}): ${r.rule_description}`)
    .join("\n");

  return `You are a travel itinerary advisor for the Marketplace.
Evaluate the package ONLY against the contextual rules listed below.
Be strict and consistent: the same input must always produce the same output.
Return empty arrays when no issues are found — never invent problems.

Do NOT flag the gap between a flight's arrival time and the day's first activity (post-landing
transfer/immigration/customs time) under any rule, including general or route-efficiency judgment
calls. That check is already handled deterministically elsewhere with a fixed policy: domestic
arrivals need at least 1 hour before the first activity, international arrivals need at least 1.5
hours. Only raise a post-landing transfer concern if you believe the gap is shorter than those
thresholds, and if you do, phrase the fix using this same policy (1 hour domestic / 1.5 hours
international) rather than inventing your own numbers.

=== CONTEXTUAL RULES ===
${rulesText}

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

export function buildUserPrompt(pkg: any, days: any[]): string {
  const lines = [
    `Package ID   : ${pkg.package_id || "N/A"}`,
    `Trip Name    : ${pkg.trip_name || "N/A"}`,
    `Destination  : ${pkg.city || ""}, ${pkg.country || ""}`,
    `Travel Month : ${pkg.travel_month || "N/A"}`,
    `Total Days   : ${pkg.total_days || days.length}`,
    `Group Size   : ${pkg.group_size || 2}`,
    `Hotel        : ${pkg.hotel_name || "N/A"} (${pkg.hotel_stars || 4}★)`,
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
