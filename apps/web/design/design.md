---
version: anydesign-1
name: Influencer Travel Marketplace web experience
source: repository root
captured_at: 2026-08-13
description: |
  An energetic retail-travel workspace that separates brand structure from user action.
  A saturated red header supplies recognition, blue marks interaction, and restrained white
  work surfaces keep itinerary details, pricing, and photography easy to scan.
colors:
  brand: "#D40119"
  action: "#0072EA"
  action-hover: "#005DC7"
  text-primary: "#212121"
  text-secondary: "#616161"
  text-disabled: "#9E9E9E"
  surface: "#FFFFFF"
  surface-subtle: "#F5F5F5"
  border: "#E0E0E0"
  success: "#14804A"
  warning: "#A45B00"
typography:
  display:
    fontFamily: "Roboto, sans-serif"
    fontSize: 44px
    fontWeight: 800
    lineHeight: 1.1
  headline:
    fontFamily: "Roboto, sans-serif"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Roboto, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.43
spacing:
  base: 4px
  scale: [4, 8, 12, 16, 24, 32, 48, 64]
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  pill: 999px
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px 20px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px 20px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0 16px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 16px
  creator-day-strip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 16px
  feasibility-sidebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 16px
---

# Design Analysis — Influencer Travel Marketplace web experience

> Analysis generated with the `anydesign` skill.
> Date: 2026-08-13
> Analysis emphasis: reconstruction and design system

---

## Source

- **Source type**: Local React application and explicit CSS design tokens
- **Path / URL**: repository root
- **Capture method**: Source inspection of component styles, global CSS, and supplied design documentation
- **Detected limitations**: The source is a front-end demo; backend-connected states are outside this reconstruction.

## TL;DR

