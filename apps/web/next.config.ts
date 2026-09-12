import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "./lib/root-env";

const configDirectory = dirname(fileURLToPath(import.meta.url));
loadRootEnv(resolve(configDirectory, "../../.env"));

const nextConfig: NextConfig = {};

export default nextConfig;
