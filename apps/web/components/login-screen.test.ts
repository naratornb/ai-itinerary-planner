import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const screens = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

// A sign-in form must not pre-judge password length — registration's 8-char
// rule doesn't apply to accounts that already exist.
test("login password field carries no minLength", () => {
  assert.doesNotMatch(screens, /autoComplete="current-password"[\s\S]*?minLength/);
});

// Buttons that render but have no handler are dead UI — either they sign in
// or they don't ship.
test("login renders no non-functional social buttons", () => {
  assert.doesNotMatch(screens, /Continue with Google/);
  assert.doesNotMatch(screens, /Continue with Facebook/);
});

test("login links to register and password recovery", () => {
  assert.match(screens, /href="\/register"/);
  assert.match(screens, /href="\/forgot-password"/);
});

const resetPath = new URL("../app/reset-password/page.tsx", import.meta.url);

// forgot-password emails redirect here — without the route the link 404s.
test("reset-password route exists and updates the password", () => {
  assert.equal(existsSync(resetPath), true);
  const source = readFileSync(resetPath, "utf8");
  assert.match(source, /updateUser/);
});

const register = readFileSync(new URL("../app/register/page.tsx", import.meta.url), "utf8");

// Leftover template copy — this is the Influencer Travel Marketplace, not a
// database admin console.
test("register page names the product, not a template artifact", () => {
  assert.doesNotMatch(register, /Supabase Admin/);
});
