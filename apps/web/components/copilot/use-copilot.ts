"use client";

import { useEffect, useRef, useState } from "react";

import type { CopilotClient, CopilotMessageV1 } from "../../lib/copilot";

export function useCopilot(client: CopilotClient) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessageV1[]>([]);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState("");

  // A ref so the unmount cleanup below always sees the latest session,
  // without re-registering the effect on every turn.
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) void client.end(activeSessionId);
    };
    // Only ever runs on unmount — the influencer leaving the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (query: string) => {
    const content = query.trim();
    if (!content || sending) return;

    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content },
    ]);
    setSending(true);
    setRequestError("");

    try {
      const response = await client.send({ query: content, session_id: sessionId });
      setSessionId(response.session_id);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.copilot_message,
          suggestions: response.suggestions ?? [],
          warnings: response.warnings ?? [],
          next_action: response.next_action,
        },
      ]);
    } catch {
      setRequestError("The response could not be loaded. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return { messages, loading: sending, requestError, send };
}
