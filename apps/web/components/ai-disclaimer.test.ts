import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the AI disclaimer uses the agreed copy and shared styling", () => {
  assert.match(read("./ai-disclaimer.tsx"), /AI can make mistakes\. Double-check important info\./);
  assert.match(read("../app/globals.css"), /\.ai-disclaimer\s*\{/);
});

test("the AI disclaimer renders on every surface that shows AI output", () => {
  for (const path of [
    "./copilot/copilot-panel.tsx",
    "./itinerary-editor.tsx",
    "./itinerary-review.tsx",
    "./migrated-screens.tsx",
  ]) {
    assert.match(read(path), /<AiDisclaimer[\s/>]/, path);
  }
});
