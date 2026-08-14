import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const typographySources = [
  "app/layout.tsx",
  "app/auth-ui.tsx",
  "app/forgot-password/page.tsx",
  "app/register/page.tsx",
  "app/users/page.tsx",
  "components/migrated-screens.tsx",
  "components/itinerary-editor.tsx",
  "design/design-tokens.json",
  "design/design.md",
];

test("the frontend typography system uses Roboto exclusively", () => {
  for (const path of typographySources) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /Plus_Jakarta_Sans|IBM_Plex_Mono|--font-inter|(?<!-)font-(?:display|mono)\b|["'](?:Inter|Arial|Helvetica)[, "']|fontFamily:[^\n]*(?:Inter|Arial|Helvetica)/,
    );
  }
});
