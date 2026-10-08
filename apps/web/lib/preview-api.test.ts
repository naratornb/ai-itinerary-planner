import assert from "node:assert/strict";
import test from "node:test";
import { previewApiUrl } from "./preview-api";

test("preview pairing overrides production and fails closed without a branch host", () => {
  const project = { project: { id: "api" }, preview: { branch: "api-feature.vercel.app" } };
  assert.equal(previewApiUrl("preview", JSON.stringify([project]), "api"), "https://api-feature.vercel.app");
  for (const metadata of [undefined, "bad json", "{}", "[]", JSON.stringify([{ ...project, preview: {} }])]) {
    assert.throws(() => previewApiUrl("preview", metadata, "api"), /API preview/);
  }
  assert.throws(() => previewApiUrl("preview", JSON.stringify([project]), "other"), /API preview/);
  assert.equal(previewApiUrl("production", undefined, "api"), undefined);
  assert.equal(previewApiUrl(undefined, undefined, "api"), undefined);
});
