---
version: anydesign-1
name: Influencer Travel Marketplace web experience
source: apps/web and supplied admin approval dashboard wireframe
captured_at: 2026-10-07
description: |
  An energetic travel marketplace and creator workspace built around a strict division of
  colour roles. Saturated red establishes the product environment, blue identifies actions
  and selections, and neutral work surfaces keep complex package-building tasks legible.
colors:
  brand: "#D40119"
  action: "#0072EA"
  action-hover: "#005DC7"
  text-primary: "#212121"
  text-secondary: "#616161"
  text-disabled: "#9E9E9E"
  surface: "#FFFFFF"
  surface-subtle: "#F5F5F5"
  selected-surface: "#EFF6FF"
  border: "#E0E0E0"
  success: "#14804A"
  warning: "#A45B00"
  danger: "#D40119"
  danger-surface: "#FEE2E2"
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
    minHeight: 44px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    minHeight: 44px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    minHeight: 44px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 16px
  creator-revision-feedback:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.text-primary}"
    padding: 16px
  creation-subnav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    minHeight: 64px
  wizard-progress:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-primary}"
    nodeSize: 28px
  season-card:
    backgroundColor: "{colors.surface}"
    selectedBackgroundColor: "{colors.selected-surface}"
    rounded: "{rounded.md}"
    height: 168px
  generation-loader:
    backgroundColor: "{colors.surface-subtle}"
    actionColor: "{colors.action}"
    rounded: "{rounded.md}"
  dashboard-package-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    padding: 22px 28px
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
  copilot-conversation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: 16px
  admin-review-summary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    minHeight: 112px
  admin-review-queue:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    rowMinHeight: 72px
    controlMinHeight: 40px
    controlGap: 12px
    controlRadius: 6px
    mobileBreakpoint: 720px
  admin-review-detail:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    sidebarWidth: 320px
    contentGap: 24px
    mobileBreakpoint: 900px
  hotel-detail-drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    width: 440px
    rounded: "{rounded.lg}"
    padding: 24px
---

# Design Analysis — Influencer Travel Marketplace web experience

> Analysis generated with the `anydesign` skill.
> Date: 2026-09-14
> Analysis emphasis: reconstruction and design system

---

## Source

- **Source type**: Local Next.js application, CSS design tokens, current routed UI, and supplied administrator dashboard wireframe.
- **Path / URL**: `apps/web` plus the conversation reference image.
- **Capture method**: Source inspection of page routes, component states, global CSS, focused desktop previews, and direct visual analysis of the wireframe.
- **Detected limitations**: The administrator reference shows desktop hierarchy only and includes historical filters and metrics unsupported by the current API. Those unsupported controls are intentionally omitted. Mobile rules are derived from the existing responsive system and require implementation QA.

## TL;DR

