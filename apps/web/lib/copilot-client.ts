import type { CopilotClient, CopilotRequestV1, CopilotResponseV1 } from "./copilot";

const COPILOT_ENDPOINT = "/api/ai/copilot";

export function createCopilotClient(): CopilotClient {
  return {
    async send(request: CopilotRequestV1): Promise<CopilotResponseV1> {
      // Omit session_id on the first turn rather than sending null — the
      // backend treats "no session" as the start of a new conversation.
      const body: Record<string, unknown> = { query: request.query };
      if (request.session_id) body.session_id = request.session_id;

      const res = await fetch(COPILOT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Co-Pilot request failed with status ${res.status}`);
      }
      return res.json();
    },

    async end(sessionId: string): Promise<void> {
      // Frees the session server-side. Best-effort: the influencer is
      // already leaving the editor, so a failure here isn't actionable.
      await fetch(`${COPILOT_ENDPOINT}/${sessionId}`, { method: "DELETE" }).catch(() => {});
    },
  };
}
