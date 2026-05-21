# Design: Supabase Auth Prototype Website

## Goals
- Provide a minimal, consistent UI for Supabase Auth flows and role-based user management.
- Support three auth screens (Login, Register, Forgot Password) and one User Management screen.
- Enable admins to edit user fields: email, status, createdAt.
- Keep the design strictly UI-focused; no implementation steps.

## User Roles
- Anonymous: not signed in; can access auth screens only.
- Authenticated user: signed in; can view User Management with limited fields.
- Admin: signed in; can view full User Management fields and edit selected fields.

## User Flows
- Login: enter credentials, submit, land on User Management.
- Register: create account, confirm success, then navigate to Login.
- Forgot Password: request reset, show success state, navigate to Login.
- Session resume: if already authenticated, skip auth screens and go to User Management.
- Admin edit: open user edit UI, update allowed fields, confirm success, see updated row.

## Screen Specs

### 1) Login
- Purpose: authenticate existing users.
- Fields:
  - Email (required, email format).
  - Password (required, minimum 8 chars).
- Actions:
  - Primary: Log in.
  - Secondary: Link to Register.
  - Tertiary: Link to Forgot Password.
- Validation and Errors:
  - Inline field errors for missing/invalid inputs.
  - Submission error banner for invalid credentials or network issues.
- Success:
  - Redirect to User Management.

### 2) Register
- Purpose: create new account.
- Fields:
  - Email (required, email format).
  - Password (required, minimum 8 chars).
  - Confirm Password (required, must match).
- Actions:
  - Primary: Create account.
  - Secondary: Link to Login.
- Validation and Errors:
  - Inline field errors for missing/invalid inputs.
  - Submission error banner for existing email or network issues.
- Success:
  - Show confirmation message (account created or verification email sent).
  - CTA button: Go to Login.

### 3) Forgot Password
- Purpose: request password reset.
- Fields:
  - Email (required, email format).
- Actions:
  - Primary: Send reset link.
  - Secondary: Link to Login.
- Validation and Errors:
  - Inline field error for missing/invalid email.
  - Submission error banner for network issues.
- Success:
  - Show message: reset email sent.
  - CTA button: Back to Login.

### 4) User Management
- Purpose: list users with role-based visibility and admin editing.
- Layout:
  - Header: title, optional search input, and refresh button.
  - Table area: user list with pagination or infinite scroll.
  - Row actions: admin-only edit action.
- Table Columns:
  - Common (all authenticated users): Username, Role.
  - Admin-only: Email, Status, Created At, Actions.
- Row Interaction:
  - Non-admin: read-only rows.
  - Admin: click row or action button to open edit UI.
- Admin Edit UI:
  - Presentation: drawer or modal (single pattern used consistently).
  - Editable fields: Email, Status, Created At.
  - Read-only fields: Username, Role, User ID.
  - Actions: Save, Cancel.
- Feedback/Audit:
  - Save success toast or banner.
  - Save error banner with retry option.
  - Display last updated timestamp in the edit UI.

## Component Inventory
- AuthForm (reusable layout for Login/Register/Forgot Password).
- TextInput (email, password, confirm password).
- PasswordInput with show/hide toggle.
- PrimaryButton, SecondaryButton, LinkButton.
- InlineError, FormErrorBanner, SuccessBanner.
- PageHeader.
- DataTable with column definitions.
- TableEmptyState, TableLoadingState, TableErrorState.
- Pagination or InfiniteScroll control.
- UserEditDrawer or UserEditModal (single choice).
- Toast/Notification system.

## Data Model (UI-Level)
- User:
  - id (string)
  - username (string)
  - role (string)
  - email (string)
  - status (string)
  - createdAt (timestamp)
- Session:
  - userId (string)
  - role (string)

## API Assumptions (Supabase Auth)
- Auth uses Supabase Auth endpoints for sign-in, sign-up, and password reset.
- User profile data is stored in a `profiles` table or view joined with auth users.
- Role is stored in user metadata or a `roles` column in `profiles`.
- User Management screen fetches a list of users from a protected endpoint.
- Admin updates write to user metadata and profile fields.

## Permissions Matrix
- Anonymous:
  - Login: view, submit.
  - Register: view, submit.
  - Forgot Password: view, submit.
  - User Management: no access.
- Authenticated user:
  - User Management: view limited columns (Username, Role).
  - Edit user: no access.
- Admin:
  - User Management: view all columns.
  - Edit user: allowed for Email, Status, Created At.

## States and Edge Cases
- Auth screens:
  - Loading state on submit (button spinner, inputs disabled).
  - Error state with retry.
  - Success state with clear next action.
- User Management:
  - Loading state (table skeleton).
  - Empty state (no users found).
  - Error state (failed fetch).
  - Permission error (non-admin attempts edit shows warning).
  - Stale data warning if update fails due to conflict.

## Acceptance Criteria
- Login, Register, Forgot Password screens are fully specified with fields, validations, and navigation.
- User Management shows role-based columns and admin-only edit actions.
- Admin edit UI supports Email, Status, Created At only.
- Supabase Auth assumptions and data model are clearly stated.
- Document contains no code or implementation steps.
