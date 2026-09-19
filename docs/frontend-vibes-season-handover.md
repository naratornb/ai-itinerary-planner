# Frontend handover: package vibes & season

The API (contract v2.4.0, see `apps/api/openapi.yaml` / the deployed Swagger UI
at `GET /docs-ui`) now persists the vibe and season selections as first-class
package fields, separate from free-form `tags`. Backend is done; this doc is
what the web app needs to wire up.

## The fields

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `vibes` | `string[]` | `chill`, `adventure`, `luxury`, `local`, `foodie`, `scenic` | `[]` |
| `season` | `string \| null` | `spring`, `summer`, `autumn`, `winter` | `null` |

Values outside the enums are rejected with a 422. These match the AI wizard's
existing `WizardSelection.vibes` / `.season` ids in `apps/web/lib/ai/itinerary.ts`
exactly — no mapping layer needed.

## Writing

- `POST /packages` — send `vibes` and `season` alongside the existing body.
  - **AI wizard**: `wizardDraftToPackageInput` currently drops both selections;
    map `draft.vibes` → `vibes` and `draft.season` → `season` there.
  - **Manual create form**: add the same two fields to the create payload
    (multi-select for vibes, single optional select for season).
- `PUT /packages/{id}` — same semantics as `tags`: omit the key to leave
  unchanged, `vibes: []` to clear. `vibes: null` is a 422. `season: null`
  clears the season (it's a scalar, like `max_group_size`).

## Reading

Both fields are returned everywhere a package is:

- `GET /packages` (creator dashboard cards)
- `GET /packages/{id}` (editor / own detail)
- `GET /marketplace/packages` and `GET /marketplace/search` (public cards)
- `GET /marketplace/packages/{id}` (public detail)

Packages created before this change return `vibes: []` and `season: null` —
render nothing rather than a placeholder badge.

## Not included (by design)

- No marketplace filtering by vibe/season, and full-text search does not match
  on vibe/season words — the existing `tags` filter is unchanged. Ask for a
  follow-up story if a filter UI is wanted.
- No backfill of existing packages.
