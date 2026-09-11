"use client";

import { useState } from "react";

import type { CopilotClient, CopilotMessageV1 } from "../../lib/copilot";

export function useCopilot(client: CopilotClient) {
  const [messages, setMessages] = useState<CopilotMessageV1[]>([]);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState("");

  // The retrieval endpoint only knows a destination if it can find a
  // catalog city's name inside the prompt text — it has no separate "which
  // day is this" field. Silently appending the current day's city lets
  // "find me a food activity" work without the traveler having to name a
  // place themselves; the displayed bubble still shows what they actually
  // typed.
  const send = async (prompt: string, city?: string | null) => {
    const content = prompt.trim();
    if (!content || sending) return;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);
    setSending(true);
    setRequestError("");

    const augmented = city && !content.toLowerCase().includes(city.toLowerCase())
      ? `${content} in ${city}`
      : content;

    try {
      const turn = await client.send(augmented);
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
