---
version: anydesign-element-1
name: Season selection card
source: User-provided reference screenshot
captured_at: 2026-09-14
kind: hybrid
target:
  description: "Season cards in the AI package setup flow"
  region: "Four-card season selection grid"
colors:
  surface: "#FFFFFF"
  selected-surface: "#EFF6FF"
  action: "#0072EA"
  text-primary: "#212121"
  text-secondary: "#616161"
  border: "#E0E0E0"
typography:
  card-title:
    fontFamily: "Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 700
spacing-used: [5, 7, 10, 12, 14]
rounded-used: { card: 12px, badge: 5px }
palette:
  - "#FFFFFF"
  - "#EFF6FF"
  - "#0072EA"
  - "#212121"
  - "#616161"
---

# Element — Season selection card

> Generated with the `anydesign` skill (element mode).
> Kind: hybrid · Date: 2026-09-14

## Source & target

- **Source**: User-provided reference screenshot
- **Targeting**: Four season cards — visual reference ⚠️
- **Context**: Two-column grid on the existing subtle setup-page surface. The existing heading, progress, footer, and viewport-fit layout remain unchanged.

## 1. What this element is

An image-led option card that lets a creator choose one of four seasons. Photography carries the seasonal distinction; compact metadata explains the season without claiming destination-specific weather data.

## 2. Spec

- **Structure**: button → left image region with an icon-only selection check + right content region containing the title, description, and three feature tags.
- **Image proportion**: the left image occupies 40% of the 168px-tall card with a 150px minimum width; the existing content fills the remaining width.
- **Content density**: use 20px content padding, a 16px title, 13px description, and 11px tags.
- **Hierarchy**: group the title with the description using a 6px gap, then separate the tags by 14px. Use a 6px gap between tags.
- **Default**: white surface, neutral border, 12px radius.
- **Selected**: blue border, pale-blue content surface, and a circular check icon without a text badge.
- **No preference**: when no card is selected, show a secondary footer action labelled `Build without season`; it starts generation immediately without a seasonal condition. When a season is selected, replace that action with `Clear season`, which only clears the selection and never starts generation.
- **Month range**: intentionally omitted until the backend provides destination-specific `recommended_months` data.
- **Temperature**: intentionally omitted until a destination-aware weather source exists.
- **Responsive behavior**: retain the existing two-column desktop grid and existing mobile reflow.

## 3. Reconstruction prompt

Update only the existing season selection cards. Preserve the surrounding layout and current imagery. Place each image on the left at 40% of the card width and keep the existing title, description, and tags in the right content region. Use the repository's action, surface, text, border, spacing, and radius tokens. Show selection through the blue border, pale-blue surface, and an icon-only circular check. Keep all text in sentence case and omit month and temperature claims until destination-specific backend data exists.

## 4. Generative image prompt

No new imagery is required. Reuse the existing season photography.

## 5. Consistency notes

The selected treatment must match the existing blue action state. Metadata stays secondary to the image and season title. Tags describe broad experience qualities, not factual weather guarantees.

## 6. Confidence & open questions

| Aspect | Confidence | Why |
|---|---|---|
| Targeting | ✅ | The user identified the Season cards directly |
| Tokens | ✅ | Values come from committed design tokens |
| States | ✅ | Default and selected states are visible in the reference |
| Photography | ✅ | Existing assets are retained |

Open question: the backend contract for destination-specific `recommended_months` has not been defined yet.

> **Prompt fidelity note**: no new generated assets are part of this implementation.
