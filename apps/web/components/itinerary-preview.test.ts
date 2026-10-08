import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./itinerary-editor.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let previewHandler = "";
let previewButton: ts.JsxElement | null = null;

function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handlePreview") {
    previewHandler = `const handlePreview = ${node.initializer!.getText(file)};`;
  }
  if (
    ts.isJsxElement(node)
    && node.openingElement.tagName.getText(file) === "button"
    && node.children.some((child) => child.getText(file).trim() === "Preview")
  ) {
    previewButton = node;
  }
  ts.forEachChild(node, visit);
}
visit(file);

function buttonExpression(name: string) {
  assert.ok(previewButton, "Preview button must exist");
  const attribute = previewButton.openingElement.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText(file) === name,
  );
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return "false";
  return attribute.initializer.expression!.getText(file);
}

function previewDisabled(isReadyToSubmit: boolean) {
  const context = {
    isReadyToSubmit,
    feasLoading: false,
    saving: false,
    uploadingCount: 0,
    submitting: false,
    isLocked: false,
    __disabled: false,
  };
  runInNewContext(`__disabled = Boolean(${buttonExpression("disabled")});`, context);
  return context.__disabled;
}

async function runPreview(ready: boolean, failSave = false) {
  assert.notEqual(previewHandler, "", "Preview must use a dedicated navigation handler");
  const events: string[] = [];
  const notices: string[] = [];
  const sessionStorageWrites: Record<string, string> = {};
  const context = {
    isReadyToSubmit: ready,
    feasLoading: false,
    saving: false,
    uploadingCount: 0,
    submitting: false,
    isLocked: false,
    packageTitle: "Tokyo Trip",
    days: [{ id: "day-1", day: 1 }],
    pkg: { package_id: "pkg/1" },
    window: {
      sessionStorage: {
        setItem: (key: string, value: string) => { sessionStorageWrites[key] = value; },
      },
    },
    itinerarySnapshotStorageKey: (id: string) => `package-itinerary-snapshot:${id}`,
    accessToken: async () => "token",
    persistDraft: async () => {
      events.push("save");
      if (failSave) throw new Error("Save failed");
    },
    router: { push: (path: string) => events.push(`route:${path}`) },
    setSaving: () => {},
    showNotice: (message: string) => notices.push(message),
    onSessionExpired: () => {},
    setPackageStatus: () => {},
    CreatorApiError: class CreatorApiError extends Error { status = 500; },
    __result: undefined as Promise<void> | undefined,
  };
  runInNewContext(ts.transpile(`${previewHandler}\n__result = handlePreview();`), context);
  await context.__result;
  return { events, notices, sessionStorageWrites };
}

test("Preview is always rendered but disabled until the itinerary is ready, with a hint why", () => {
  assert.equal(previewDisabled(false), true);
  assert.equal(previewDisabled(true), false);
  assert.match(buttonExpression("title"), /isReadyToSubmit/);
});

test("Preview saves the ready itinerary and opens its detail page", async () => {
  const blocked = await runPreview(false);
  assert.deepEqual(blocked.events, []);

  const ready = await runPreview(true);
  assert.deepEqual(ready.events, ["save", "route:/packages/preview/pkg%2F1"]);
  assert.equal(
    ready.sessionStorageWrites["package-itinerary-snapshot:pkg/1"],
    JSON.stringify({ title: "Tokyo Trip", days: [{ id: "day-1", day: 1 }] }),
  );
});

test("Preview does not navigate when saving the latest itinerary fails", async () => {
  const result = await runPreview(true, true);

  assert.deepEqual(result.events, ["save"]);
  assert.match(result.notices.join(" "), /save failed/i);
});
