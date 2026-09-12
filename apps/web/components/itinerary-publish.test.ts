import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./itinerary-editor.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const buttons: ts.JsxOpeningElement[] = [];
let publishHandler = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handlePublish") {
    publishHandler = `const handlePublish = ${node.initializer!.getText(file)};`;
  }
  // publishButtonLabel is the shared label expression only the two real
  // "submit for review" buttons render — other buttons sharing the same
  // className (Add flight, Add hotel, Save changes, ...) don't reference it.
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "button"
    && node.children.some((child) => child.getText(file).includes("publishButtonLabel"))) {
    buttons.push(node.openingElement);
  }
  ts.forEachChild(node, visit);
}
visit(file);

// Execute the real button bindings without mounting unrelated catalog/map
// components. A disabled button must not dispatch its click. handlePublish
// is async (it saves then submits over the network), so the guard clauses
// run synchronously but the real submit path is exercised by awaiting the
// mocked accessToken/persistDraft/submitPackage calls to resolve.
async function clickPublish(button: ts.JsxOpeningElement, score: number | undefined, critical = false, loading = false) {
  const notices: string[] = [];
  let submitting = false;
  let packageStatus = "draft";
  const context = {
    displayScore: score,
    feasResult: score === undefined ? null : { is_feasible: !critical },
    hardErrors: critical ? [{}] : [],
    isReadyToPublish: score !== undefined && score >= 70 && !critical,
    feasLoading: loading,
    isLocked: false,
    submitting: false,
    showNotice: (message: string) => notices.push(message),
    setSubmitting: (value: boolean) => { submitting = value; },
    setPreviewOpen: () => {},
    setPackageStatus: (value: string) => { packageStatus = value; },
    accessToken: async () => "token",
    persistDraft: async () => {},
    submitPackage: async () => ({ package_id: "pkg-1", status: "pending_review" }),
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
    ts.transpile(`${publishHandler}\n__result = (${expression("disabled")}) ? Promise.resolve() : handlePublish();`),
    context,
  );
  await context.__result;
  return { notices, submitting, packageStatus };
}

test("both publish buttons explain insufficient scores without publishing", async () => {
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    const result = await clickPublish(button, 69);
    assert.equal(result.packageStatus, "draft");
    assert.match(result.notices.join(" "), /69.*70/);
  }
});

test("publish explains unchecked content and critical issues; only eligible trips proceed", async () => {
  for (const button of buttons) {
    assert.match((await clickPublish(button, undefined)).notices.join(" "), /check content/i);

    const blocked = await clickPublish(button, 90, true);
    assert.equal(blocked.packageStatus, "draft");
    assert.match(blocked.notices.join(" "), /critical/i);

    const eligible = await clickPublish(button, 70);
    assert.equal(eligible.packageStatus, "pending_review");
    assert.match(eligible.notices.join(" "), /submitted for review/i);

    const loading = await clickPublish(button, 70, false, true);
    assert.deepEqual(loading, { notices: [], submitting: false, packageStatus: "draft" });
  }
});
