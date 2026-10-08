/** Vercel supplies branch aliases for related projects on Git deployments. */
export function previewApiUrl(environment: string | undefined, metadata: string | undefined, projectId: string): string | undefined {
  if (environment !== "preview") return undefined;
  try {
    const projects: unknown = JSON.parse(metadata ?? "[]");
    if (Array.isArray(projects)) {
      const project = projects.find((entry) => entry?.project?.id === projectId);
      const host: unknown = project?.preview?.branch;
      if (typeof host === "string" && /^[a-z0-9.-]+\.vercel\.app$/.test(host)) {
        return `https://${host}`;
      }
    }
  } catch {
    // Report a configuration error without exposing deployment metadata.
  }
  throw new Error("API preview pairing is missing or invalid. Deploy both projects through Vercel Git integration with relatedProjects configured.");
}
