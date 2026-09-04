import { existsSync } from "node:fs";

export function loadRootEnv(envPath: string) {
  if (!existsSync(envPath)) return false;
  process.loadEnvFile(envPath);
  return true;
}
