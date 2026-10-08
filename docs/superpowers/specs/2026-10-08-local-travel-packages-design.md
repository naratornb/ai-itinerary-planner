# Local travel packages design

## Goal

Allow a creator to submit a package without flights, receive admin approval, and publish it through the existing workflow. A package with zero flight components is a local travel package.

## Current behavior

`apps/api/app/packages/service.py::submit_package` delegates validation to `public.submit_package_for_review`, introduced in migration 0013. The database function locks the owned row before checking status, price, and component counts. It currently requires a flight, hotel, and activity. The initial investigation reproduced the older Python implementation; execution against current develop must test the database function directly.

Creation already accepts omitted flights or `flights: []`. The database migrations impose no minimum flight count. Approval requires `pending_review`; publication requires `approved`. Creator and public detail already support empty flight arrays.

## Decision

Remove flights from the required submission components. Submission still requires `draft` or `rejected` status, at least one hotel, at least one activity, and `base_price_aud > 0`.

Derive the local classification from zero linked flights. Detail responses represent it as `flights: []`. This definition concerns included transport, not destination country or the traveller's residence. A package with flights retains its existing behavior.

Keep the lifecycle `draft → pending_review → approved → live`. Keep ownership and admin review checks. Update the API contract and bump `info.version` from `2.6.0` to `2.7.0` for the newly allowed submission behavior.

## Scope and alternative

Reuse existing services, response shapes, and test helpers. An append-only migration replaces the submission function, removing only the flight count requirement. Preserve its row lock, ownership check, secure search path, and service-role-only execution. Real PostgreSQL verification also exposed ambiguous array concatenation in the existing hotel/activity/price error paths; use `array_append` so invalid submissions return the documented failures. No dependency, stored package type, new response field, UI change, or listing filter is needed. A stored type would duplicate the flight relationship and require synchronization when components change.

Local packages still require accommodation and an activity. Accommodation-free day trips require a separate product decision.

## Acceptance criteria

- Flightless drafts and rejected packages submit successfully and become `pending_review`.
- Missing hotels or activities, non-positive prices, and invalid statuses still reject submission.
- Admin approval and publication work for a flightless package, setting `published_at`.
- Creator and public detail return `flights: []` for that package.
- Packages containing flights continue to submit successfully.
- HTTP tests mock auth and PostgREST. SQL regression checks run the actual function in disposable local PostgreSQL; verification makes no remote database changes.
