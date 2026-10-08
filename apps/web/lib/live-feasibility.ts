import { checkPackagePhotos, runCodeChecks, type ArrivalLanding, type CodeIssue } from "./feasibility";

// The server check runs these deterministic rules first and the AI after.
// They need no network, so the editor can re-run them on every edit and let a
// fixed critical issue disappear immediately; only the AI part waits for Re-check.

type IssueLike = { error_code: string; field?: string; affected_item: string };

export type LiveBaseline = { hard: Set<string>; soft: Set<string> };

export function issueKey(issue: IssueLike): string {
  return `${issue.error_code}|${issue.affected_item}|${issue.field ?? ""}`;
}

type LivePayload = {
  days_json: string;
  arrival_landing?: ArrivalLanding | null;
  photo_count?: number;
};

/** The rules the server runs without the AI, evaluated on the editor's current content. */
export function localChecks(payload: LivePayload): { hard: CodeIssue[]; soft: CodeIssue[] } {
  let days: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(payload.days_json);
    if (Array.isArray(parsed)) days = parsed;
  } catch {
    // Unparseable days: fall through with none, like the server does.
  }
  const { hard, soft } = runCodeChecks(days, payload.arrival_landing);
  const photos = checkPackagePhotos(payload);
  return { hard: [...hard, ...(photos ? [photos] : [])], soft };
}

export function baselineOf(issues: { hard: CodeIssue[]; soft: CodeIssue[] }): LiveBaseline {
  return { hard: new Set(issues.hard.map(issueKey)), soft: new Set(issues.soft.map(issueKey)) };
}

/**
 * Applies edits made since the last full check to its result: an issue the
 * deterministic rules reported then and no longer report now is dropped, one
 * they newly report is added, and everything else (AI findings, travel-time
 * and policy blocks) stays exactly as the server returned it.
 */
export function applyLiveFixes<T extends IssueLike>(
  serverIssues: T[],
  baseline: Set<string>,
  current: CodeIssue[],
): T[] {
  const currentKeys = new Set(current.map(issueKey));
  const kept = serverIssues.filter((issue) => !baseline.has(issueKey(issue)) || currentKeys.has(issueKey(issue)));
  const keptKeys = new Set(kept.map(issueKey));
  const added = current.filter((issue) => !baseline.has(issueKey(issue)) && !keptKeys.has(issueKey(issue)));
  return [...kept, ...(added as unknown as T[])];
}

type ResultLike<T> = { hard_errors: T[]; soft_warnings: T[] };

/**
 * What the feasibility panel shows: the last full result with edits made since
 * applied. `criticalFixedLive` means every critical issue the server reported
 * is now fixed; the server withheld its score because of them, so there is
 * none to show until a full re-check produces one.
 */
export function liveView<T extends IssueLike>(
  result: ResultLike<T> | null,
  baseline: LiveBaseline | null,
  current: { hard: CodeIssue[]; soft: CodeIssue[] } | null,
): { hardErrors: T[]; softWarnings: T[]; criticalFixedLive: boolean } {
  const serverHard = result?.hard_errors ?? [];
  const serverSoft = result?.soft_warnings ?? [];
  const live = baseline && current;
  const hardErrors = live ? applyLiveFixes(serverHard, baseline.hard, current.hard) : serverHard;
  const softWarnings = live ? applyLiveFixes(serverSoft, baseline.soft, current.soft) : serverSoft;
  const criticalFixedLive = serverHard.length > 0 && hardErrors.length === 0;
  return { hardErrors, softWarnings, criticalFixedLive };
}
