import assert from "node:assert/strict";
import test from "node:test";

import { resolveSupabaseConfig } from "./client";

test("missing Supabase settings use a non-crashing local demo configuration", () => {
  assert.deepEqual(resolveSupabaseConfig(undefined, undefined), {
    url: "https://api.example.com",
    anonKey: "local-demo-anon-key",
    configured: false,
  });
});

test("provided Supabase settings are preserved", () => {
  assert.deepEqual(resolveSupabaseConfig("https://project.supabase.co", "anon-key"), {
    url: "https://project.supabase.co",
    anonKey: "anon-key",
    configured: true,
  });
});
