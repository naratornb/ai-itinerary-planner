import type { CSSProperties } from "react";

export const AI_DISCLAIMER_TEXT = "AI can make mistakes. Double-check important info.";

export default function AiDisclaimer({ style }: { style?: CSSProperties }) {
  return <p className="ai-disclaimer" style={style}>{AI_DISCLAIMER_TEXT}</p>;
}