An energetic, practical travel interface with a dense creator workspace and vivid destination photography. The system uses `{colors.brand}` (#D40119) for structural recognition and `{colors.action}` (#0072EA) exclusively for actions, while neutral surfaces protect readability.

## 1. Visual identity

### 1.1 Surface description

**Personality**: energetic, practical, direct, trustworthy, approachable

**Mood**: Forward-moving and optimistic without luxury styling.

**Detectable stylistic references**: Retail travel merchandising combined with a productivity dashboard.

**Information density**: Balanced on marketplace pages and dense in the editor.

**Implicit positioning**: Travel creators assembling saleable packages for mainstream travellers.

**Confidence**: ✅ high — tokens and component dimensions are explicit in the source.

### 1.2 Brand voice / Atmosphere

The interface assumes planning a trip is emotional and operational at the same time. Photography creates anticipation, while prices, dates, warnings, and itinerary controls remain on clear white surfaces. The visual system therefore spends colour deliberately: red identifies the product environment and blue tells the user where action is possible.

The creator workspace treats complexity as something to organise rather than hide. Dense timelines, quality checks, and pricing panels remain legible through repeated spacing, modest borders, and restrained elevation. Copy should be direct and specific, especially around publishing requirements and costs.

### 1.3 The "ONE brand thing"

- **The thing**: A full-width `{colors.brand}` (#D40119) navigation field paired with white surfaces.
- **Why it carries the brand**: It creates immediate recognition and energetic contrast without colouring every component.
- **How everything else supports it**: Cards, forms, and editor panels stay neutral; actionable emphasis is reserved for `{colors.action}` (#0072EA).
- **Where it appears (and where it deliberately doesn't)**: Global marketplace navigation and high-level brand structure only, never as the default button colour.

*Confidence*: ✅ high

## 2. Design System (tokens)

### 2.1 Colors

| Token | Hex | Role | Where it appears | Confidence |
|---|---|---|---|---|
| `brand` | `#D40119` | Structural identity | Global navigation | ✅ high |
| `action` | `#0072EA` | Primary interaction | CTAs, links, focus | ✅ high |
| `action-hover` | `#005DC7` | Hover/pressed action | Primary button hover | ✅ high |
| `surface` | `#FFFFFF` | Base and elevated surface | Page, card, input | ✅ high |
| `surface-subtle` | `#F5F5F5` | Quiet separation | Secondary regions | ✅ high |
| `text-primary` | `#212121` | Main text | Headings and body | ✅ high |
| `text-secondary` | `#616161` | Supporting text | Metadata and labels | ✅ high |
| `border` | `#E0E0E0` | Component boundary | Cards and fields | ✅ high |
| `success` | `#14804A` | Positive status | Quality checks | ✅ high |
| `warning` | `#A45B00` | Caution status | Feasibility guidance | ✅ high |

### 2.2 Typography

- **Detected family**: Roboto for display and body *(confidence: ✅ high — declared in the root layout and design tokens)*
- **Suggested fallback**: sans-serif

| Token | Size | Weight | Line-height | Use |
|---|---|---|---|---|
| `display` | 44px | 800 | 1.1 | Hero messages |
| `headline` | 32px | 700 | 1.25 | Page and section headings |
| `body` | 16px | 400 | 1.5 | Primary copy |
| `label` | 14px | 500 | 1.43 | Controls and navigation |

**Notable tracking**: Large editor headings use approximately -0.025em.

### 2.3 Spacing

- **Inferred base unit**: 4px
- **Observable multiples**: 4, 8, 12, 16, 24, 32, 48, 64
- **Consistency**: ✅ high — the source documentation declares the same scale.

### 2.4 Radii

- `sm`: 8px for compact controls
- `md`: 12px for buttons, inputs, and cards
- `lg`: 16px for large panels
- `pill`: 999px for chips and circular controls

### 2.5 Elevation system

| Level | Name | Treatment | Use |
|---|---|---|---|
| 0 | Flat | No shadow | Full-width page regions |
| 1 | Boundary | `1px solid #E0E0E0` | Default fields and cards |
| 2 | Card | `0 2px 8px rgba(33,33,33,0.11)` | Cards and hover emphasis |
| 3 | Raised | `0 6px 20px rgba(33,33,33,0.14)` | Menus and overlays |

The system is border-first. Shadows only identify interaction or temporary elevation.

### 2.6 Borders

Default boundaries use `{colors.border}` (#E0E0E0) at 1px. Focus changes the boundary to `{colors.action}` (#0072EA) and adds a translucent 3px halo.

## 3. Components Inventory

### 3.1 Generic components

#### Button Primary
- **Variants**: solid blue
- **Observed size**: minimum 44px height
- **Visible states**: default, hover, focus, disabled
- **Padding**: 12px 20px
- **Radius**: `{rounded.md}` (12px)
- **Confidence**: ✅ high

#### Button Secondary
- **Variants**: white with a quiet border
- **Observed size**: minimum 44px height
- **Visible states**: default, hover, focus
- **Radius**: `{rounded.md}` (12px)
- **Confidence**: ✅ high

#### Input
- **Variants**: text, search, textarea, select
- **Visible states**: empty, filled, focus, disabled
- **Border**: 1px `{colors.border}` (#E0E0E0) with blue focus ring
- **Confidence**: ✅ high

#### Card
- **Variants**: destination, package, editor panel, timeline item
- **Visible states**: default, hover, selected
- **Surface**: `{colors.surface}` (#FFFFFF)
- **Confidence**: ✅ high

### 3.2 Signature components

#### Creator day strip
- **What it is**: Fixed-size day cards and an equal-size add control in a horizontal strip.
- **Why it's signature**: It makes itinerary sequence tangible while preserving dense editing space.
- **Composition**: 210 by 120px cards, 12px gaps, dark selected state, dashed add state.
- **Where it appears**: Package editor only.
- **Confidence**: ✅ high

#### Feasibility sidebar
- **What it is**: A stack of quality, schedule, price, map, and hotel panels alongside the timeline.
- **Why it's signature**: It keeps commercial and practical validation visible during editing.
- **Composition**: 340px desktop column with border-first white panels.
- **Where it appears**: Package editor only.
- **Confidence**: ✅ high

## 4. Layout & Composition

### 4.1 Grid & containers

- Marketing content caps near 1248px with 24px desktop gutters.
- The editor caps at 1440px and uses a flexible main column plus a 340px sidebar.
- Section spacing follows 48–64px intervals.

### 4.2 Composition patterns

- Brand navigation over marketplace content
- Destination photography card grids
- Creator sidebar plus flexible dashboard workspace
- Step-by-step package builder
- Timeline editor plus validation sidebar

### 4.3 Responsive behavior

| Name | Width | Key changes |
|---|---|---|
| Mobile | < 600px | One column, stacked fields, condensed navigation |
| Tablet | 600–959px | Two-column content where space allows |
| Desktop | 960–1279px | Full navigation and multi-column cards |
| Wide | ≥ 1280px | Capped containers and stable editor sidebar |

Interactive controls must remain at least 44 by 44px. Card grids collapse from three columns to two and then one; day cards retain fixed size and scroll horizontally.

### 4.4 Image behavior

- Destination photography uses cover crops and card-matched top radii.
- Hero images use wide natural crops with controlled gradients behind overlaid text.
- Informative images require descriptive alternative text.
- Icons use compact inline SVG with consistent 16–24px sizing.

## 5. Reconstruction Notes

### Suggested stack

Use the target repository's Next.js App Router, React, TypeScript, and Tailwind CSS 4. Preserve client interactivity in focused client components. Load Leaflet only on the client to avoid server-rendering access to browser globals.

### Quick wins

- Reuse the existing explicit token values as CSS custom properties.
- Convert screen-state navigation to `next/link` and `useRouter` paths.
- Keep all demonstration data inside the web app and do not call backend endpoints.

### Tricky parts

- Wizard-to-editor state currently survives because both screens remain mounted; route separation needs a small browser-session store.
- Leaflet and `ResizeObserver` require a client-only boundary.
- The source is one large component; migration should split only by page and shared navigation to avoid speculative abstraction.

### Confidence map

- Tokens and component dimensions: ✅ high
- Desktop page composition: ✅ high
- Mobile behavior: ⚠️ medium, inferred from documented responsive intent
- Backend-connected states: not in scope

## 6. Brand Rules — Do's and Don'ts

### Do

- Use `{colors.brand}` (#D40119) for structural identity and `{colors.action}` (#0072EA) for interaction.
- Keep itinerary facts, pricing, and warnings on solid readable surfaces.
- Preserve the fixed-size day-card rhythm and visible validation sidebar on desktop.
- Use only neutral Marketplace naming and approved public-facing identifiers.

### Don't

- Do not place restricted client, institution, team, email, or placeholder production-domain identifiers in any web file.
- Do not use the brand red as the default CTA colour.
- Do not introduce luxury styling that weakens the practical retail-travel character.
- Do not connect demo controls to the backend as part of this migration.

## 7. Open Questions

No open questions remain because the source contains explicit tokens, desktop component styles, and responsive intent. Exact mobile composition will be validated in-browser during implementation.
