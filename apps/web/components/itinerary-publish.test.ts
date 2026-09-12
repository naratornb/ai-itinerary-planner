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
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "button"
    && node.children.some((child) => child.getText(file).includes("Continue to publish"))) {
    buttons.push(node.openingElement);
  }
  ts.forEachChild(node, visit);
}
visit(file);

// Execute the real button bindings without mounting unrelated catalog/map
// components. A disabled button must not dispatch its click.
function clickPublish(button: ts.JsxOpeningElement, score: number | undefined, critical = false, loading = false) {
  const notices: string[] = [];
  let published = false;
  const context = {
    displayScore: score,
    feasResult: score === undefined ? null : { is_feasible: !critical },
    hardErrors: critical ? [{}] : [],
    isReadyToPublish: score !== undefined && score >= 70 && !critical,
    feasLoading: loading,
    showNotice: (message: string) => notices.push(message),
    setPublished: (value: boolean) => { published = value; },
    setPreviewOpen: () => {},
  };
  function expression(name: string) {
    const attribute = button.attributes.properties.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText(file) === name);
    if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) return "false";
    return attribute.initializer.expression!.getText(file);
  }
  runInNewContext(ts.transpile(`${publishHandler}\nif (!(${expression("disabled")})) (${expression("onClick")})();`), context);
  return { notices, published };
}

test("both publish buttons explain insufficient scores without publishing", () => {
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    const result = clickPublish(button, 69);
    assert.equal(result.published, false);
    assert.match(result.notices.join(" "), /69.*70/);
  }
});

test("publish explains unchecked content and critical issues; only eligible trips proceed", () => {
  for (const button of buttons) {
    assert.match(clickPublish(button, undefined).notices.join(" "), /check content/i);
    const blocked = clickPublish(button, 90, true);
    assert.equal(blocked.published, false);
    assert.match(blocked.notices.join(" "), /critical/i);
    assert.equal(clickPublish(button, 70).published, true);
    assert.deepEqual(clickPublish(button, 70, false, true), { notices: [], published: false });
  }
});
