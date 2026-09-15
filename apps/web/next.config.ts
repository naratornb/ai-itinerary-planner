import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "./lib/root-env";
import { previewApiUrl } from "./lib/preview-api";
import { relatedProjects } from "./vercel.json";

const configDirectory = dirname(fileURLToPath(import.meta.url));
loadRootEnv(resolve(configDirectory, "../../.env"));

const apiUrl = previewApiUrl(process.env.VERCEL_ENV, process.env.VERCEL_RELATED_PROJECTS, relatedProjects[0]);
const nextConfig: NextConfig = {
  // Inline the same preview URL into browser bundles and server routes.
  ...(apiUrl ? { env: { NEXT_PUBLIC_API_URL: apiUrl } } : {}),
};

export default nextConfig;
