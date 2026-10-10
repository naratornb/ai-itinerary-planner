import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { buildReviewDayUpdates } from "./itinerary-review";
import { parseStashedFeasibility } from "../lib/feasibility-result";
import type { BuilderDay } from "../lib/itinerary-builder";

function day(overrides: Partial<BuilderDay> = {}): BuilderDay {
  return { id: "day-1", day: 1, title: "Day 1", meta: "", items: [], story: "", photos: [], ...overrides };
}

test("buildReviewDayUpdates keeps day photo associations and meta", () => {
  // Regression: the RPC upserts supplied day rows wholesale, so a payload
  // without media_ids/meta wrote them back empty — saving a draft from the
  // review page wiped every day's photos and meta.
  const updates = buildReviewDayUpdates([
    day({ meta: "food", photos: [{ src: "u1", alt: "a", media_id: "m1" }, { src: "u2", alt: "b", media_id: "m2" }] }),
  ]);

  assert.deepEqual(updates[0].media_ids, ["m1", "m2"]);
  assert.equal(updates[0].meta, "food");
});

test("buildReviewDayUpdates drops preview photos that never finished uploading", () => {
  const updates = buildReviewDayUpdates([
    day({ photos: [{ src: "blob:x", alt: "a" }, { src: "u1", alt: "b", media_id: "m1" }] }),
  ]);

  assert.deepEqual(updates[0].media_ids, ["m1"]);
});

test("buildReviewDayUpdates matches the editor's null/empty conventions", () => {
  const updates = buildReviewDayUpdates([day(), day({ day: 2, id: "day-2", title: "Markets" })]);

  assert.deepEqual(updates[0], { day_number: 1, title: null, summary: null, meta: null, media_ids: [] });
  assert.equal(updates[1].day_number, 2);
  assert.equal(updates[1].title, "Markets");
});

// Execute the real handleSubmit binding without mounting the page — the same
// AST/vm harness itinerary-publish.test.ts uses for the editor's submit path.
const reviewSource = readFileSync(new URL("./itinerary-review.tsx", import.meta.url), "utf8");
const reviewFile = ts.createSourceFile("review.tsx", reviewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submitHandler = "";
let persistHandler = "";
function visitSubmit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(reviewFile) === "handleSubmit") {
    submitHandler = `const handleSubmit = ${node.initializer!.getText(reviewFile)};`;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(reviewFile) === "persistReview") {
    persistHandler = `const persistReview = ${node.initializer!.getText(reviewFile)};`;
  }
  ts.forEachChild(node, visitSubmit);
}
visitSubmit(reviewFile);

async function runSubmit(updateFails = false, stashed: string | null = null) {
  const calls: string[] = [];
  const payloads: unknown[][] = [];
  const submitArgs: unknown[][] = [];
  const context = {
    fetch,
    API_URL: "http://api.test",
    pkg: { package_id: "pkg-1" },
    packageTitle: "Tokyo Trip",
    reviewDraft: { description: "typed on the review page", coverMediaId: null },
    packagePrice: 120,
    days: [],
    buildReviewDayUpdates: () => [{ day_number: 1 }],
    submitting: false,
    uploadingCount: 0,
    setSubmitting: () => {},
    setSubmitResult: () => {},
    accessToken: async () => "token",
    updatePackage: async (...args: unknown[]) => {
      calls.push("update");
      payloads.push(args);
      if (updateFails) throw new Error("Save failed");
    },
    window: { sessionStorage: { getItem: (key: string) => (key === "package-feasibility:pkg-1" ? stashed : null) } },
    feasibilityStorageKey: (id: string) => `package-feasibility:${id}`,
    parseStashedFeasibility,
    submitPackage: async (...args: unknown[]) => { calls.push("submit"); submitArgs.push(args); return { status: "in_review" }; },
    SubmitPackageError: class SubmitPackageError extends Error {},
    __result: undefined as Promise<void> | undefined,
  };
  assert.notEqual(persistHandler, "", "Submit must share a persistReview helper with Save Draft");
  runInNewContext(ts.transpile(`${persistHandler}\n${submitHandler}\n__result = handleSubmit();`), context);
  await context.__result;
  return { calls, payloads, submitArgs };
}

test("Submit for Review persists the review-page draft before submitting", async () => {
  // The description lives only in component state — submitting without saving
  // first shipped the stale server copy and stranded this page's edits.
  const { calls, payloads } = await runSubmit();

  assert.deepEqual(calls, ["update", "submit"]);
  const body = payloads[0][4] as Record<string, unknown>;
  assert.equal(body.description, "typed on the review page");
});

test("a failed draft save blocks submission instead of shipping stale content", async () => {
  const { calls } = await runSubmit(true);

  assert.deepEqual(calls, ["update"]);
});

test("submit and save wait for in-flight cover uploads", () => {
  // Regression: handleSubmit/saveDraft had no upload guard — submitting while
  // addCoverPhoto was in flight shipped the package without the photo and
  // left the finished upload orphaned (no day references it).
  const source = readFileSync(new URL("./itinerary-review.tsx", import.meta.url), "utf8");
  const handleSubmit = source.match(/const handleSubmit = async \(\) => \{[\s\S]*?\n  \};/);
  const saveDraft = source.match(/const saveDraft = async \(\) => \{[\s\S]*?\n  \};/);
  for (const [name, block] of [["handleSubmit", handleSubmit], ["saveDraft", saveDraft]] as const) {
    assert.ok(block, `${name} must exist`);
    assert.match(block[0], /uploadingCount > 0/, `${name} must bail while uploads are in flight`);
  }
});

test("removing a pending cover upload stops it landing on the package", () => {
  // Regression: the pending gallery entry (media_id "pending-…") had a live
  // Remove button that called the delete API with a fake id — the 404 left
  // the entry in place and the upload then completed anyway, resurrecting a
  // photo the user had just removed. Pending ids must be cancelled
  // client-side and the finished row deleted, matching the editor.
  const source = readFileSync(new URL("./itinerary-review.tsx", import.meta.url), "utf8");
  assert.match(source, /cancelledPreviews|cancelledTemp/, "must track cancelled pending uploads");
  const removePhoto = source.match(/const removePhoto = async \(photo[^)]*\) => \{[\s\S]*?\n  \};/);
  assert.ok(removePhoto, "removePhoto must exist");
  assert.match(removePhoto[0], /pending-/, "removePhoto must short-circuit pending uploads client-side");
});

test("Submit sends the feasibility result the editor stashed, and none when there isn't one", async () => {
  const stored = { quality_score: 84, is_feasible: true, hard_errors: [], soft_warnings: [], checked_at: "2026-10-08T04:22:00.000Z" };

  const withResult = await runSubmit(false, JSON.stringify(stored));
  assert.deepEqual(withResult.submitArgs[0][5], stored);

  // A direct visit, another tab, or a corrupted stash submits normally, just without a result.
  for (const stash of [null, "{not json", JSON.stringify({ hard_errors: "x" })]) {
    const without = await runSubmit(false, stash);
    assert.deepEqual(without.calls, ["update", "submit"]);
    assert.equal(without.submitArgs[0][5], null);
  }
});
