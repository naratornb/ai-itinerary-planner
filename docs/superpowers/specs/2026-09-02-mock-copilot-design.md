# Mock Co-Pilot Interaction Prototype Design

## Goal

Add a clearly labelled frontend-only Co-Pilot prototype to the itinerary editor. It demonstrates typed conversational responses and adding mock activity suggestions without claiming live AI, verified inventory, or server persistence.

## Architecture

- The editor owns a normalized list of itinerary days. Each day owns its timeline items, so switching, counting, adding, deleting, editing, and reordering operate on the active day only.
- A versioned `v1` request/response contract separates the UI from its provider. The prototype uses a deterministic mock client implementing the same interface a future API client can implement.
- A `useCopilot` hook owns in-memory conversation and request state. Presentation components receive data and callbacks; they do not mutate Builder state directly.
- The editor maps an accepted activity suggestion into its existing timeline item shape and appends it to the active day.

## Interaction

1. The user types a natural-language request in the sidebar panel.
2. The panel labels the experience as a mock interaction prototype and submits current active-day context to the mock client.
3. The response renders a conversational message, optional warnings, a next action, and activity suggestion cards.
4. Adding a suggestion appends it to the active day and disables that suggestion's add action for the current conversation.
5. Conversation state lasts only until the editor unmounts or reloads.

## Contract

`CopilotRequestV1` contains `version: "v1"`, the user prompt, conversation messages, and only Builder context that currently exists. `CopilotResponseV1` contains `suggestions`, `next_action`, `warnings`, `copilot_message`, and `error_type`.

Suggestions include stable mock IDs and the fields required for an activity timeline item. No rating, availability, or verification claim is invented.

## States

- Empty: explanation and example prompts
- Loading: input disabled and progress announced
- Success: message, warnings, next action, and suggestions
- `HUMAN_INPUT_ERROR`: request clarification without suggestions
- `DB_GAP_ERROR`: explain the mock catalogue gap without inventing results
- Unexpected failure: retryable generic error

## Boundaries

- No backend or existing AI endpoint calls
- No new dependency
- No durable conversation or itinerary persistence
- Activity suggestions only for the MVP
- Existing design tokens and editor visual language remain authoritative

## Verification

- Unit tests for day-aware state operations, contract/client behavior, and suggestion mapping
- Frontend test suite, typecheck, lint, and production build
- Desktop and mobile editor inspection
