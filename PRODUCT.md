# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Travel creators build and submit itinerary packages. Administrators review submitted packages, and travellers browse packages that have been made public.

## Product Purpose

The Influencer Travel Marketplace turns creator travel knowledge into structured, reviewable itinerary packages. Success means creators can move from an idea to a clear submission, administrators can process review work without losing queue context, and travellers only see packages intended for public discovery.

## Operating Context

Creators work through guided setup, editing, preview, submission, and publication states. Administrators need a focused queue that shows real pending work, makes the oldest submission visible, and opens a separate package review surface. Public browsing and booking-oriented views remain distinct from creator and administrator workspaces.

## Capabilities and Constraints

- The web app uses Next.js, TypeScript, Supabase authentication, and the existing FastAPI contract.
- Administrator queue membership and totals come from the existing approvals endpoint; no historical or demo metrics may be invented.
- Creator labels may be enriched from existing user data only after administrator access is confirmed, and enrichment failure must not hide pending work.
- Approval decisions belong on a dedicated review page, not on the dashboard queue.
- The current task is frontend-only and must not change backend, database, or authorization contracts.

## Brand Commitments

The product uses the existing marketplace identity and design tokens. Structural red identifies the product environment, action blue identifies interaction, and neutral work surfaces keep operational tasks legible.

## Evidence on Hand

- Existing routed web application and committed design documentation under `apps/web/design/`.
- Existing approval and user API contracts.
- A supplied administrator dashboard wireframe used for information hierarchy, not as a visual palette.
- No approved source exists for historical approval metrics, reviewer analytics, or fabricated creator details.

## Product Principles

- Show real workflow state rather than simulated completeness.
- Keep creator, administrator, and traveller contexts unmistakably separate.
- Preserve access and error outcomes as intentional product states.
- Keep queue actions focused on opening a review; reserve decisions for the review surface.
- Reuse established contracts and visual language before adding new concepts.
