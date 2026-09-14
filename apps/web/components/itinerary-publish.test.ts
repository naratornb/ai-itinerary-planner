import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./itinerary-editor.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const buttons: ts.JsxOpeningElement[] = [];
let submitHandler = "";
let submissionButtonLabel = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handleSubmit") {
    submitHandler = `const handleSubmit = ${node.initializer!.getText(file)};`;
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "submissionButtonLabel") {
    submissionButtonLabel = node.initializer!.getText(file);
  }
  // submissionButtonLabel is the shared label expression only the two real
  // "submit for review" buttons render — other buttons sharing the same
  // className (Add flight, Add hotel, Save changes, ...) don't reference it.
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "button"
    && node.children.some((child) => child.getText(file).includes("submissionButtonLabel"))) {
    buttons.push(node.openingElement);
  }
  ts.forEachChild(node, visit);
}
visit(file);

function readyButtonLabel() {
  const context = {
    isLocked: false,
    packageStatus: "draft",
    STATUS_LABELS: {},
    uploadingCount: 0,
    submitting: false,
    isReadyToSubmit: true,
    feasResult: { is_feasible: true },
    __label: "",
  };
  runInNewContext(`__label = ${submissionButtonLabel};`, context);
  return context.__label;
}

// Execute the real button bindings without mounting unrelated catalog/map
// components. A disabled button must not dispatch its click. handleSubmit
// is async (it saves then submits over the network), so the guard clauses
// run synchronously but the real submit path is exercised by awaiting the
// mocked accessToken/persistDraft/submitPackage calls to resolve.
async function clickSubmit(
  button: ts.JsxOpeningElement,
  score: number | undefined,
  critical = false,
  loading = false,
  uploadingCount = 0,
  failure?: "save" | "submit",
  stale = false,
) {
  const notices: string[] = [];
  const events: string[] = [];
  let submitting = false;
  let packageStatus = "draft";
  const context = {
    displayScore: score,
    feasResult: score === undefined ? null : { is_feasible: !critical },
    hardErrors: critical ? [{}] : [],
    isReadyToSubmit: score !== undefined && score >= 70 && !critical && !stale,
    resultStale: stale,
    feasLoading: loading,
    saving: false,
    uploadingCount,
    isLocked: false,
    submitting: false,
    submittingRef: { current: false },
    showNotice: (message: string) => notices.push(message),
    setSubmitting: (value: boolean) => { submitting = value; },
    setPreviewOpen: () => {},
    setPackageStatus: (value: string) => { packageStatus = value; },
    setEditingTitle: () => {},
    setEditingDayField: () => {},
    setEditingItem: () => {},
    setAddingAfter: () => {},
    CreatorApiError: class CreatorApiError extends Error { status = 500; },
    accessToken: async () => "token",
    persistDraft: async () => {
      events.push("save");
      if (failure === "save") throw new Error("Save failed");
    },
    submitPackage: async () => {
      events.push("submit");
      if (failure === "submit") throw new Error("Submit failed");
      return { package_id: "pkg-1", status: "pending_review" };
    },
    runFeasibilityCheck: () => { events.push("feasibility-check"); },
    pkg: { package_id: "pkg-1" },
    // Referenced as call arguments to submitPackage(fetch, API_URL, ...) —
    // the mock above ignores them, but they must resolve to something.
    fetch: undefined,
    API_URL: "",
    __result: undefined as Promise<void> | undefined,
  };
  function expression(name: string) {
    const attribute = button.attributes.properties.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText(file) === name);
    if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return "false";
    return attribute.initializer.expression!.getText(file);
  }
  runInNewContext(
    ts.transpile(`${submitHandler}\n__result = (${expression("disabled")}) ? Promise.resolve() : handleSubmit();`),
    context,
  );
  await context.__result;
  return { notices, submitting, packageStatus, events };
}

test("both submission buttons explain insufficient scores without submitting", async () => {
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    const result = await clickSubmit(button, 69);
    assert.equal(result.packageStatus, "draft");
    assert.match(result.notices.join(" "), /69.*70/);
  }
});

test("a ready package is submitted for review rather than described as published", () => {
  assert.equal(readyButtonLabel(), "Submit for review");
});

test("submission explains unchecked content and critical issues; only eligible trips proceed", async () => {
  for (const button of buttons) {
    const unchecked = await clickSubmit(button, undefined);
    assert.deepEqual(unchecked.events, ["feasibility-check"]);
    assert.equal(unchecked.notices.length, 0);
    assert.equal(unchecked.packageStatus, "draft");

    // A stale result (content edited after a critical-failing check) must
    // re-check rather than get stuck showing the old "fix issues" verdict.
    const staleAfterFix = await clickSubmit(button, 90, true, false, 0, undefined, true);
    assert.deepEqual(staleAfterFix.events, ["feasibility-check"]);
    assert.equal(staleAfterFix.notices.length, 0);
    assert.equal(staleAfterFix.packageStatus, "draft");

    const blocked = await clickSubmit(button, 90, true);
    assert.equal(blocked.packageStatus, "draft");
    assert.match(blocked.notices.join(" "), /critical/i);

    const eligible = await clickSubmit(button, 70);
    assert.equal(eligible.packageStatus, "pending_review");
    assert.match(eligible.notices.join(" "), /submitted for review/i);

    const loading = await clickSubmit(button, 70, false, true);
    assert.deepEqual(loading, { notices: [], submitting: false, packageStatus: "draft", events: [] });

    const uploading = await clickSubmit(button, 70, false, false, 1);
    assert.deepEqual(uploading, { notices: [], submitting: false, packageStatus: "draft", events: [] });
  }
});

test("a failed save never submits, while a failed submit keeps the saved draft retryable", async () => {
  const saveFailure = await clickSubmit(buttons[0], 70, false, false, 0, "save");
  assert.deepEqual(saveFailure.events, ["save"]);
  assert.equal(saveFailure.packageStatus, "draft");
  assert.match(saveFailure.notices.join(" "), /save failed/i);

  const submitFailure = await clickSubmit(buttons[0], 70, false, false, 0, "submit");
  assert.deepEqual(submitFailure.events, ["save", "submit"]);
  assert.equal(submitFailure.packageStatus, "draft");
  assert.match(submitFailure.notices.join(" "), /submit failed/i);
});
