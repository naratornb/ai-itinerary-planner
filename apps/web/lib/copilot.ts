export type CopilotItemType = "activity" | "hotel" | "flight";

export type CopilotNextAction = {
  type: "recommend" | "ask_clarification" | "warn" | "none";
  label: string;
};

export type CopilotSuggestionV1 = {
  item_id: string;
  item_type: CopilotItemType;
  item_name: string;
  city: string;
  country: string | null;
  price_aud: number | null;
  price_unit: "per_person" | "per_night";
  rating: number | null;
  category: string | null;
  duration_hours: number | null;
  suitable_for: string | null;
  why_recommended: string;
};

export type CopilotTurn = {
  turn_id: string;
  message: string;
  next_action: CopilotNextAction;
  warnings: string[];
  suggestions: CopilotSuggestionV1[];
};

export type CopilotMessageV1 = {
  id: string;
  role: "user" | "assistant";
  content: string;
  turn_id?: string;
  suggestions?: CopilotSuggestionV1[];
  warnings?: string[];
  next_action?: CopilotNextAction;
};

export interface CopilotClient {
  send(prompt: string): Promise<CopilotTurn>;
  setSuggestionStatus(
    turnId: string,
    itemId: string,
    status: "accepted" | "dismissed",
  ): Promise<void>;
}