The experience combines an energetic marketplace with task-focused creator and administrator workspaces. `{colors.brand}` (#D40119) identifies the environment, `{colors.action}` (#0072EA) marks interaction, and border-first white surfaces preserve clarity across the dashboard, guided builders, editor, package detail, and review-queue views.

## 1. Visual identity

### 1.1 Surface description

**Personality**: energetic, practical, direct, trustworthy, approachable

**Mood**: Optimistic during discovery and calm during operational work.

**Detectable stylistic references**: Retail travel merchandising combined with a structured productivity dashboard.

**Information density**: Balanced on marketplace and creation screens; dense in the editor and dashboard table.

**Implicit positioning**: Travel creators turn personal knowledge into reviewable, bookable package drafts for mainstream travellers.

**Confidence**: ✅ high — values and layout rules are taken directly from the current source.

### 1.2 Brand voice / Atmosphere

The interface treats travel planning as both inspiration and production. Photography helps creators recognise the feeling of a destination or season, while explicit steps, prices, statuses, and validation controls turn that feeling into a package that can be reviewed and sold.

Colour carries responsibility rather than decoration. Red says where the user is, blue says what they can do, and neutral surfaces hold the work. The creator flow avoids pretending that generation is instant or final: setup is progressive, AI work receives a visible loading sequence, and publishing is described as submission for review.

### 1.3 The "ONE brand thing"

- **The thing**: A full-width `{colors.brand}` (#D40119) header above restrained white and light-gray work surfaces.
- **Why it carries the brand**: It creates recognition before any content, photography, or copy is read.
- **How everything else supports it**: Controls, cards, and data regions stay neutral; `{colors.action}` (#0072EA) is reserved for interaction.
- **Where it appears**: Global product structure. It does not become the default card fill or primary action colour.

*Confidence*: ✅ high

## 2. Design System (tokens)

### 2.1 Colors

| Token | Hex | Role | Where it appears | Confidence |
|---|---|---|---|---|
| `brand` | `#D40119` | Structural identity | Global header and restrained brand accents | ✅ high |
| `action` | `#0072EA` | Primary interaction | CTAs, links, focus, selected cards | ✅ high |
| `action-hover` | `#005DC7` | Hover and pressed action | Primary button hover | ✅ high |
| `surface` | `#FFFFFF` | Base and elevated surface | Cards, fields, subnav, panels | ✅ high |
| `surface-subtle` | `#F5F5F5` | Quiet separation | Page backgrounds and secondary regions | ✅ high |
| `selected-surface` | `#EFF6FF` | Selected option feedback | Season, style, and duration cards | ✅ high |
| `text-primary` | `#212121` | Main text | Headings, values, controls | ✅ high |
| `text-secondary` | `#616161` | Supporting text | Descriptions, labels, metadata | ✅ high |
| `text-disabled` | `#9E9E9E` | Unavailable state | Disabled actions and pending steps | ✅ high |
| `border` | `#E0E0E0` | Component boundary | Cards, fields, panels, table rows | ✅ high |
| `success` | `#14804A` | Positive status | Approved/live states and completed checks | ✅ high |
| `warning` | `#A45B00` | Caution status | Review and feasibility guidance | ✅ high |

### 2.2 Typography

- **Detected family**: Roboto *(confidence: ✅ high — declared in the root layout and tokens)*
- **Fallback**: `sans-serif`

| Token | Size | Weight | Line-height | Use |
|---|---:|---:|---:|---|
| `display` | 44px | 800 | 1.1 | Large marketplace messages |
| `headline` | 32px | 700 | 1.25 | Page titles and builder entry heading |
| `body` | 16px | 400 | 1.5 | Primary copy |
| `label` | 14px | 500 | 1.43 | Buttons, navigation, table labels |

Creation-step headings commonly use 28px/700 and approximately -0.02em tracking. Season-card titles use 16px/700; their descriptions use 13px and metadata uses 11px.

### 2.3 Spacing

- **Base unit**: `{spacing.base}` (4px)
- **Scale**: 4, 8, 12, 16, 24, 32, 48, and 64px
- **Grouping rule**: Keep title and description close; use a larger break before metadata or the next decision group.
- **Consistency**: ✅ high

### 2.4 Radii

- `{rounded.sm}` (8px): compact controls and footer actions
- `{rounded.md}` (12px): inputs, option cards, and panels
- `{rounded.lg}` (16px): large overlays and major surfaces
- `{rounded.pill}` (999px): statuses, chips, avatars, and circular states

### 2.5 Elevation system

| Level | Name | Treatment | Use |
|---|---|---|---|
| 0 | Flat | No shadow | Page regions and fixed bands |
| 1 | Boundary | `1px solid #E0E0E0` | Default fields, cards, and table structure |
| 2 | Card | `0 1px 3px rgba(33,33,33,0.07)` | Resting cards and controls |
| 3 | Raised | `0 2px 8px rgba(33,33,33,0.09)` | Menus, featured entry card, hover emphasis |
| 4 | Overlay | Stronger shadow with dimmed backdrop | Dialogs and focused overlays |

The system is border-first. Shadows communicate hierarchy or temporary elevation rather than decorating every surface.

#### Decorative depth

The AI entry action uses a contained violet gradient to distinguish generation from standard blue application actions. Destination and season photography supply atmosphere; the broader workspace stays neutral.

### 2.6 Borders

Default boundaries use `{colors.border}` (#E0E0E0) at 1px or 1.5px. Selected cards use a 2px `{colors.action}` (#0072EA) border with a translucent 3px halo. Keyboard focus uses a visible blue halo and must not depend on colour alone.

## 3. Components Inventory

### 3.1 Generic components

#### Button Primary

- Solid `{colors.action}` (#0072EA), white label, minimum 44px height.
- States: default, hover, focus-visible, disabled, loading.
- Used for the single strongest next action in a task region.
- **Confidence**: ✅ high

#### Button Secondary

- White surface, quiet border, primary or secondary text, minimum 44px height.
- Used for back, clear, edit, and alternative actions.
- Consequence-bearing labels must name their result; for example, `Build without season` and `Clear season` are separate actions.
- **Confidence**: ✅ high

#### Input

- Text, search, textarea, and numeric variants.
- Focus uses a blue boundary and translucent halo.
- Search results remain connected to the input through a listbox; typing alone does not count as choosing a destination.
- **Confidence**: ✅ high

#### Hotel Detail Drawer

- Opens from a hotel row without changing the selected stay, so travellers can compare properties without losing booking context.
- Uses a fixed 440px right-side panel on desktop and a full-width sheet on mobile, with a dimmed backdrop and visible `Close` action.
- Displays only catalog-backed facts: hotel name, rating, address, room type, amenities, stay dates, nightly price, and estimated stay total.
- The media region uses a neutral placeholder until a real hotel image source exists. It must not imply photography is available.
- `Select this stay` is the primary action. `View on provider site` remains disabled until that hotel's own provider URL exists.
- **Confidence**: ✅ high — scoped from the approved booking comparison flow and current catalog fields.

#### Card

- Destination, package, setup choice, editor panel, and timeline variants.
- Default cards use white surfaces and borders; selection adds blue border, pale-blue surface, and a check icon.
- **Confidence**: ✅ high

### 3.2 Signature components

#### Creation Subnav

- **What it is**: A 64px sticky white band containing only `Back to dashboard`.
- **Why it is signature**: It keeps package creation anchored without importing unrelated dashboard navigation into the focused flow.
- **Composition**: White surface, bottom border, 1200px capped inner row, 48px minimum link target.
- **Where it appears**: Creation-method choice, AI setup, manual setup, and AI loading.
- **Confidence**: ✅ high

#### Wizard Progress

- **What it is**: A compact horizontal progress row aligned to the same 960px container as the step content.
- **Composition**: Four AI steps — Destination, Travel style, Duration, Season. Manual creation uses Destination, Travel style, and Season because duration is refined in the editor.
- Completed steps show checks and remain clickable; the current step uses a dark numbered node; future steps use outlined nodes.
- Labels collapse below 600px while nodes and connectors remain visible.
- **Confidence**: ✅ high

#### Season Card

- **What it is**: A two-by-two grid of 168px image-led season choices.
- **Composition**: Image occupies 40% on the left; the right side uses 20px padding, a 16px title, 13px description, and three 11px tags.
- Selection uses an icon-only check, blue boundary, and `{colors.selected-surface}` (#EFF6FF) content surface.
- No month ranges or temperatures are displayed because destination-aware data is not available.
- With no selection, the secondary action creates or builds without season. With a selection, it becomes `Clear season`, which clears only and does not start creation.
- **Confidence**: ✅ high

#### Generation Loader

- **What it is**: AI-only progress feedback for Flights, Hotels, Activities, and Finalising.
- **Composition**: Compact cards with state-specific icons, rotating status copy, a determinate-looking percentage capped below completion, and an accessible progress bar.
- Manual creation never shows this state.
- **Confidence**: ✅ high

#### Dashboard Package Row

- **What it is**: A creator package summary row with aligned destination, duration, formatted AUD price, status, and centred actions.
- The dashboard toolbar filters the loaded package list through `All`, `Approved`, `Under review`, `Rejected`, and `Drafts` tabs.
- **Routing rule**: Draft and rejected packages open the editor; approved packages open creator preview; live packages open the marketplace detail page.
- Rejected packages use `{colors.danger}` text on `{colors.danger-surface}` so a required revision is distinct from a neutral draft.
- Approved rows pair Preview with a labelled `Publish` action. Publishing requires confirmation before the package becomes publicly visible.
- Live rows place a share action beside the view action. It shares the public marketplace detail URL and falls back to copying the link when native sharing is unavailable.
- Approved rows do not expose a share action; after publishing, the row changes to Live and replaces Publish with Share.
- Delete is available only for drafts and requires confirmation.
- **Confidence**: ✅ high

#### Creator Day Strip

- **What it is**: Fixed-size day cards and an equal-size add control in a horizontal strip.
- **Composition**: 210 by 120px cards, 12px gaps, dark selected state, dashed add state.
- **Where it appears**: Package editor.
- **Confidence**: ✅ high

#### Creator Revision Feedback

- **What it is**: A persistent notice above the editable itinerary when an administrator returns a package for changes.
- **Composition**: Warning-tinted full-width band with an alert icon, `Changes requested` heading, the administrator's exact creator-facing reason, and the review date when supplied by the API.
- **Visibility rule**: Render whenever the package status is `rejected`. Show the exact creator-facing reason when available; if the API returns no latest approval data, state that no reviewer feedback was provided instead of hiding the notice or displaying a raw `null`. Never substitute internal notes or invent feedback.
- **Confidence**: ✅ high

#### Feasibility Sidebar

- **What it is**: Quality, schedule, price, map, and hotel panels alongside the editor timeline.
- **Submission rule**: The primary action says `Submit for review`; submission does not imply immediate publication.
- **Composition**: 340px desktop column with border-first white panels.
- **Confidence**: ✅ high

#### Copilot Conversation

- **What it is**: A task-focused assistant surface with a compact identity header, request shortcuts, conversation, and persistent composer.
- **Composition**: 340px desktop sidebar that becomes a full-viewport mobile sheet below 700px.
- **Confidence**: ✅ high

#### Admin Review Summary

- **What it is**: Two quiet operational summaries for the real pending-review total and the age of the oldest submission.
- **Composition**: Border-first `{colors.surface}` (#FFFFFF) cards with `{rounded.md}` (12px) corners, a 112px minimum height, a compact label, and a prominent value.
- **Usage rule**: These cards summarize current queue pressure; they do not introduce approved-today, rejected, or other historical metrics unavailable from the existing contract.
- **Confidence**: ✅ high

#### Admin Review Queue

- **What it is**: A text-first pending-package queue with API-supported sort, row count, refresh, pagination, and one `Review` action per package.
- **Composition**: Desktop rows use a 72px minimum height on a neutral white surface with restrained separators. Toolbar controls reuse the creator dashboard's compact 40px height, 14px type, 6px radius, and 12px spacing; refresh stays a square icon action. Below 720px, each row becomes a bordered card while sort, row count, and refresh remain on one compact toolbar row.
- **Interaction rule**: `{colors.action}` (#0072EA) is reserved for links, focus, and controls. Approve and reject actions remain on the separate review page. Search and additional filters stay absent until the API can apply them across the full queue.
- **Confidence**: ✅ high

#### Admin Review Detail

- **What it is**: A focused administrator workspace for reading one submitted package and recording a decision with the existing approval endpoints.
- **Composition**: A flexible content column and sticky 320px decision column separated by a 24px gap. The main column pairs real cover media or an explicit empty state with package facts, then a horizontally selectable day itinerary. The decision column contains the API-provided price breakdown and two clearly separated outcomes.
- **Interaction rule**: Approval and change requests require confirmation. Creator-facing rejection feedback must contain at least 10 characters; internal notes remain separate and optional. Missing media, descriptions, or pricing are labelled as unavailable rather than generated.
- **Responsive rule**: Below 900px the decision column follows the itinerary in document order; below 720px the cover, facts, itinerary rows, and modal actions stack without losing information.
- **Confidence**: ✅ high

## 4. Layout & Composition

### 4.1 Grid & containers

- Marketplace content caps near 1248px with 24px desktop gutters.
- Dashboard content caps at 1200px.
- Creation-method content caps at 800px.
- AI and manual step content uses `width: min(calc(100% - 64px), 960px)` and stays centred.
- Package detail caps at 1120px; the editor caps at 1440px with a flexible main column and 340px sidebar.

### 4.2 Composition patterns

- Brand header over a focused white creation subnav
- Compact horizontal progress over a single task surface
- Image-led choice grids for destination mood and season
- Persistent bottom action row within desktop setup views
- Dashboard summary cards above a package table
- Administrator queue summaries above a text-first pending-review table
- Administrator package review with a readable itinerary and sticky decision column
- Timeline editor beside continuous validation and pricing context

Desktop setup pages are designed to complete within one viewport where practical. The content area, not an internal modal, owns each step.

### 4.3 Responsive behavior

#### Breakpoints

| Name | Width | Key changes |
|---|---|---|
| Mobile | < 600px | Progress copy hides; nodes remain; fields and cards stack |
| Tablet | 600–800px | Creation viewport becomes page-scrolling; the administrator queue switches from table to labelled cards below 720px |
| Desktop | 801–1279px | 960px guided-flow container and multi-column option grids |
| Wide | ≥ 1280px | Containers remain capped and centred |

#### Touch targets

Primary and secondary actions use at least 44px height. Creation navigation uses a 48px minimum target. Small visual badges are not interactive.

#### Collapsing strategy

- Progress retains order but removes text below 600px.
- Desktop overflow locking is removed below 800px so the document scrolls naturally.
- Editor sidebars collapse below 1100px and become a single column below 700px.
- Creation footer actions may wrap on narrow screens.
- The administrator queue hides its desktop table below 720px and presents the same information as stacked cards without horizontal page scrolling.
- The administrator review decision column moves below the package content below 900px; package facts and timeline rows stack below 720px.
- Hotel details use a 440px right-side drawer on desktop and a full-width, vertically scrolling sheet below 640px.

### 4.4 Image behavior

- Destination and travel-style photography uses cover crops with card-matched radii.
- Season photography occupies the full left 40% of each card and may zoom subtly on hover.
- Package cover imagery uses wide cover crops and a maximum displayed height.
- Inline SVG icons use 16–24px sizing and mostly stroked geometry; selection checks use high-contrast filled circles.
- Informative images require descriptive alternative text; decorative imagery should use empty alternative text.
- Hotel details use a clearly labelled neutral placeholder when no property image exists; never substitute unrelated stock photography.

## 5. Reconstruction Notes

### Suggested stack

Use the repository's Next.js App Router, React, TypeScript, CSS custom properties, and focused global component classes. Keep Supabase access and API calls behind the existing client helpers; do not introduce a second design framework for isolated screens.

### Quick wins

- Reuse existing semantic colour, spacing, and radius values rather than adding screen-specific shades.
- Reuse `CreatorCreationSubnav`, `PackageWizardProgress`, and the shared destination catalog across creation modes.
- Keep price display locale-aware with thousands separators.
- Preserve status-to-route mapping in one route helper instead of duplicating it in dashboard rows.

### Tricky bits

- A typed search string is not a valid destination until the user selects a catalog result.
- AI loading must reflect real completion while still providing paced visual progress during long requests.
- Season is currently a single optional generation hint, not persistent package metadata. Do not imply destination-specific months or temperatures.
- Approved is a creator-preview state; live is the public marketplace state.
- Reference flights are creator suggestions, not guaranteed purchaser inventory. Traveller-facing copy must preserve that distinction.

### Implicit states to preserve

- Loading, empty, error, disabled, selected, hover, and focus-visible states
- Session-expired redirects and retry actions
- Submission in progress and locked non-draft packages
- No-season creation and clear-season behavior
- Administrator queue loading skeletons, all-caught-up empty state, access-required state, retry state, and late-response protection
- Administrator review-detail loading, missing-package, access-required, already-reviewed, submission-error, and success states

### Confidence map

| Layer | Confidence | Why |
|---|---|---|
| Identity | ✅ high | Repeated across marketplace and creator surfaces |
| Colors | ✅ high | Extracted from source constants and CSS variables |
| Typography | ✅ high | Declared in source and tokens |
| Spacing | ✅ high | Repeated 4px-based values in current CSS |
| Components | ✅ high | Current implementations and tests are present |
| Desktop layout | ✅ high | Source dimensions and focused previews agree |
| Mobile layout | ⚠️ medium | CSS rules exist, but visual coverage is less complete |
| Destination-specific seasonal facts | ❓ low | No backend source exists |

## 6. Do's and Don'ts

### Do

- Reserve `{colors.brand}` (#D40119) for structural identity and `{colors.action}` (#0072EA) for interaction.
- Keep the package creation subnav limited to `Back to dashboard` so setup remains focused.
- Align progress, headings, cards, and footer actions to the same 960px creation container.
- Use a blue boundary, pale-blue surface, and check icon together for selected option cards.
- Keep title and description grouped, then separate tags or metadata with a larger vertical gap.
- Use explicit workflow language: `Submit for review`, `Approved`, creator preview, and `Live` must remain distinct.
- Keep alternative creation actions consequence-specific, such as `Build without season` and `Clear season`.
- Keep administrator queue surfaces neutral and text-first; reserve `{colors.action}` (#0072EA) for review links, sorting, refresh, pagination, and visible focus.
- Preserve desktop/mobile information parity when the administrator table becomes cards below 720px.
- Keep administrator decisions beside the submitted evidence on wide screens and directly after it on smaller screens.
- Keep hotel comparison in booking context: opening details must not select a hotel, while `Select this stay` must update the choice and close the drawer.
- Show `View on provider site` only as an enabled link when the selected property has its own verified provider URL.

### Don't

- Do not use `{colors.brand}` (#D40119) as the default primary button colour.
- Do not add unrelated dashboard tabs to package creation screens.
- Do not use free-text destination entry where the catalog picker is required for safety filtering.
- Do not display hard-coded month ranges, temperatures, or destination claims without a destination-aware source.
- Do not show `Build without season` when a season is selected; use `Clear season` to prevent accidental omission.
- Do not describe reference flights as booked, guaranteed, or purchaser-specific inventory.
- Do not treat approval as publication or route an approved package directly to the public marketplace detail page.
- Do not add approved-today, rejected, historical, or reviewer-performance metrics without an API source.
- Do not place approve or reject controls in the administrator queue; open the dedicated review route instead.
- Do not invent hotel photos, reviews, policies, or provider destinations when catalog data is absent.

## 7. Open Questions

- Should recommended season become persistent package metadata? If so, define an API field before enabling multiple seasons or destination-specific month ranges.
- Mobile creation layouts need a dedicated visual QA pass at common phone widths and 200% zoom.
- Booking, earnings, and analytics navigation remains outside the focused creation-flow design until those destinations are implemented.
- Should a future contract expose automated feasibility findings, show their source and rule identifiers rather than deriving a score in the browser.
- Hotel provider URLs are not present in the current catalog schema; the provider action remains disabled until that contract exists.

## 8. Companion files

- [x] `design-tokens.json` — canonical W3C DTCG token data, extended only with administrator component dimensions.
- [ ] `design-a11y.md` — not regenerated in this documentation-only update.
- [ ] Multi-viewport screenshots — desktop creation screens have been previewed; tablet and mobile captures remain open.

---

*This document is the current design-system reference for extending the web experience. Feature-specific element notes in this directory refine, but do not override, these global rules.*
