// Confirmed backend error classification (H.2 Context-Aware Co-Pilot spec).
export type CopilotErrorType =
  | "HUMAN_INPUT_ERROR"
  | "DB_GAP_ERROR"
  | "DETAIL_REQUEST"
  | null;

export type CopilotItemType = "activity" | "hotel" | "flight";

export type CopilotNextAction = {
  type: string;
  label: string;
  reason: string;
};

// Confirmed backend suggestion fields: real inventory ID, price, rating.
export type CopilotSuggestionV1 = {
  item_id: string;
  item_name: string;
  item_type: CopilotItemType;
  city: string;
  country: string;
  category: string;
  duration_hours: number;
  price_aud: number;
  rating: number;
  why_recommended: string;
  verified: boolean;
  confidence: number;
};

export type CopilotRequestV1 = {
  query: string;
  session_id: string | null;
};

export type CopilotResponseV1 = {
  session_id: string;
  copilot_message: string;
  error_type: CopilotErrorType;
  next_action: CopilotNextAction | null;
  suggestions: CopilotSuggestionV1[];
  auto_fill: { field: string | null; value: string | null };
  warnings: string[];
};

export type CopilotMessageV1 = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: CopilotSuggestionV1[];
  warnings?: string[];
  next_action?: CopilotNextAction | null;
};

export interface CopilotClient {
  send(request: CopilotRequestV1): Promise<CopilotResponseV1>;
  end(sessionId: string): Promise<void>;
}
