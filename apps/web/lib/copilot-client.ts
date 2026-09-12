import type {
  CopilotClient,
  CopilotNextAction,
  CopilotSuggestionV1,
  CopilotTurn,
} from "./copilot";
import { supabase } from "./supabase/client";

type BackendSuggestion = {
  item_id: string;
  item_type: CopilotSuggestionV1["item_type"];
  item_name: string;
  city: string;
  country?: string | null;
  price_aud?: number | null;
  price_unit: CopilotSuggestionV1["price_unit"];
  rating?: number | null;
  details?: Record<string, unknown> | null;
  why_recommended: string;
};

type TurnRead = {
  turn_id: string;
  message: string;
  next_action: CopilotNextAction;
  warnings?: { code: string; message: string }[] | null;
  suggestions?: BackendSuggestion[] | null;
};

async function failure(response: Response, fallback: string): Promise<Error> {
  if (response.status === 401) return new Error("Your session expired. Please sign in again.");
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message || fallback);
}

function toSuggestion(s: BackendSuggestion): CopilotSuggestionV1 {
  const d = (s.details ?? {}) as Record<string, unknown>;
  const durationMins = d.duration_mins as number | undefined;
  return {
    item_id: s.item_id,
    item_type: s.item_type,
    item_name: s.item_name,
    city: s.city,
    country: s.country ?? null,
    price_aud: s.price_aud ?? null,
    price_unit: s.price_unit,
    rating: s.rating ?? null,
    category: (d.category ?? d.room_type ?? d.cabin_class ?? null) as string | null,
    duration_hours: (d.duration_hours as number | undefined)
      ?? (durationMins ? durationMins / 60 : null),
    suitable_for: (d.suitable_for ?? null) as string | null,
    why_recommended: s.why_recommended,
  };
}

export async function sendCopilotTurn(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
  prompt: string,
): Promise<CopilotTurn> {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/ai/copilot/${encodeURIComponent(packageId)}/turns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ prompt }),
    },
  ).catch(() => {
    throw new Error("Could not reach the Co-Pilot. Please try again.");
  });
  if (!response.ok) {
    throw await failure(response, `Co-Pilot request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as TurnRead;
  return {
    turn_id: String(payload.turn_id),
    message: payload.message,
    next_action: payload.next_action,
    warnings: (payload.warnings ?? []).map((w) => w.message),
    suggestions: (payload.suggestions ?? []).map(toSuggestion),
  };
}

export async function setCopilotSuggestionStatus(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
  turnId: string,
  itemId: string,
  status: "accepted" | "dismissed",
): Promise<void> {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/ai/copilot/${encodeURIComponent(packageId)}/turns/${encodeURIComponent(turnId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ status }),
    },
  ).catch(() => {
    throw new Error("Could not reach the Co-Pilot. Please try again.");
  });
  // 409 means the suggestion was already resolved — the desired end state.
  if (response.ok || response.status === 409) return;
  throw await failure(response, `Co-Pilot update failed with status ${response.status}`);
}

export function createCopilotClient(apiUrl: string, packageId: string): CopilotClient {
  // Resolve the token per call — getSession() auto-refreshes, so a long editing
  // session doesn't strand the copilot with an expired JWT.
  const token = async () =>
    (await supabase.auth.getSession()).data.session?.access_token ?? "";
  return {
    send: async (prompt) => sendCopilotTurn(fetch, apiUrl, await token(), packageId, prompt),
    setSuggestionStatus: async (turnId, itemId, status) =>
      setCopilotSuggestionStatus(fetch, apiUrl, await token(), packageId, turnId, itemId, status),
  };
}
