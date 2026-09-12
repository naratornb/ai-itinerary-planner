"use client";

import { useState } from "react";

import type { CopilotClient, CopilotMessageV1 } from "../../lib/copilot";

export function useCopilot(client: CopilotClient) {
  const [messages, setMessages] = useState<CopilotMessageV1[]>([]);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState("");

  const send = async (prompt: string) => {
    const content = prompt.trim();
    if (!content || sending) return;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);
    setSending(true);
    setRequestError("");

    try {
      const turn = await client.send(content);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: turn.message,
          turn_id: turn.turn_id,
          suggestions: turn.suggestions,
          warnings: turn.warnings,
          next_action: turn.next_action,
        },
      ]);
    } catch (err) {
      setRequestError(
        err instanceof Error && err.message
          ? err.message
          : "The response could not be loaded. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return { messages, loading: sending, requestError, send };
}
