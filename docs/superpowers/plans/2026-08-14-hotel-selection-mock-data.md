# Hotel Selection Mock Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace editable hotel creation fields with three photo cards backed by fixed mock hotel data while keeping Notes editable.

**Architecture:** Store the hotel catalog in a small typed module that can be tested without rendering React. The itinerary editor consumes the catalog, tracks a selected hotel ID and free-form notes, displays read-only details, and inserts the selected record into the timeline.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner through `tsx`, CSS, local JPEG assets.

## Global Constraints

- Hotel name, address, check-in, check-out, price, and room type cannot be edited.
- Notes remain editable.
- Show three selectable hotel cards with local photos.
- Do not use em dashes in user-facing hotel copy or mock data.
- Do not add dependencies.

---

### Task 1: Add the fixed hotel catalog

**Files:**
- Create: `apps/web/components/hotel-catalog.ts`
- Create: `apps/web/components/hotel-catalog.test.ts`
- Create: `apps/web/public/hotels/shibuya-excel.jpg`
- Create: `apps/web/public/hotels/park-hyatt.jpg`
- Create: `apps/web/public/hotels/9h-capsule.jpg`

**Interfaces:**
- Produces: `HotelOption` and `HOTEL_OPTIONS: readonly HotelOption[]`.
- Each option contains `id`, `name`, `area`, `address`, `checkIn`, `checkOut`, `room`, `price`, `image`, and `imageAlt`.

- [ ] **Step 1: Write the failing catalog test**

Assert that `HOTEL_OPTIONS` contains the three approved names, unique IDs, complete fixed details, local `/hotels/` image paths, and no em dash characters.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test components/hotel-catalog.test.ts`

Expected: failure because `hotel-catalog.ts` does not exist.

- [ ] **Step 3: Add the minimal typed catalog and local images**

Create the three records using these fixed commercial details:

```ts
export type HotelOption = {
  id: string;
  name: string;
  area: string;
  address: string;
  checkIn: string;
  checkOut: string;
  room: string;
  price: number;
  image: string;
  imageAlt: string;
};

export const HOTEL_OPTIONS: readonly HotelOption[] = [
  { id: "shibuya-excel", name: "Shibuya Excel Hotel Tokyu", area: "Shibuya", address: "1-12-2 Dogenzaka, Shibuya City, Tokyo", checkIn: "15:00", checkOut: "11:00", room: "Standard room", price: 720, image: "/hotels/shibuya-excel.jpg", imageAlt: "Guest room at Shibuya Excel Hotel Tokyu" },
  { id: "park-hyatt", name: "Park Hyatt Tokyo", area: "Shinjuku", address: "3-7-1-2 Nishi-Shinjuku, Shinjuku City, Tokyo", checkIn: "15:00", checkOut: "12:00", room: "Deluxe room", price: 1680, image: "/hotels/park-hyatt.jpg", imageAlt: "Guest room at Park Hyatt Tokyo" },
  { id: "9h-capsule", name: "9h Capsule Hotel", area: "Shinjuku", address: "1-4-15 Hyakunincho, Shinjuku City, Tokyo", checkIn: "14:00", checkOut: "10:00", room: "Shared room", price: 270, image: "/hotels/9h-capsule.jpg", imageAlt: "Sleeping pods at 9h Capsule Hotel" },
];
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx --test components/hotel-catalog.test.ts`

Expected: all catalog assertions pass.

### Task 2: Replace editable hotel fields with selectable cards

**Files:**
- Modify: `apps/web/components/itinerary-editor.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `HOTEL_OPTIONS` from Task 1.
- Produces: one selected hotel ID, editable notes, read-only detail fields, and a timeline item containing the selected hotel details.

- [ ] **Step 1: Replace hotel draft state**

Use `selectedHotelId: string | null` and `hotelNotes: string`. Derive `selectedHotel` with `HOTEL_OPTIONS.find(...)`.

- [ ] **Step 2: Render accessible photo cards**

Render the three options as buttons in a radiogroup. Use `aria-pressed`, local images and existing design tokens. Show name, area, room, and formatted total price.

- [ ] **Step 3: Render fixed details and editable Notes**

Show the selected record in read-only inputs. Keep only the Notes textarea writable. Disable Add hotel when no option is selected.

- [ ] **Step 4: Store the selected hotel and Notes**

Insert `time`, `title`, `price`, `address`, and `notes` from the selected option. Reset selection and notes after insertion.

- [ ] **Step 5: Add responsive card styles**

Add `.hotel-choice-grid`, `.hotel-choice-card`, selected, image and metadata rules. Collapse the grid to one column in the existing mobile media query.

### Task 3: Verify and publish-ready commit

**Files:**
- Modify: `.github/workflows/ci.yml` only if a new command is required. No change is expected because `npm test` already runs.

- [ ] **Step 1: Run frontend gates**

Run from `apps/web`:

```sh
npm test
npm run lint
npm run typecheck
npm run build -- --webpack
```

- [ ] **Step 2: Run repository safety checks**

Run `git diff --check`, the forbidden-term scan, and verify backend, Supabase, and unrelated docs are unchanged except this approved spec and plan.

- [ ] **Step 3: Commit the implementation**

```sh
git add apps/web/components/hotel-catalog.ts apps/web/components/hotel-catalog.test.ts apps/web/components/itinerary-editor.tsx apps/web/app/globals.css apps/web/public/hotels
git commit -m "feat: add fixed hotel selection"
```

- [ ] **Step 4: Push only after explicit approval**

Do not push the implementation unless the user explicitly approves that specific push.
