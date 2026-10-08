---
status: accepted
---

# Separate package co-pilot conversations from itinerary generation

The package co-pilot uses dedicated endpoints and persistence, keeping existing
full-itinerary generation and legacy suggestions compatible. Each package owns
one conversation using its saved components and recent turns; separate chat
sessions would add lifecycle choices without a current user need. Feedback is
per inventory item and never changes a package, so acceptance cannot be mistaken
for booking or automatic application. An invoker-rights Supabase RPC saves each
turn and its suggestion snapshots atomically under owner RLS.

Use the existing Vercel FastAPI deployment and configured provider. Target a short
request budget with explicit inventory-only fallback rather than introducing a
worker service or waiting through long generation retries. Socket timeouts and
cold starts make this a measured latency target, not a hard SLA. This extends the
FastAPI direction in ADR-0001; it does not implement that older ADR's proposed
LangChain stack or deferred URL version prefix.
