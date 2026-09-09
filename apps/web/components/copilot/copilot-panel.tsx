"use client";

import { useState, type FormEvent } from "react";

import type { CopilotClient, CopilotSuggestionV1 } from "../../lib/copilot";
import { useCopilot } from "./use-copilot";

type CopilotPanelProps = {
  client: CopilotClient;
  dayLabel: string;
  onAddSuggestion: (suggestion: CopilotSuggestionV1) => void;
  onClose: () => void;
  mobileOpen: boolean;
};

const EXAMPLE_PROMPTS = [
  "Find me a food activity in Tokyo",
  "Something adventurous next",
  "Tell me more about that one",
];

function CopilotMark() {
  return (
    <span className="copilot-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 3.5c.7 4.8 3.7 7.8 8.5 8.5-4.8.7-7.8 3.7-8.5 8.5-.7-4.8-3.7-7.8-8.5-8.5 4.8-.7 7.8-3.7 8.5-8.5Z" />
      </svg>
    </span>
  );
}

export default function CopilotPanel({ client, dayLabel, onAddSuggestion, onClose, mobileOpen }: CopilotPanelProps) {
  const [input, setInput] = useState("");
  const [addedSuggestionIds, setAddedSuggestionIds] = useState<string[]>([]);
  const { messages, loading, requestError, send } = useCopilot(client);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;
    setInput("");
    void send(prompt);
  };

  const addSuggestion = (suggestion: CopilotSuggestionV1) => {
    if (addedSuggestionIds.includes(suggestion.item_id)) return;
    onAddSuggestion(suggestion);
    setAddedSuggestionIds((current) => [...current, suggestion.item_id]);
  };

  return (
    <section className={`editor-panel copilot-panel${mobileOpen ? " mobile-open" : ""}`} aria-labelledby="copilot-title">
      <header className="copilot-header">
        <button className="copilot-back" type="button" onClick={onClose}>Back</button>
        <CopilotMark />
        <h2 id="copilot-title">Itinerary Co-Pilot</h2>
      </header>

      <div className="copilot-conversation" aria-live="polite" aria-busy={loading}>
        <div className="copilot-welcome">
          <CopilotMark />
          <div>
            <p>Hi! I&apos;m your Itinerary Co-Pilot.</p>
            <strong>What would you like help with next?</strong>
          </div>
        </div>

        {messages.map((message) => (
          <div key={message.id} className={`copilot-message ${message.role}`}>
            <span>{message.role === "user" ? "You" : "Co-Pilot"}</span>
            <p>{message.content}</p>

            {message.role === "assistant"
              && ((message.warnings && message.warnings.length > 0)
                || (message.suggestions && message.suggestions.length > 0)
                || message.next_action) && (
              <div className="copilot-response-details">
                {message.warnings && message.warnings.length > 0 && (
                  <div className="copilot-warnings" aria-label="Co-Pilot warnings">
                    {message.warnings.map((warning, index) => (
                      <p key={index}><span aria-hidden="true">!</span>{warning}</p>
                    ))}
                  </div>
                )}

                {message.suggestions && message.suggestions.length > 0 && (
                  <div className="copilot-suggestions">
                    {message.suggestions.map((suggestion) => (
                      <article key={suggestion.item_id} className="copilot-suggestion-card">
                        <div className="copilot-suggestion-heading">
                          <span>{suggestion.item_type}</span>
                          <strong>${suggestion.price_aud} AUD</strong>
                        </div>
                        <h3>{suggestion.item_name}</h3>
                        <p>{suggestion.city}, {suggestion.country} · {suggestion.category}</p>
                        <p>
                          {suggestion.duration_hours}h · {suggestion.rating.toFixed(1)}★
                          {suggestion.verified ? " · Verified" : ""}
                        </p>
                        {[suggestion.vibe, suggestion.best_season, suggestion.suitable_for].some(Boolean) && (
                          <p>
                            {[suggestion.vibe, suggestion.best_season, suggestion.suitable_for]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        <small>{suggestion.why_recommended}</small>
                        <button
                          type="button"
                          disabled={addedSuggestionIds.includes(suggestion.item_id)}
                          onClick={() => addSuggestion(suggestion)}
                        >
                          {addedSuggestionIds.includes(suggestion.item_id) ? "Added to active day" : `Add to ${dayLabel}`}
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                {message.next_action && (
                  <div className="copilot-next-action"><span>Next action</span><p>{message.next_action.label}</p></div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && <div className="copilot-loading" role="status"><span /><span /><span />Preparing a response…</div>}
        {requestError && <div className="copilot-request-error" role="alert">{requestError}</div>}
      </div>

      <form className="copilot-form" onSubmit={submit}>
        <div className="copilot-prompt-list">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => setInput(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="copilot-composer">
          <textarea
            id="copilot-input"
            aria-label="Your request"
            value={input}
            maxLength={500}
            placeholder="e.g. Find me a cheaper food experience"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={!input.trim() || loading}>Send</button>
        </div>
      </form>
    </section>
  );
}
