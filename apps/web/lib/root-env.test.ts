import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadRootEnv } from "./root-env";

test("loadRootEnv loads the shared root env file", () => {
  const directory = mkdtempSync(join(tmpdir(), "root-env-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, "ROOT_ENV_TEST_VALUE=loaded\n");
  delete process.env.ROOT_ENV_TEST_VALUE;

  assert.equal(loadRootEnv(envPath), true);
  assert.equal(process.env.ROOT_ENV_TEST_VALUE, "loaded");

  delete process.env.ROOT_ENV_TEST_VALUE;
});

test("loadRootEnv leaves deployed environment variables alone when the file is absent", () => {
  process.env.ROOT_ENV_TEST_VALUE = "deployed";

  assert.equal(loadRootEnv("/missing/root/.env"), false);
  assert.equal(process.env.ROOT_ENV_TEST_VALUE, "deployed");

  delete process.env.ROOT_ENV_TEST_VALUE;
});
