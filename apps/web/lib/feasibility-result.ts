// The feasibility result a creator's editor produced at submission, in the
// shape the backend is asked to store and return as `latest_feasibility`
// (same fields as the /api/ai/validate response, minus the AI payload).

export type FeasibilityIssue = {
  error_code: string;
  rule: string;
  severity: "error" | "warning";
  field?: string;
  field_value?: string;
  affected_item: string;
  message: string;
  action: string;
};

export type SubmittedFeasibility = {
  quality_score: number | null;
  is_feasible: boolean;
  hard_errors: FeasibilityIssue[];
  soft_warnings: FeasibilityIssue[];
  checked_at: string;
};

export function feasibilityStorageKey(packageId: string): string {
  return `package-feasibility:${packageId}`;
}

type CheckResult = {
  is_feasible: boolean;
  hard_errors: FeasibilityIssue[];
  soft_warnings: FeasibilityIssue[];
  quality_score?: number | null;
};

/** What the editor hands over at submission: the check result plus when it ran. */
export function toSubmittedFeasibility(result: CheckResult | null, checkedAt: number | null): SubmittedFeasibility | null {
  if (!result) return null;
  return {
    quality_score: typeof result.quality_score === "number" ? result.quality_score : null,
    is_feasible: result.is_feasible,
    hard_errors: result.hard_errors,
    soft_warnings: result.soft_warnings,
    checked_at: new Date(checkedAt ?? Date.now()).toISOString(),
  };
}

function parseIssue(value: unknown): FeasibilityIssue | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.message !== "string" || typeof item.affected_item !== "string") return null;
  return {
    error_code: typeof item.error_code === "string" ? item.error_code : "",
    rule: typeof item.rule === "string" ? item.rule : "",
    severity: item.severity === "error" ? "error" : "warning",
    ...(typeof item.field === "string" ? { field: item.field } : {}),
    ...(typeof item.field_value === "string" ? { field_value: item.field_value } : {}),
    affected_item: item.affected_item,
    message: item.message,
    action: typeof item.action === "string" ? item.action : "",
  };
}

const parseIssues = (value: unknown): FeasibilityIssue[] =>
  Array.isArray(value) ? value.flatMap((entry) => { const issue = parseIssue(entry); return issue ? [issue] : []; }) : [];

/**
 * Reads a stored or stashed result defensively: it came from a client, so
 * anything malformed reads as "nothing recorded" rather than breaking a page.
 */
export function parseSubmittedFeasibility(value: unknown): SubmittedFeasibility | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.hard_errors) || !Array.isArray(item.soft_warnings)) return null;
  const score = typeof item.quality_score === "number" && Number.isFinite(item.quality_score) ? item.quality_score : null;
  return {
    quality_score: score,
    is_feasible: item.is_feasible === true,
    hard_errors: parseIssues(item.hard_errors),
    soft_warnings: parseIssues(item.soft_warnings),
    checked_at: typeof item.checked_at === "string" ? item.checked_at : "",
  };
}

export function parseStashedFeasibility(raw: string | null): SubmittedFeasibility | null {
  if (!raw) return null;
  try {
    return parseSubmittedFeasibility(JSON.parse(raw));
  } catch {
    return null;
  }
}
