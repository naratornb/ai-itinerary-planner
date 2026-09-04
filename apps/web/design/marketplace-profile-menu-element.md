---
version: anydesign-element-1
name: Marketplace profile menu
source: User-provided screenshot
captured_at: 2026-08-20
kind: code
target:
  description: Account avatar trigger and open dropdown in the marketplace header
  region: Full supplied image
colors:
  header: "#D40119"
  surface: "#FFFFFF"
  text-primary: "#212121"
  divider: "#E0E0E0"
typography:
  account-name:
    fontFamily: "Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 500
spacing-used: [8, 12, 16, 24]
rounded-used:
  trigger: 9999px
  menu: 12px
---

# Element — Marketplace profile menu

> Generated with the `anydesign` skill (element mode).
> Kind: code · Date: 2026-08-20

## Source & target

- **Source**: User-provided screenshot.
- **Targeting**: Avatar trigger and its open dropdown — visual targeting ⚠️.
- **Context**: White account control on the existing red marketplace header.

## 1. What this element is

A compact signed-in account trigger that replaces the exposed logout action. The open state presents identity first, then separates navigation from the destructive sign-out action.

## 2. Spec

- Structure: circular avatar trigger, chevron, anchored dropdown, identity header, navigation row, divider, sign-out row.
- Trigger: 40px high white pill with a 28px avatar and 8px internal gap.
- Menu: right-aligned white surface, 280px minimum width, 12px radius, soft raised shadow.
- Identity: avatar, full name, and email; long text truncates.
- States: closed, open, hover, keyboard focus, and signed-out fallback.
- Behavior: Dashboard navigates without ending the session; Sign out ends the Supabase session.

## 3. Reconstruction prompt

Build a React account menu inside the existing red marketplace header. Reuse the current Roboto typography, colors, avatar URL, profile fallback initials, border, radius, and shadow tokens. Show only a compact avatar-and-chevron trigger while closed. In the open menu show the authenticated user's avatar, full name and email, followed by Dashboard and Sign out actions. Preserve keyboard button semantics and close the menu after either action. Do not add points, membership, rewards, or trips because those data and features are not present.

## 5. Consistency notes

Use the same Supabase profile resolution and avatar fallback as the creator dashboard. Keep the destructive action visually separated at the bottom.

## 6. Confidence & open questions

| Aspect | Confidence | Why |
|---|---|---|
| Targeting | ✅ | The requested element is unambiguous. |
| Tokens | ✅ | Existing app tokens are the implementation authority. |
| Menu content | ✅ | User requested parity with the dashboard profile; unsupported reference items are intentionally omitted. |
| Responsive behavior | ⚠️ | The supplied reference shows desktop only. |

Open question: mobile menu behavior can be refined when the creator header receives its responsive pass.
