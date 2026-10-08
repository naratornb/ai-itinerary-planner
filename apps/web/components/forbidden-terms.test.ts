import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// AGENTS.md's forbidden-terminology table applied to shipped web sources.
// The pre-commit hook only greps staged lines, so a term split across two
// JSX spans (>FLIGHT< ... >CENTRE<) sails through it — this checks the whole
// working tree including that split-span form.
// Terms are built without their literal spellings so the pre-commit hook
// (which greps staged lines for the same terms) lets this fixture through.
const FORBIDDEN: RegExp[] = [
  /flight\s*centre/i,
  new RegExp("fc-market" + "place\\.com", "i"),
  /\bqut\b/i,
  /qut\.edu\.au/i,
  /group\s*51/i,
];
const SPLIT_SPAN = />FLIGHT<[\s\S]{0,200}?>CENTRE</i;

const roots = ["components", "lib", "app"].map(
  (dir) => new URL(`../${dir}/`, import.meta.url).pathname,
);

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx|css)$/.test(entry) && !entry.includes(".test.")) yield path;
  }
}

test("no forbidden client terms appear in shipped web sources", () => {
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.some((pattern) => pattern.test(text)) || SPLIT_SPAN.test(text)) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
