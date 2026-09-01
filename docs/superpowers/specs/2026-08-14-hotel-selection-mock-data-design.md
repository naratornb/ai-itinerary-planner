# Hotel Selection Mock Data Design

## Goal

Replace the editable hotel creation fields with a fixed hotel selection experience. Users choose one mock hotel, review its fixed details and photo, optionally enter notes, then add it to the itinerary.

## Scope

The change is limited to the hotel step in `apps/web/components/itinerary-editor.tsx` and focused tests and assets under `apps/web/`. Activity creation, itinerary editing, backend endpoints, Supabase, and database behavior stay unchanged.

## Interaction

The hotel step displays three selectable cards. Each card includes a local hotel photo, hotel name, area, room type, and total price. Only one card can be selected at a time. The selected card uses the existing action color and a visible selected state.

Selecting a card displays the following fixed details in the existing form layout:

- Hotel name
- Address
- Check-in time
- Check-out time
- Price
- Room type

These values cannot be edited. Notes remain editable. The Add hotel button is disabled until a hotel is selected. When pressed, it adds the selected hotel and the user's notes to the itinerary.

## Mock Hotels

1. Shibuya Excel Hotel Tokyu: Shibuya, Standard room, $720
2. Park Hyatt Tokyo: Shinjuku, Deluxe room, $1,680
3. 9h Capsule Hotel: Shinjuku, Shared room, $270

Each hotel has a fixed address, check-in time, check-out time, price, room type, and local image stored under `apps/web/public/hotels/`.

## Accessibility and Responsive Behavior

Cards use buttons with `aria-pressed` so selection is available to keyboard and assistive technology users. Images have descriptive alternative text. The card grid collapses for narrow viewports without changing the selection behavior.

## Testing

A focused test verifies that all three hotel records expose complete fixed details and local image paths. Existing frontend tests, lint, typecheck, and production build remain green. The test must fail before the hotel catalog is implemented.

## Copy Constraint

User-facing hotel copy and mock data do not use em dashes.
