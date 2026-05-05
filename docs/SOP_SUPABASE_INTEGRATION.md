# FEATURE SOP + BUILD HANDOFF DOCUMENT
## Supabase Integration for Lovable Clone — "Connect Supabase" Button

**Repo:** `mar2181/lovable-clone` · **Local:** `C:\Users\mario\Projects\lovable-clone\` · **Dev URL (frontend):** `http://localhost:3015/editor/<projectId>` · **Dev URL (worker):** `http://localhost:8788` · **Estimated build effort:** ~24–32 focused hours across 5 phases

---

## 1. Executive Summary

**What it is:** A first-class "Connect Supabase" button (like Lovable.dev has) that lets the operator hook a generated project up to a real Supabase backend with one click. Once linked, the AI in the chat panel **knows the project has a database**, can read its schema, can propose SQL migrations, and can write app code that uses `@supabase/supabase-js` for auth, queries, storage, and realtime — all of it running live in the Sandpack preview.

**Why we're adding it:** Today every project the AI generates is a static React app — no auth, no database, no persistence. The user's question was *"Lovable lets you click a Supabase button. Why don't we?"* That's exactly the gap. To stop being a "fancy mockup generator" and start being a "real app generator," we need a backend the AI can target. Supabase is the right choice: free tier, Postgres, RLS, auth, storage, realtime, and an official Management API for programmatic access.

**Who uses it:**
- **Mario (operator)** — connecting Supabase to one of the 8 client projects, e.g. a SPI Fun Rentals booking form, an Optimum Clinic appointment widget, a Sugar Shack newsletter signup.
- **Future end-users of generated sites** — they hit a real signup form, real bookings, real data, not a mock.

**Problem it solves:**
1. AI cannot generate stateful features today (no DB to write to).
2. Generated sites can't have signup/login.
3. Generated sites can't store form submissions, leads, bookings, comments.
4. There is no path from "Lovable Clone prototype" to "deployable app with persistence."
5. Mario doesn't want to manually create Supabase tables every time he wants to "fuck around" — but he does want the option of a real backend when a project is worth keeping.

**Business value:** Unlocks an entire tier of generated sites (anything with a form, login, or list of records). Brings Lovable Clone to feature parity with the product it imitates. Multiplies the value of the existing 8 client portfolio (e.g. real lead-capture on every site Mario ships).

**Final result:** Operator clicks **Connect Supabase** in the editor header → OAuth popup → picks an existing Supabase project (or creates a new one) → button turns green showing project name → operator types *"add a sign-up form that saves leads to a `leads` table"* → AI proposes SQL migration → operator reviews and clicks **Run** → AI generates `lib/supabase.ts` + `SignupForm.tsx` using `@supabase/supabase-js` → Sandpack preview renders it → form submission writes a real row to Supabase → operator can verify in Supabase Studio.

**Non-goals for v1:**
- ❌ Multi-tenant Supabase ownership (everything is under one connected Supabase user account; no orgs).
- ❌ Edge Functions deployment (Phase 5 stretch).
- ❌ Supabase Vault / Realtime subscriptions / Branching (Phase 5).
- ❌ Replacing R2 with Supabase Storage for asset uploads (the video SOP already uses R2; keep them separate).
- ❌ Migrations history UI / time-travel rollback (Phase 4 stretch).

---

## 2. Feature Goal

Allow an authenticated Lovable Clone user to **link any project to a Supabase project they own**, and from that point on:
- The AI knows the link exists, knows the schema, and writes code that uses Supabase.
- The user can review and approve SQL migrations the AI proposes.
- The Sandpack preview can talk to Supabase live (anon key + URL injected into generated code).
- Exporting / pushing to GitHub / deploying to Vercel preserves the link via `.env` files.
- Unlinking is a one-click operation that scrubs credentials from the project but never deletes Supabase data.

**Success outcomes:**
- ✓ User clicks **Connect Supabase**, completes OAuth, picks a project — full round-trip ≤30s.
- ✓ Lovable Clone stores the refresh token encrypted-at-rest in KV; project link is per-project (not per-user-globally).
- ✓ AI's system prompt updates the moment the link is made — next chat message produces Supabase-aware code.
- ✓ AI can `SELECT` schema (read) without confirmation; any DDL/DML is **proposed**, never auto-executed.
- ✓ Operator gets a clean SQL diff modal before any migration runs.
- ✓ All generated `<form>` / `<button>` / data-fetching code uses real Supabase calls, not mocks.
- ✓ Exported zip / GitHub repo includes `.env.example` + `lib/supabase.ts` + working `package.json` dep on `@supabase/supabase-js`.
- ✓ Vercel deploy uses the project's anon key + URL via env vars set by our `/api/vercel` route.
- ✓ RLS is **on by default** on every table the AI proposes — no anon-readable tables without an explicit policy.
- ✓ Disconnecting cleanly clears env vars, removes `lib/supabase.ts`, and reverts AI prompt to "no backend" mode.
- ✓ No regressions in chat, projects, versions, export, GitHub, Vercel, or video upload flows.

---

## 3. User Types and Permissions

| User Type | Connect | View link | Run SQL | Disconnect | Notes |
|---|---|---|---|---|---|
| Authenticated owner of project | Yes (their own Supabase OAuth) | Yes (own only) | Yes (with confirm) | Yes | Standard Clerk flow |
| Authenticated non-owner of project | No | No | No | No | Blocked at worker via `projectExists` check (same pattern as video upload SOP §3) |
| MCP service user (`X-API-Key`) | No (humans-only — OAuth doesn't make sense headless) | Yes (read link metadata) | Yes (skips UI confirm; SDK passes `confirm: true` flag) | Yes | Internal automation can run pre-approved SQL |
| Anonymous | No | No | No | No | Blocked at Clerk middleware |

**Supabase-side permissions** (governed by Supabase OAuth scopes):
- `read:organizations`, `read:projects` — required for project picker
- `write:projects` — required to create a new project from inside Lovable Clone
- `sql:read`, `sql:write` — required for schema introspection + migration runs
- `secrets:read`, `secrets:write` — required to read anon key / set env vars
- `functions:write` — Phase 5 only, deferred

Lovable Clone never asks for `service_role` permissions and never stores a service key on the worker. All SQL execution flows through the user's OAuth-scoped token via the Management API.

---

## 4. Full User Workflow

### Workflow A — Connect a Supabase Project (Main Flow)

1. Operator opens `/editor/<projectId>`. Header shows three pill-shaped status buttons today: **Export · GitHub · Vercel**. We add a fourth: **🟣 Connect Supabase**.
2. Click **Connect Supabase** → modal opens (`SupabaseModal`).
3. If no Supabase OAuth is on file: button text says *"Connect Supabase Account"*. Click → opens new tab to `https://api.supabase.com/v1/oauth/authorize?...&state={signedState}`.
4. Operator approves in Supabase. Supabase redirects to `https://<our-domain>/api/supabase/oauth/callback?code=...&state=...`.
5. Worker exchanges `code` for tokens (`access_token` + `refresh_token` + `expires_in`). Refresh token is encrypted with `SUPABASE_TOKEN_ENC_KEY` and stored at KV `user:{userId}:supabase_refresh`. Access token cached at `user:{userId}:supabase_access` with TTL = `expires_in - 60s`.
6. Worker closes the popup with a `postMessage({type:"supabase-connected"})` to the opener tab. Modal updates to step 2: project picker.
7. Project picker calls `GET /api/supabase/projects` → returns `[{ ref, name, region, status, organization_id, organization_name }]`.
8. Operator picks a project (or clicks **+ Create new** which calls `POST /api/supabase/projects` with name auto-derived from the Lovable project's name, region from a dropdown defaulting to `us-east-1`, free-tier).
9. Modal calls `POST /api/supabase/link` with `{ projectId, supabaseRef }`. Worker:
   - Validates ownership of the Lovable project.
   - Calls Supabase Management API `GET /v1/projects/{ref}/api-keys` → fetches anon key.
   - Calls `GET /v1/projects/{ref}` → fetches `restUrl`.
   - Stores: `project:{projectId}:supabase` → `{ ref, name, restUrl, anonKey, organization_id, linkedAt, linkedByUserId }`.
   - Returns `{ ok: true, link: {...} }`.
10. Modal closes. Header pill turns **🟢 Supabase: <project name>** with a chevron for menu (Disconnect, Open in Supabase, View Schema).
11. Worker also writes a virtual `lib/supabase.ts` file into the project's next chat injection context. The file is generated, not stored as a "user file" — it appears in `contextFiles` only when the project is linked, and is stripped from the context the AI can modify (same pattern as `SYSTEM_MANAGED_PATHS` in `worker/src/routes/chat.ts:20-29`).
12. Operator types in chat: *"Build a sign-up form that saves leads to a `leads` table."*
13. `chat.ts` reads the link from KV, fetches the schema (cached 5min at `project:{projectId}:supabase_schema`), and injects a **Supabase Block** into `fullSystemPrompt` (Appendix D). The block tells the AI:
    - Project is linked. Here are the tables and columns.
    - To use Supabase, import `supabase` from `'./lib/supabase'`.
    - For any DDL/DML, return a `migration` object alongside the `files` map (Appendix E).
    - RLS rules required on every new table.
14. AI streams a JSON response containing both `files` and a `migration` field.
15. Frontend receives `done` SSE event — if `migration` is non-empty, **a SQL Diff Modal** opens *before* applying files.
16. Operator reviews the SQL (syntax-highlighted). Two buttons: **Apply Migration** / **Skip**.
17. **Apply Migration** → `POST /api/supabase/sql` with `{ projectId, sql }` → worker calls Management API `POST /v1/projects/{ref}/database/query` → returns `{ ok: true, result: [...] }`. Schema cache invalidated.
18. Files are written to R2 as the new version. Sandpack preview re-renders.
19. Generated `<SignupForm />` calls `supabase.from('leads').insert({...})`. Real row written. Operator can verify in Supabase Studio.

### Workflow B — Create a New Supabase Project from Lovable Clone

Same as Workflow A steps 1–6. At step 7, operator clicks **+ Create new** instead of picking. Modal asks for: name (default = Lovable project name), region (default us-east-1), org (default = first org in list). Submit → worker calls `POST /v1/projects` with `db_pass` auto-generated and stored only for the duration of the request (never persisted). Operator waits ~60s for project to provision (modal shows progress bar polling `GET /v1/projects/{ref}` until `status === "ACTIVE_HEALTHY"`). Then auto-jumps to step 9.

### Workflow C — AI Reads Schema Without User Action

Whenever a chat message is sent and the project is linked, the worker:
1. Checks KV cache `project:{projectId}:supabase_schema` (5min TTL).
2. If miss, calls Management API:
   - `GET /v1/projects/{ref}/database/query` with `?query=...` introspection SQL (Appendix F).
3. Caches `{ tables: [{ name, columns: [...], policies: [...] }] }`.
4. Injects into the **Supabase Block** of `fullSystemPrompt`.

The user never sees this — it's invisible context for the AI.

### Workflow D — Operator Disconnects Supabase

1. Click status pill → menu → **Disconnect**.
2. Confirmation modal: *"Disconnect <project name>? Your Supabase data won't be deleted, but your generated app won't be able to talk to Supabase anymore. The next AI message will rewrite affected files."*
3. Confirm → `DELETE /api/supabase/link` with `{ projectId }` → worker deletes:
   - `project:{projectId}:supabase`
   - `project:{projectId}:supabase_schema`
4. Frontend strips `lib/supabase.ts` from the in-memory project files (next save will persist it).
5. Pill returns to **Connect Supabase**.
6. AI's next response will not include Supabase code.

### Workflow E — Operator Re-Connects After Token Expiry

If the cached access token expires and refresh fails (user revoked Supabase OAuth, or refresh token is older than 6 months), the next API call returns `401 supabase_reauth_required`. Frontend shows a banner: *"Supabase connection needs to be refreshed. [Reconnect]"*. Operator clicks → re-runs OAuth flow steps 3–6. The project link itself is preserved — only the user's auth token is refreshed.

### Workflow F — Operator Exports / Pushes to GitHub / Deploys to Vercel

- **Export (zip):** `worker/src/routes/export.ts` reads `project:{projectId}:supabase` and adds `.env.example` with `VITE_SUPABASE_URL=...` + `VITE_SUPABASE_ANON_KEY=...` filled in. The zip user can deploy anywhere.
- **GitHub push:** same env file is committed. The anon key is **safe** to commit (it's the public key — RLS gates everything). README adds a "Supabase" section noting the project ref and a link to the dashboard.
- **Vercel deploy:** `worker/src/routes/vercel.ts` calls `POST /v1/projects/{vercelProjectId}/env` to set the two env vars before deploy.

### Empty / Loading / Success / Error States

| State | UI |
|---|---|
| Not connected | Header: **Connect Supabase** (purple outline) |
| OAuth in progress | Modal spinner: *"Waiting for Supabase…"* with cancel button |
| Connected, no project picked | Header: **Connect Supabase** (purple solid). Modal step 2 visible |
| Connected, project linked | Header: **🟢 Supabase: <name>** (purple solid + green dot) |
| Schema fetching | Skeleton list in "View Schema" panel |
| Migration proposed | Diff modal with **Apply** / **Skip** |
| Migration running | Apply button shows spinner, disabled |
| Migration succeeded | Toast: *"Migration applied. Schema refreshed."* |
| Migration failed | Modal stays open, error shown above SQL block |
| Token expired | Banner above editor: *"Supabase needs to reconnect"* + button |
| Network error | Toast retry pattern (same as video SOP §12) |

### Mobile

Modal collapses to bottom sheet at <640px. Project picker becomes a stacked card list. SQL diff modal becomes full-screen with a sticky bottom bar holding **Apply/Skip**.

### Exit Mid-Flow

User can close the OAuth popup at any time → modal stays on step 1 with no state lost. User can close the link modal at step 2 → no link is created. User can close the SQL diff modal → migration is **skipped** (files already written, but schema unchanged — AI's next message will reconcile).

---

## 5. Admin Workflow

No separate admin workflow in v1. Token rotation, abuse monitoring, and quota tracking are operator-only (Mario sees them in his Lovable Clone dashboard).

**Phase 4 stretch — `/dashboard/admin/supabase`:**
- List all linked projects across all users (Mario only).
- Show last-used time, anon-key hash, refresh-token age.
- Force-disconnect a project (rare — used if a user's OAuth is compromised).
- View Telegram alerts for failed migrations.

---

## 6. UI/UX Requirements

### Component: Connect Supabase Button (Header)
**Location:** Editor header, right side, between **Vercel** and account avatar.
**Three visual states:**
- Disconnected: outline purple pill, label *"Connect Supabase"*, lucide `Database` icon
- Connecting: same pill with spinner replacing icon
- Connected: solid purple pill, label *"Supabase: <name>"* (truncate at 18ch), green dot prefix, chevron suffix

### Component: SupabaseModal (`components/editor/supabase-modal.tsx` — NEW)
Two-step modal:
- **Step 1 — Auth:** branded card. Heading *"Connect Supabase to <project name>"*. Body explains in 2 sentences what happens. Big purple button *"Sign in with Supabase"* opens OAuth popup.
- **Step 2 — Project picker:** searchable list of projects (org grouped). Each row: project name, region badge, status dot (green/yellow/red), org name. **+ Create new** card at top. Submit = link.

### Component: SupabaseStatusMenu (`components/editor/supabase-status-menu.tsx` — NEW)
Triggered by the connected-state pill. Dropdown with:
- *"View Schema"* — opens `SupabaseSchemaPanel`
- *"Open in Supabase"* — `https://app.supabase.com/project/{ref}` in new tab
- *"View Logs"* — `https://app.supabase.com/project/{ref}/logs/explorer`
- divider
- *"Disconnect"* (red) — opens confirm modal

### Component: SupabaseSchemaPanel (`components/editor/supabase-schema-panel.tsx` — NEW)
Right-side drawer. Lists tables (collapsible). Each table shows columns + RLS policies. *"Refresh"* button re-fetches schema. Read-only — no editing here.

### Component: SqlDiffModal (`components/editor/sql-diff-modal.tsx` — NEW)
Triggered when AI returns a `migration`. Shows:
- AI's natural-language description (from `migration.description`)
- Syntax-highlighted SQL (use `@uiw/react-textarea-code-editor` or simple `<pre>`)
- Risk badges (e.g. red: *"DROP TABLE detected"*, yellow: *"No RLS policy"*, green: *"Safe additive change"*)
- Two buttons: **Apply Migration** (purple) / **Skip**

### Component: SupabaseConnectionBanner (`components/editor/supabase-banner.tsx` — NEW)
Shown above editor when reconnect is needed. Yellow background. Single button **Reconnect**.

### Toasts (sonner — already installed)

| Trigger | Message |
|---|---|
| OAuth complete | *"Supabase connected."* (auto-dismiss 1.5s) |
| Project linked | *"Linked <name> to this project."* |
| Migration applied | *"Migration applied. Schema refreshed."* |
| Migration failed | *"Migration failed. See details in the modal."* |
| Disconnect success | *"Supabase disconnected."* |
| Token expired | *"Supabase connection expired. Reconnect to continue."* |
| Generic error | *"Something went wrong with Supabase. Please try again."* |

### A11y

- All modals have `role="dialog"` + focus trap + Esc-to-close.
- Status pill has `aria-label="Supabase connection status: <state>"`.
- SQL diff modal has `role="alertdialog"` (destructive action confirmation).
- Schema panel headings are `<h3>`/`<h4>` for screen-reader navigation.

### Brand colors

Supabase brand color is `#3ECF8E`. Lovable Clone uses Tailwind `purple-600` for primary. Use Supabase green only for the connection-state dot and **Apply Migration** button. Don't theme the rest of the UI green.

---

## 7. Data Requirements

### KV records (worker, `KV_METADATA`)

#### `user:{userId}:supabase_refresh`
```ts
{
  tokenCipher: string,        // AES-GCM encrypted refresh token, base64
  iv: string,                 // base64 IV
  obtainedAt: string,         // ISO 8601
  scopes: string[],           // ["read:organizations", "write:projects", "sql:write", ...]
  supabaseUserId: string,     // sub claim from Supabase OAuth
  supabaseEmail: string,
}
```
**TTL:** none (refresh tokens last until revoked).

#### `user:{userId}:supabase_access`
```ts
{
  accessToken: string,        // plain text — short lived
  expiresAt: string,          // ISO 8601
  obtainedAt: string,
}
```
**TTL:** Cloudflare KV TTL set to `expires_in - 60s`.

#### `project:{projectId}:supabase`
```ts
{
  ref: string,                // Supabase project ref, e.g. "abcdefghijklmnop"
  name: string,
  region: string,
  organization_id: string,
  organization_name: string,
  restUrl: string,            // "https://abcdefghijklmnop.supabase.co"
  anonKey: string,            // public anon key — safe to expose
  linkedAt: string,
  linkedByUserId: string,
  status: "active" | "paused" | "errored",
}
```

#### `project:{projectId}:supabase_schema`
```ts
{
  fetchedAt: string,
  tables: Array<{
    name: string,
    schema: string,           // usually "public"
    columns: Array<{ name: string, type: string, nullable: boolean, default: string | null }>,
    rlsEnabled: boolean,
    policies: Array<{ name: string, command: string, definition: string, roles: string[] }>,
  }>,
}
```
**TTL:** 300s (5min) cached. Invalidated on migration apply.

#### `project:{projectId}:supabase_migrations`
```ts
{
  history: Array<{
    id: string,               // nanoid(10)
    appliedAt: string,
    description: string,
    sql: string,
    appliedByUserId: string,
    result: "success" | "error",
    errorMessage?: string,
  }>,
}
```
Capped at last 50 entries.

### State (frontend, in-memory React state)

```ts
type SupabaseLink = {
  ref: string,
  name: string,
  restUrl: string,
  anonKey: string,
  organization_name: string,
  status: "active" | "paused" | "errored",
} | null;
```

Lives in editor page state, set after `GET /api/supabase/link?projectId=X` on mount.

### Storage size

- Refresh token: ~1KB
- Per-project link: ~500 bytes
- Schema cache: ~5KB (avg 10 tables × 8 columns × ~50 bytes/column)
- Migration history: capped at 50 × ~2KB = 100KB
- Total per user across 8 projects: ~1MB. Well under KV's 25MB-per-key limit and unlimited-key namespace.

### Why not Drizzle / Prisma / Supabase-js on the worker

The worker only does **Management API** calls (HTTPS REST). No need for an ORM. The generated **client app** uses `@supabase/supabase-js` directly — that's the only place it's installed. Worker stays dependency-light.

### Why not store the anon key in the generated `package.json` directly

Hard-coding the anon key into committed files is fine (RLS protects rows), but it makes the project less portable. Instead we generate `lib/supabase.ts` that reads from `import.meta.env.VITE_SUPABASE_URL` etc., AND we also write a `vite.config.ts` injection for the Sandpack preview that hard-codes the keys at iframe-render time. This way:
- Sandpack works with no env-var setup.
- Exported zip / GitHub / Vercel all use real env vars.
- Same code; the only difference is how it's served.

---

## 8. Functional Requirements

- **FR-001** OAuth start endpoint generates a **signed state token** (HMAC-SHA256 with `OAUTH_STATE_SECRET`) containing `{userId, projectId, nonce, expiresAt}` and embeds it in the authorize URL.
- **FR-002** OAuth callback endpoint verifies the state, exchanges code, encrypts refresh token, stores both tokens, posts message to opener, closes the popup.
- **FR-003** All Management API calls go through a `withSupabaseToken(c, fn)` helper that handles refresh-on-401 transparently.
- **FR-004** `GET /api/supabase/projects` returns the user's projects across all orgs. Result cached 60s in `user:{userId}:supabase_projects_cache`.
- **FR-005** `POST /api/supabase/projects` creates a new project (name, region, org), polls until healthy or 90s timeout, returns final project record.
- **FR-006** `POST /api/supabase/link` writes the per-project KV record + fetches initial schema cache.
- **FR-007** `DELETE /api/supabase/link` removes per-project KV records (does NOT revoke OAuth or delete data on Supabase).
- **FR-008** `GET /api/supabase/schema?projectId=X` returns cached schema; `?refresh=true` bypasses cache.
- **FR-009** `POST /api/supabase/sql` accepts `{projectId, sql}`, validates the user owns the Lovable project + the Supabase ref is linked, runs the SQL via Management API, appends to migration history, invalidates schema cache.
- **FR-010** Worker chat endpoint reads `project:{projectId}:supabase` on every chat request. If linked, fetches schema (cached) and injects the **Supabase Block** (Appendix D) into the system prompt. Auto-injects a virtual `lib/supabase.ts` into `contextFiles` (visible to AI but not editable).
- **FR-011** AI response JSON shape extended (Appendix E) to support `migration` field. Frontend opens diff modal on its presence.
- **FR-012** Disconnect emits a chat-history breadcrumb so future AI requests know the project was previously linked (helps when the user re-connects).
- **FR-013** Export, GitHub push, Vercel deploy each read the per-project link and inject env vars accordingly.
- **FR-014** All errors `console.error` with `userId, projectId, supabaseRef, action, message, stack`.

---

## 9. Non-Functional Requirements

- **Performance:** OAuth full round-trip ≤30s on a normal connection. Schema introspection ≤2s for typical project. Migration apply ≤5s for additive DDL. Cached schema serves in <50ms.
- **Security:** Refresh tokens AES-GCM encrypted at rest. Access tokens never logged. State tokens signed + 5min expiry. CSRF protection via state nonce. Anon key is not a secret but treat URL as identifier-only. RLS on by default. Service-role key never requested or stored.
- **Privacy:** OAuth scopes are minimum required. Token scopes audited per call. Disconnect surfaces a confirm dialog explaining data is preserved on Supabase.
- **Reliability:** Atomic semantics — store link only after schema fetch succeeds. If schema fetch fails, link write fails too. Migration history is append-only.
- **Mobile:** 360px+, full feature parity except the SQL diff modal which becomes full-screen.
- **A11y:** All modals/dialogs WCAG 2.2 AA. Schema panel readable by screen reader.
- **Browser:** Chrome/Edge/Firefox/Safari last 2 versions.
- **Resilience:** Exponential backoff (3 retries, 1s/3s/9s) on Supabase Management API 5xx. Circuit-breaker after 5 consecutive failures, surfaces banner.

---

## 10. Integrations and Dependencies

| Integration | Purpose | Sent | Received | Failure handling |
|---|---|---|---|---|
| **Supabase OAuth (`https://api.supabase.com/v1/oauth/authorize` + `/v1/oauth/token`)** | User authentication + scope grant | `client_id`, `redirect_uri`, `state`, `code_verifier` (PKCE) | `code` → `access_token` + `refresh_token` | 401 → re-prompt; 5xx → 3 retries then banner |
| **Supabase Management API (`https://api.supabase.com/v1/...`)** | Projects, schema, SQL, env vars | `Authorization: Bearer <access>` | JSON | 401 → refresh-token-then-retry; 5xx → backoff; 429 → respect `Retry-After` |
| **Supabase REST (`https://<ref>.supabase.co/rest/v1/...`)** | Runtime calls from generated app | anon key + RLS | JSON | Generated app surfaces errors to user |
| **Clerk (existing)** | Lovable Clone auth | JWT | userId | Existing `authMiddleware` handles |
| **R2 (`R2_PROJECTS`)** | Stores generated `lib/supabase.ts` in version bundles | Binary | OK | Existing path |
| **KV (`KV_METADATA`)** | Token + link + schema cache | JSON | JSON | Existing path |
| **Vercel API (existing `/api/vercel`)** | Set env vars during deploy | `Authorization: Bearer <vercel-pat>` | OK | Existing |
| **GitHub API (existing `/api/github`)** | Commit `.env.example` | `Authorization: Bearer <github-pat>` | OK | Existing |

### New dependencies

- **Worker (`worker/package.json`)**:
  - No new runtime deps. Use `Web Crypto` for AES-GCM (built into workers). Use `crypto.subtle.sign` for HMAC.
  - Optional dev: `@supabase/management-js` (offers typed Management API client). **Decision: do NOT add.** Direct `fetch()` calls keep the bundle small and the code obvious.
- **Frontend (`package.json`)**:
  - No new deps for Lovable Clone itself.
  - Generated apps will declare `@supabase/supabase-js` ^2.x in their own `package.json` — Sandpack auto-installs from CDN.

### New env vars

Set in `worker/wrangler.toml` `[vars]` (non-secret) and `wrangler secret put` (secret):

| Var | Type | Where | Notes |
|---|---|---|---|
| `SUPABASE_OAUTH_CLIENT_ID` | secret | worker | From Supabase partner program |
| `SUPABASE_OAUTH_CLIENT_SECRET` | secret | worker | |
| `SUPABASE_OAUTH_REDIRECT_URI` | var | worker | `https://api.<our-domain>/api/supabase/oauth/callback` |
| `SUPABASE_TOKEN_ENC_KEY` | secret | worker | 32-byte hex; used for AES-GCM encryption of refresh tokens |
| `OAUTH_STATE_SECRET` | secret | worker | 32-byte hex; HMAC for state token |

### Supabase Partner / OAuth App registration

Mario must register Lovable Clone as a Supabase OAuth App at https://supabase.com/dashboard/account/oauth-apps:
- Name: `Lovable Clone`
- Website: `https://<our-domain>`
- Redirect URI: `https://api.<our-domain>/api/supabase/oauth/callback` AND `http://localhost:8788/api/supabase/oauth/callback`
- Logo: TBD
- Scopes needed: `read:organizations`, `write:projects`, `read:projects`, `sql:read`, `sql:write`, `secrets:read`, `secrets:write`

Document the exact signup steps in `docs/supabase-oauth-app-setup.md` during Phase 1.

---

## 11. Automation and Background Jobs

### Cron — Token Refresh Sweep (Phase 3)

- **Trigger:** Cloudflare Cron `15 */6 * * *` (every 6 hours, 15 past the hour)
- **Action:** Walk all `user:*:supabase_refresh` keys. For each, refresh the access token if cached access expires within 30min. Surfaces stale-refresh-token cases (Supabase rotates them on use).
- **Failure:** If 3 consecutive sweeps fail for a user, flag in `user:{userId}:supabase_health` and on next visit show a "Reconnect Supabase" banner.

### Cron — Schema Cache Sweep (Phase 3)

- **Trigger:** `0 5 * * *` (daily 05:00 UTC)
- **Action:** Walk `project:*:supabase_schema`. Delete entries older than 7 days unused (last access tracked).

### Cascade unlink on project delete

`worker/src/routes/projects.ts` `DELETE /:id` (existing, line 128) extended to also delete `project:{id}:supabase`, `project:{id}:supabase_schema`, `project:{id}:supabase_migrations`. Wrap in try/catch — failures don't block project deletion.

### Telegram notification

- Cron failures 3 days running → `notify_mario()` (pattern from `CLAUDE.md`).
- Migration failure rate > 20% over 24h → alert.

---

## 12. Error Handling Plan

| Scenario | User Message | System Response | Log? |
|---|---|---|---|
| OAuth popup closed early | (silent) | Modal stays on step 1 | No |
| OAuth state mismatch | *"Connection failed (security check). Please try again."* | 400 callback | Yes (warn) |
| Code exchange 4xx | *"Supabase rejected the connection. Please retry."* | 502 | Yes |
| Code exchange 5xx | *"Supabase is temporarily unavailable. Please try again."* | 502 | Yes |
| Refresh token expired/revoked | *"Supabase connection expired. Reconnect to continue."* | 401 with code `supabase_reauth_required` | Yes |
| Project picker — no projects | *"You don't have any Supabase projects yet. Create one?"* | 200 empty list | No |
| Project create — 90s timeout | *"Supabase project is taking longer than expected. Check your dashboard."* | 504 | Yes |
| Link write fails | *"Couldn't link the project. Please try again."* | 500 | Yes |
| Schema fetch fails | Quietly fall back to no-schema prompt block; no toast | 200 with empty schema | Yes (warn) |
| SQL exec fails (syntax) | Show error inline in diff modal, keep modal open | 400 with error body | Yes |
| SQL exec fails (permission) | *"This migration needs additional permissions. Reconnect with broader scopes."* | 403 | Yes |
| SQL exec fails (timeout) | *"Migration took too long. It may have partially applied."* | 504 | Critical |
| Disconnect on already-disconnected project | (silent — idempotent) | 200 | No |
| Anon key fetch fails | *"Couldn't fetch project keys. Please retry or reconnect."* | 502 | Yes |
| Vercel env var set fails | Existing `/api/vercel` error handling | (existing) | (existing) |
| Migration on a paused Supabase project | *"This Supabase project is paused. Resume it in Supabase Studio first."* | 409 | No |
| Network drop during OAuth | *"Network error. Please retry."* | n/a | console.warn |
| User pastes a Supabase service-role key by mistake | *"Looks like you pasted a service-role key. Lovable Clone uses OAuth — please reconnect via the button."* | 400 | Yes |
| Generated app SQL injection attempt by AI | Frontend never accepts AI-generated SQL into runtime — only into the diff modal | n/a | n/a |

---

## 13. Notifications and Alerts

- **In-app:** sonner toasts (already wired).
- **Email:** None v1.
- **Telegram (admin, Phase 3):** see §11. Plus: if a single user gets >5 401s in 1h → alert (compromise indicator).

---

## 14. Logging and Audit Trail

Every Supabase mutating action logs:

```
[Supabase] action={action} userId={userId} projectId={projectId} ref={ref} status={ok|fail} durationMs={n} err={msg?}
```

Where `action ∈ {oauth_start, oauth_callback, refresh_token, link, unlink, list_projects, create_project, fetch_schema, run_sql, set_vercel_env}`.

**Phase 3 audit log (KV append):**

`audit:supabase:{actionType}:{ts}:{logId}` →
```ts
{
  id, userId, action, projectId, ref?, sql?, sqlHash?,  // never the full SQL — only hash + first 200 chars
  status, errorMessage?, durationMs, ipHash, ua, createdAt
}
```

SQL is logged by hash + truncated to avoid leaking sensitive DDL into logs (table names with PII, etc.). Cap audit log at 1000 entries per user; rotate to R2 when exceeded.

**Phase 1/2:** `wrangler tail` only. No KV audit log.

---

## 15. Security Requirements

- All Supabase routes behind `authMiddleware` (existing pattern, `worker/src/middleware/auth.ts:39`).
- OAuth state token: HMAC-signed, 5min expiry, single-use (deleted from KV `oauth_state:{nonce}` after consumption).
- PKCE: use `code_verifier` + `code_challenge` (SHA256). Verifier stored in `oauth_state:{nonce}` alongside.
- Refresh token: AES-GCM (12-byte IV, 16-byte tag) encrypted with `SUPABASE_TOKEN_ENC_KEY`. Decrypt only at refresh time.
- Access token: never persisted in plaintext beyond its TTL.
- Token never echoed in any HTTP response body.
- Project ownership re-checked on every operation (matches video SOP §15).
- SQL execution: AI-proposed SQL is **always** routed through the diff modal except when caller is MCP service user with `confirm:true` flag.
- Rate limit: 100 SQL executions / hour / user via KV expiry counter (`ratelimit:sql:{userId}` window 3600s).
- OAuth client secret + token enc key only ever in `wrangler secret`. Never in `wrangler.toml`. Never in repo.
- Redirect URI on Supabase OAuth app must be exact-match registered. Worker validates redirect URI server-side.
- CORS: `/api/supabase/*` allows only the Lovable Clone frontend origin.
- No `eval` of SQL in worker. All SQL passes through to Management API as a string.

**Things that must never happen:**
- Cross-user OAuth token read.
- Cross-user project link read or write.
- Service-role key requested or stored.
- Refresh token logged.
- Anon key logged at info level (only at debug; debug off in prod).
- AI-generated SQL auto-executed without user approval (humans-only path).
- Disconnecting one project deletes another project's data.
- Failed refresh leaving access token cache in inconsistent state.

---

## 16. Build Phases

### Phase 1 — OAuth + Token storage (worker only)

**Scope:**
- `worker/src/routes/supabase.ts` (new file).
- `worker/src/services/supabase.ts` (new — token encryption, refresh, Management API client).
- Mount at `/api/supabase` in `worker/src/index.ts`.
- Endpoints implemented: `GET /api/supabase/oauth/start`, `GET /api/supabase/oauth/callback`, `GET /api/supabase/me` (returns connection status).
- Encryption helpers in `worker/src/services/crypto.ts` (AES-GCM via Web Crypto).
- State token signing + verification helpers in same crypto module.
- `wrangler secret put` for all 5 new secrets.
- Curl-test the full OAuth flow end-to-end with a real Supabase OAuth app.

**Done when:**
- Manually completing OAuth in a browser results in `GET /api/supabase/me` returning `{ connected: true, supabaseEmail: "...", scopes: [...] }`.
- Worker logs show no plaintext refresh token.
- KV inspector confirms only ciphertext for refresh.

### Phase 2 — Project linking + schema introspection

**Scope:**
- `GET /api/supabase/projects`, `POST /api/supabase/projects`, `GET /api/supabase/link`, `POST /api/supabase/link`, `DELETE /api/supabase/link`.
- `GET /api/supabase/schema`.
- `GET /api/supabase/migrations` (history list, read-only).
- Frontend: `SupabaseModal`, `SupabaseStatusMenu`, status pill in editor header, `SupabaseSchemaPanel`.
- Frontend `lib/supabase-client.ts` (calls our worker, NOT the supabase-js package — that's only for generated apps).

**Done when:**
- Operator can complete the full Connect → pick-project → see-pill flow.
- Header pill shows correct state across page reloads.
- Schema panel renders 5+ tables for a real Supabase project.
- Disconnect cleanly clears all UI.

### Phase 3 — AI integration + migration loop

**Scope:**
- `POST /api/supabase/sql`.
- `worker/src/routes/chat.ts` extended to:
  1. Read `project:{projectId}:supabase` on each call.
  2. Inject **Supabase Block** (Appendix D) into `fullSystemPrompt`.
  3. Auto-add `lib/supabase.ts` to `contextFiles` and to `SYSTEM_MANAGED_PATHS` (line 20).
  4. Parse `migration` field out of AI JSON response.
  5. Pass `migration` through to `done` SSE event.
- Frontend `SqlDiffModal` opens on `done` event with non-empty migration.
- AI prompt updates: `worker/src/ai/system-prompt.ts` gains `SUPABASE_USAGE_GUIDE` section (Appendix G), conditionally inserted.
- Generated `lib/supabase.ts` template + `vite.config.ts` injection (Appendix H).

**Done when:**
- Operator types *"add a leads table and signup form"*, AI proposes SQL, operator approves, migration runs, signup form appears in Sandpack and saves real rows.
- AI never references tables that don't exist.
- AI always includes RLS policies in DDL.

### Phase 4 — Reliability, polish, export integration

**Scope:**
- Token refresh sweep cron (§11).
- Schema cache cleanup cron.
- Cascade unlink on project delete.
- `worker/src/routes/export.ts`, `github.ts`, `vercel.ts` updated to inject env vars when Supabase linked.
- Telegram alerts for cron failures + migration error rate.
- Migration history view in `SupabaseStatusMenu`.
- Mobile bottom-sheet variant of modal.
- Connection-expired banner.

**Done when:**
- Daily cron logs are clean.
- Exporting a Supabase-linked project produces a working zip (test by `npm install && npm run dev` outside Lovable Clone).
- Vercel deploy of a linked project hits Supabase live.

### Phase 5 — Stretch (deferred)

- Supabase Storage as an asset upload target (alternative to R2 for client app uploads).
- Supabase Realtime (`supabase.channel(...).on(...)`).
- Supabase Auth UI components auto-generated.
- Edge Functions deploy from inside Lovable Clone.
- Migration history with rollback.
- Multi-tenant Supabase orgs UI.
- Branching (Supabase preview branches → Lovable preview projects).

---

## 17. Developer Task List

### Frontend

- [ ] Create `components/editor/supabase-button.tsx` (header pill, three states)
- [ ] Create `components/editor/supabase-modal.tsx`
- [ ] Create `components/editor/supabase-status-menu.tsx`
- [ ] Create `components/editor/supabase-schema-panel.tsx`
- [ ] Create `components/editor/sql-diff-modal.tsx`
- [ ] Create `components/editor/supabase-banner.tsx`
- [ ] Create `lib/supabase-client.ts` (calls our `/api/supabase/*` worker endpoints)
- [ ] Edit `app/editor/[projectId]/page.tsx` (or wherever the editor lives — find it during Phase 2): mount header pill, fetch link on mount, plumb modals
- [ ] Edit chat panel to surface `migration` from `done` SSE event into `SqlDiffModal`
- [ ] Add lucide imports: `Database`, `CheckCircle`, `AlertCircle`, `RefreshCw`, `ExternalLink`
- [ ] Mobile devtools test (iPhone SE 360px)

### Backend (worker)

- [ ] Create `worker/src/routes/supabase.ts`
- [ ] Create `worker/src/services/supabase.ts` (Management API client, token refresh)
- [ ] Create `worker/src/services/crypto.ts` (AES-GCM helpers, state token sign/verify)
- [ ] Create `worker/src/types/supabase.ts` (TypeScript types matching §7 KV records)
- [ ] Mount router in `worker/src/index.ts`
- [ ] Edit `worker/src/routes/chat.ts`:
  - Lines ~20-29: add `/src/lib/supabase.ts` to `SYSTEM_MANAGED_PATHS`
  - Around line 47-65: load `project:{projectId}:supabase`
  - Around line 99-128: build Supabase Block + inject into `fullSystemPrompt`
  - Around line 195: parse `migration` field from `modifiedFiles` (extend `parseStreamToJSON`)
  - Around line 248: pass `migration` to `done` SSE event
- [ ] Edit `worker/src/ai/system-prompt.ts`: add `SUPABASE_USAGE_GUIDE` constant + helper to compose
- [ ] Edit `worker/src/ai/file-parser.ts`: extend response schema to include optional `migration: { description, sql }`
- [ ] Edit `worker/src/routes/projects.ts`: cascade unlink in DELETE handler (line 128 area)
- [ ] Edit `worker/src/routes/export.ts`: inject `.env.example` when linked
- [ ] Edit `worker/src/routes/github.ts`: same
- [ ] Edit `worker/src/routes/vercel.ts`: set env vars when linked
- [ ] Edit `worker/wrangler.toml`: add cron triggers (Phase 4) + non-secret env vars

### Configuration

- [ ] Register Supabase OAuth App (production redirect URI + localhost dev redirect URI)
- [ ] `wrangler secret put SUPABASE_OAUTH_CLIENT_ID`
- [ ] `wrangler secret put SUPABASE_OAUTH_CLIENT_SECRET`
- [ ] `wrangler secret put SUPABASE_TOKEN_ENC_KEY` (`openssl rand -hex 32`)
- [ ] `wrangler secret put OAUTH_STATE_SECRET` (`openssl rand -hex 32`)
- [ ] Set `SUPABASE_OAUTH_REDIRECT_URI` in `wrangler.toml` `[vars]`

### QA

- [ ] See §19 manual test table

---

## 18. Acceptance Criteria

- [ ] Click **Connect Supabase**, complete OAuth — connection persists across page reload
- [ ] Picker lists all projects across all orgs of the connected Supabase user
- [ ] **+ Create new** provisions a project that becomes `ACTIVE_HEALTHY` within 90s
- [ ] Linking writes `project:{projectId}:supabase` and fetches initial schema
- [ ] Header pill shows green-dot + project name when linked
- [ ] Chat message *"add a `leads` table"* produces a `migration` field
- [ ] SQL diff modal renders the SQL syntax-highlighted
- [ ] **Apply Migration** runs SQL, refreshes schema, schema panel updates
- [ ] AI's next message uses `supabase.from('leads')` correctly
- [ ] Sandpack preview executes the Supabase call and a row appears in Supabase Studio
- [ ] **Disconnect** clears link and reverts AI to no-backend mode
- [ ] Re-connecting after expiry preserves the project link
- [ ] Export zip includes `.env.example` with the linked project's URL + anon key
- [ ] GitHub push commits the same `.env.example`
- [ ] Vercel deploy has both env vars set
- [ ] Cascade-unlink fires when project is deleted
- [ ] Refresh token never appears in plain text in logs, KV inspector, or response bodies
- [ ] Rate limit (100 SQL/hour/user) returns 429 cleanly
- [ ] All errors → clean toasts (no stack traces leaked to UI)
- [ ] 360px mobile works for all flows
- [ ] No regressions in `/api/chat`, `/api/projects`, `/api/export`, `/api/github`, `/api/vercel`, video upload (SOP_VIDEO_UPLOAD)
- [ ] `npm run lint` + `npm run build` (frontend) + worker `wrangler deploy --dry-run` all pass

---

## 19. Testing Plan

### Manual test cases

| # | Test | Steps | Expected |
|---|---|---|---|
| 1 | OAuth happy path | Click Connect → approve in popup | Modal advances to step 2; no errors |
| 2 | OAuth user cancels | Close popup | Modal stays at step 1; no toast |
| 3 | OAuth state tampered | Edit `state` query param mid-flight | Callback returns 400; toast |
| 4 | Project list empty | Connect with a Supabase account that has no projects | Empty-state UI + "Create new" CTA |
| 5 | Create new project | Click + Create new, name `lovable-test`, region us-east-1 | Project provisions; auto-links |
| 6 | Link existing project | Pick from list | Pill turns green; schema fetched |
| 7 | View schema | Click pill → View Schema | Drawer opens with tables |
| 8 | Refresh schema | Click refresh in panel | Network call fires; cache cleared |
| 9 | AI proposes migration | Type *"add a leads table with name, email"* | Diff modal opens with valid SQL + RLS |
| 10 | Apply migration | Click Apply | Toast; schema panel auto-updates |
| 11 | Skip migration | Click Skip | Modal closes; files still applied |
| 12 | RLS enforced | Try to read `leads` without policy → preview shows error | RLS error visible in browser console |
| 13 | AI uses correct schema | Subsequent message: *"add a count of leads to homepage"* | AI references `leads` (not a hallucinated table) |
| 14 | Disconnect | Pill → Disconnect → confirm | Pill back to outline; lib/supabase.ts removed on next save |
| 15 | Reconnect after expiry | Manually clear access token | Banner appears; click Reconnect → flow works |
| 16 | Cascade delete | Delete the Lovable project | KV records gone; OAuth refresh token preserved (still valid for other projects) |
| 17 | Export zip | Export linked project | `.env.example` + `lib/supabase.ts` present |
| 18 | GitHub push | Push linked project | Same in pushed repo |
| 19 | Vercel deploy | Deploy linked project → open URL | Live site talks to Supabase |
| 20 | Mobile (360px) | Open on iPhone SE devtools | Modals usable; SQL diff full-screen |
| 21 | No project ownership | Forge another user's projectId in API | 403 |
| 22 | Service-role key paste | Manually try to PUT a service key | Rejected with friendly message |
| 23 | Rate limit | Run 100 migrations in 1h | 429 on the 101st |
| 24 | Concurrent migration | Open two tabs, apply two migrations simultaneously | Second waits / rejects cleanly (no torn state) |
| 25 | Paused project | Migration on a paused Supabase project | 409 with friendly message |
| 26 | Token rotation | Use Supabase for 7 days | Refresh works silently; no banner |
| 27 | OAuth revoked on Supabase | User revokes app on Supabase dashboard | Next migration call → reauth banner |
| 28 | Video upload still works | Run SOP_VIDEO_UPLOAD test cases | All pass |
| 29 | Existing chat flows | Send chat without Supabase linked | Behavior unchanged |
| 30 | Prompt cache | Same chat message twice | Schema fetched once (cached) |

### Automated tests

- **Vitest unit tests:**
  - `services/crypto.ts`: encrypt/decrypt round-trip; signed-state HMAC verify; tampered state rejected.
  - `services/supabase.ts`: Management API client mock; refresh-on-401; backoff on 5xx.
  - `ai/file-parser.ts`: parses both `files` and `migration` fields; backwards compat with files-only.
- **Worker integration:** `wrangler dev` + curl scripts in `worker/test/supabase.test.ts`.
- **RTL component tests:** `SupabaseModal` step 1→2 transition; `SqlDiffModal` Apply/Skip behavior.
- **Playwright E2E** (Mario already uses Playwright in `tools/execution/` — same harness):
  - Full OAuth round-trip using Supabase test account.
  - Migration apply + visible Sandpack render.
  - Disconnect + reconnect.

### Sandpack preview validation

Sandpack's iframe needs network access to `https://*.supabase.co`. Confirm CSP `connect-src` allows it. If blocked, add `media-src *` is wrong — we need `connect-src https://*.supabase.co https://*.functions.supabase.co`.

---

## 20. Edge Cases

| Edge case | Expected behavior |
|---|---|
| User has 100+ Supabase projects | Picker paginates (50 at a time, search box) |
| Supabase project is paused | Migration → 409, friendly message, link preserved |
| Supabase project is deleted on Supabase | Next migration → 404; auto-unlink with toast *"Supabase project no longer exists. Disconnected."* |
| User's Supabase email doesn't match Clerk email | Allowed — different identities by design |
| Two Lovable projects link the same Supabase project | Allowed — useful pattern; both share the same backend |
| AI proposes a `DROP TABLE` | Diff modal red-flags it with a `[DESTRUCTIVE]` badge but still allows Apply |
| AI proposes SQL that creates a table without RLS | Frontend warns: *"This migration creates a table without RLS. Anonymous users could read all rows."* — soft-block (Apply still possible) |
| AI hallucinates a column that doesn't exist | Sandpack runtime error → user re-prompts, AI sees fresh schema → corrects |
| User runs migration manually in Supabase Studio | Schema cache stale up to 5min; user can click Refresh in schema panel |
| OAuth token refresh succeeds but storage rotated | Worker stores the new refresh token (Supabase rotates on use) |
| Multiple tabs, one disconnects | Other tab's pill is stale until next route call → 404 → auto-flushes |
| `supabase-js` version drift in generated apps | We pin `^2.x` in generated `package.json`; Sandpack uses CDN-resolved latest 2.x |
| Vercel build pulls wrong env var | `vercel/route.ts` always sets both keys with `target: ["production","preview"]` to ensure they're available everywhere |
| AI proposes a `migration` but no `files` | Allowed — pure schema change. Apply still goes through diff modal |
| AI proposes `files` but no `migration` while project is linked | Allowed — most messages don't need DDL |
| User disconnects mid-streaming response | Stream completes; new files written; but next message has no Supabase context |
| Supabase free-tier paused after 7 days inactive | Toast on link load: *"This Supabase project is paused. Resume it before sending chat messages."* |
| `lib/supabase.ts` accidentally edited by AI | Re-injected on next save; AI told it's read-only via system prompt |
| Two concurrent users with the same Lovable account on different machines | KV is single-writer-last-wins; no major issue since both share state |

---

## 21. Documentation for Future Agents

You are now responsible for building this feature. Inspect the existing app structure, routes, components, and patterns before writing code. Do not blindly create duplicate systems.

**First, read top-to-bottom:**

- `worker/src/index.ts` — bindings, mounted routers
- `worker/src/middleware/auth.ts` — DO NOT write new auth, mount this on every route
- `worker/src/routes/projects.ts` — pattern reference for KV writes + ownership checks (and where to add cascade-unlink)
- `worker/src/routes/chat.ts` — heavily edited in Phase 3; read top-to-bottom
- `worker/src/ai/system-prompt.ts` — where Supabase guide injection happens
- `worker/src/ai/file-parser.ts` — extend response schema
- `worker/wrangler.toml` — confirm bindings, add new env vars
- `lib/constants.ts` and `lib/models.ts` — `WORKER_URL`, model list
- `middleware.ts` — public route matcher (none of our new routes are public)
- `docs/SOP_VIDEO_UPLOAD.md` — sister SOP, same template, useful for stylistic consistency

**Then verify:**

- Hit `GET /api/projects` with a real bearer JWT to confirm auth works.
- Make sure you can register a Supabase OAuth App with the localhost redirect URI before any code is written.
- Generate the two secrets (`openssl rand -hex 32`) and `wrangler secret put` them.
- Confirm `https://api.supabase.com/v1/oauth/authorize` opens cleanly with your client_id.
- Read [Supabase Management API reference](https://supabase.com/docs/reference/api/introduction) — full API docs, treat as source of truth over this SOP if anything conflicts.
- Read [@supabase/supabase-js v2 docs](https://supabase.com/docs/reference/javascript) for the runtime SDK that generated apps will use.

**Patterns to follow:**

- Hono router per file, mounted in `worker/src/index.ts`. Apply `authMiddleware` at the top of the router (`supabaseRouter.use("*", authMiddleware)`).
- KV keys structured `<scope>:<id>:<subscope>:<id>` (matches existing convention).
- nanoid 10 for migration ids.
- Errors: `c.json({ error: "...", code: "..." }, status)`. Always include a stable `code` for the frontend to discriminate (`supabase_reauth_required`, `supabase_paused`, `supabase_not_linked`).
- Logging: `[Supabase] ...` prefix, structured fields.
- React: shadcn Dialog/Drawer/Sheet for modals (matches existing UI). framer-motion for the pill state transitions.
- Encryption: Web Crypto only. Do not import `node:crypto` — workers don't have it.

**Do not:**

- Add Drizzle / Prisma / Supabase-management-js / new auth library.
- Store the service-role key. Ever.
- Auto-execute SQL without operator confirmation (humans-only, except the explicit MCP `confirm:true` path).
- Break the existing chat/file-parser format. Always make `migration` optional and absent when not linked.
- Add rows to the existing project KV record. Always use a separate `project:{projectId}:supabase*` key namespace.
- Modify `lib/supabase.ts` from the AI side — it's system-managed (mirror the existing `SYSTEM_MANAGED_PATHS` pattern in `chat.ts:20`).
- Push to GitHub or deploy without explicit Mario approval (per `CLAUDE.md` global push rule).

**Workflow:**

- New branch `feat/supabase-integration`.
- Phase 1 (worker only) → curl-test before writing any frontend.
- Phase 2 → wire UI, validate full link flow with a real Supabase project.
- Phase 3 → AI integration; this is where most surprises live; budget extra time.
- Phase 4 → polish.
- Commit small chunks (one route + tests at a time). Push only when Mario explicitly approves.

Document assumptions in `docs/SOP_SUPABASE_INTEGRATION_NOTES.md` as you go. Document the OAuth app setup steps in `docs/supabase-oauth-app-setup.md` so we can re-onboard on a new domain later.

---

## 22. Open Questions and Assumptions

### Assumptions

- **A1:** Lovable Clone is registered as a Supabase OAuth App with all required scopes. If not, Phase 1 is blocked until Mario does this.
- **A2:** Supabase free tier is sufficient for prototyping. Paid tier upgrades happen on Supabase side, transparent to us.
- **A3:** All 8 client projects can use a single Supabase OAuth account (Mario's). If a client wants their own Supabase, that's a future feature (multi-account support).
- **A4:** Anon key + URL committed to repos is acceptable (industry standard; RLS protects data).
- **A5:** `@supabase/supabase-js` v2.x is stable and Sandpack-compatible. Verified on Lovable.dev's own product. Pin `^2`.
- **A6:** Schema introspection via `information_schema` SQL works for >99% of projects. Edge: custom schemas beyond `public` deferred to Phase 5.
- **A7:** AI can reliably produce valid Postgres SQL with RLS. We add prompt scaffolding (Appendix G) that strongly biases this.
- **A8:** Migration history capped at 50 entries is enough; older entries scrolled out are non-recoverable from Lovable Clone (still in Supabase log).
- **A9:** Token refresh sweep cron at 6h interval is fine. Supabase refresh tokens last 6+ months, so even monthly would work.
- **A10:** Operator OAuth is single-user (Mario). Multi-tenant Supabase OAuth (each Lovable Clone user has their own) is supported by the architecture but won't be exercised until v1.1.

### Questions to confirm before Phase 1

- **Q1:** Does Supabase's OAuth App program currently accept new partners, or do we need to use the user-token API instead (where Mario generates a personal access token and we store it directly)? **Test path:** try registering at https://supabase.com/dashboard/account/oauth-apps; if it's gated, fall back to PAT-only mode in Phase 1 (simpler — skip OAuth, just paste a token). The rest of the architecture stays identical.
- **Q2:** Is Mario OK with the anon key going into the committed `.env.example`? Industry standard says yes (it's public). Confirm.
- **Q3:** Default region: `us-east-1` works for most cases. Confirm or pick something else for Mario's clients (RGV is closer to `us-east-1` than `us-west-1`).
- **Q4:** RLS strictness — should we hard-block migrations that create tables without policies, or soft-warn? Soft-warn is friendlier; hard-block is safer. Recommend soft-warn in v1, revisit if a real leak happens.
- **Q5:** Should the SQL diff modal allow the operator to edit the SQL before running? **Recommendation: yes, in Phase 2** — it's a small UX win and matches Lovable.dev. Add a Monaco-style editor (or simple textarea).
- **Q6:** When the operator switches AI models mid-conversation, should we re-send the schema to the new model or rely on context-window persistence? Always re-send; it's already cached.
- **Q7:** Storage of migration `sql` text — full or hashed? Full for the user's history view; hashed in audit log to avoid leaking sensitive DDL into logs.
- **Q8:** Should Lovable Clone disable the AI's ability to write `DROP DATABASE`-level statements? Yes — block in `services/supabase.ts` before the Management API call. Block `DROP DATABASE`, `ALTER ROLE`, and any non-public schema mutations by default.

### Questions deferred to Phase 5

- Q9: Multi-org UI (when an operator's Supabase user belongs to several orgs).
- Q10: Branching support (Supabase preview branches mapped to Lovable preview projects).
- Q11: Realtime subscriptions UI hints.
- Q12: Edge Functions deploy.
- Q13: Auto-rollback on migration failure (transactional DDL — Postgres supports it, but we'd need to wrap multi-statement migrations).

---

## 23. Final Output Notes

This SOP is the source of truth. If anything in here conflicts with the repo as it exists at build time, **trust the repo and update this SOP**. Build in phases. Don't ship Phase 5 polish in v1 PR. When in doubt, copy `worker/src/routes/projects.ts` for the route shape, `chat.ts` for the SSE pattern, and `auth.ts` for any cryptographic primitive.

No PR until Phase 1+2+3 acceptance criteria pass locally. Verification screenshots, curl outputs, and a `oauth-flow-trace.md` file go in `docs/verification/SOP_SUPABASE_INTEGRATION/`.

Sister SOP at `docs/SOP_VIDEO_UPLOAD.md` — if you're the agent building this, you should also know that one exists; the two features are fully independent but share the *style* of integration (R2-first for assets, Supabase-first for state). Don't merge their data layers — they live in different KV namespaces by design.

---

## Appendix A — File-Level Change Inventory

| File | Action |
|---|---|
| `worker/src/routes/supabase.ts` | **CREATE** |
| `worker/src/services/supabase.ts` | **CREATE** |
| `worker/src/services/crypto.ts` | **CREATE** |
| `worker/src/types/supabase.ts` | **CREATE** |
| `worker/src/index.ts` | EDIT — mount router, add `scheduled` handler (Phase 4) |
| `worker/src/routes/chat.ts` | EDIT — load link, inject Supabase Block, parse `migration`, pass to `done` SSE |
| `worker/src/routes/projects.ts` | EDIT — cascade unlink on delete |
| `worker/src/routes/export.ts` | EDIT — inject `.env.example` when linked |
| `worker/src/routes/github.ts` | EDIT — same |
| `worker/src/routes/vercel.ts` | EDIT — set Vercel env vars when linked |
| `worker/src/ai/system-prompt.ts` | EDIT — add `SUPABASE_USAGE_GUIDE` + composer helper |
| `worker/src/ai/file-parser.ts` | EDIT — extend response schema with optional `migration` |
| `worker/wrangler.toml` | EDIT — add env vars + cron triggers (Phase 4) |
| `components/editor/supabase-button.tsx` | **CREATE** |
| `components/editor/supabase-modal.tsx` | **CREATE** |
| `components/editor/supabase-status-menu.tsx` | **CREATE** |
| `components/editor/supabase-schema-panel.tsx` | **CREATE** |
| `components/editor/sql-diff-modal.tsx` | **CREATE** |
| `components/editor/supabase-banner.tsx` | **CREATE** |
| `lib/supabase-client.ts` | **CREATE** |
| `app/editor/[projectId]/page.tsx` (or wherever) | EDIT — mount header pill + modals |
| `components/editor/chat-panel.tsx` | EDIT — surface `migration` from `done` event |
| `docs/SOP_SUPABASE_INTEGRATION.md` | THIS FILE |
| `docs/SOP_SUPABASE_INTEGRATION_NOTES.md` | CREATE during build |
| `docs/supabase-oauth-app-setup.md` | CREATE during Phase 1 |
| `docs/verification/SOP_SUPABASE_INTEGRATION/` | CREATE during QA |

---

## Appendix B — Worker OAuth + Link Route Skeleton

```ts
// worker/src/routes/supabase.ts
import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import {
  encryptToken, decryptToken,
  signState, verifyState,
  pkceVerifier, pkceChallenge,
} from "../services/crypto";
import {
  exchangeCode, refreshAccessToken,
  managementGet, managementPost, managementDelete,
} from "../services/supabase";

const supabaseRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All routes require auth EXCEPT the OAuth callback (which uses state token instead).
supabaseRouter.use("/oauth/start", authMiddleware);
supabaseRouter.use("/projects", authMiddleware);
supabaseRouter.use("/link", authMiddleware);
supabaseRouter.use("/schema", authMiddleware);
supabaseRouter.use("/sql", authMiddleware);
supabaseRouter.use("/me", authMiddleware);

// ─────────────────────────────────────────────────────────────────────
// OAuth start: build authorize URL with signed state + PKCE
// ─────────────────────────────────────────────────────────────────────
supabaseRouter.get("/oauth/start", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const verifier = pkceVerifier();
  const challenge = await pkceChallenge(verifier);
  const nonce = nanoid(16);
  const state = await signState({ userId, projectId, nonce, expiresAt: Date.now() + 5*60*1000 }, c.env.OAUTH_STATE_SECRET);

  await c.env.KV_METADATA.put(`oauth_state:${nonce}`, JSON.stringify({ verifier, userId, projectId }), { expirationTtl: 300 });

  const url = new URL("https://api.supabase.com/v1/oauth/authorize");
  url.searchParams.set("client_id", c.env.SUPABASE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", c.env.SUPABASE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", [
    "read:organizations","read:projects","write:projects",
    "sql:read","sql:write","secrets:read","secrets:write"
  ].join(" "));

  return c.json({ url: url.toString() });
});

// ─────────────────────────────────────────────────────────────────────
// OAuth callback: exchange code, encrypt + store refresh token, close popup
// ─────────────────────────────────────────────────────────────────────
supabaseRouter.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const stateRaw = c.req.query("state");
  if (!code || !stateRaw) return c.html(closePopupHtml({ ok: false, error: "missing_code_or_state" }));

  const state = await verifyState(stateRaw, c.env.OAUTH_STATE_SECRET);
  if (!state || state.expiresAt < Date.now()) return c.html(closePopupHtml({ ok: false, error: "state_invalid" }));

  const stash = await c.env.KV_METADATA.get(`oauth_state:${state.nonce}`);
  if (!stash) return c.html(closePopupHtml({ ok: false, error: "state_consumed" }));
  const { verifier, userId } = JSON.parse(stash);
  await c.env.KV_METADATA.delete(`oauth_state:${state.nonce}`);

  const tokens = await exchangeCode({
    code, codeVerifier: verifier,
    clientId: c.env.SUPABASE_OAUTH_CLIENT_ID,
    clientSecret: c.env.SUPABASE_OAUTH_CLIENT_SECRET,
    redirectUri: c.env.SUPABASE_OAUTH_REDIRECT_URI,
  });

  const { cipher, iv } = await encryptToken(tokens.refresh_token, c.env.SUPABASE_TOKEN_ENC_KEY);
  await c.env.KV_METADATA.put(`user:${userId}:supabase_refresh`, JSON.stringify({
    tokenCipher: cipher, iv,
    obtainedAt: new Date().toISOString(),
    scopes: tokens.scope.split(" "),
    supabaseUserId: tokens.sub,
    supabaseEmail: tokens.email,
  }));
  await c.env.KV_METADATA.put(`user:${userId}:supabase_access`, JSON.stringify({
    accessToken: tokens.access_token,
    expiresAt: new Date(Date.now() + tokens.expires_in*1000).toISOString(),
    obtainedAt: new Date().toISOString(),
  }), { expirationTtl: tokens.expires_in - 60 });

  return c.html(closePopupHtml({ ok: true }));
});

function closePopupHtml(payload: any): string {
  return `<!doctype html><meta charset="utf-8"><script>
    window.opener && window.opener.postMessage({type:"supabase-oauth", payload:${JSON.stringify(payload)}}, "*");
    window.close();
  </script><body>You can close this window.</body>`;
}

// ─────────────────────────────────────────────────────────────────────
// Connection status
// ─────────────────────────────────────────────────────────────────────
supabaseRouter.get("/me", async (c) => {
  const userId = c.get("userId");
  const refreshStr = await c.env.KV_METADATA.get(`user:${userId}:supabase_refresh`);
  if (!refreshStr) return c.json({ connected: false });
  const r = JSON.parse(refreshStr);
  return c.json({
    connected: true,
    supabaseEmail: r.supabaseEmail,
    supabaseUserId: r.supabaseUserId,
    scopes: r.scopes,
    obtainedAt: r.obtainedAt,
  });
});

// ─────────────────────────────────────────────────────────────────────
// Project list (caches 60s)
// ─────────────────────────────────────────────────────────────────────
supabaseRouter.get("/projects", async (c) => {
  const userId = c.get("userId");
  const cached = await c.env.KV_METADATA.get(`user:${userId}:supabase_projects_cache`);
  if (cached) return c.json(JSON.parse(cached));

  const projects = await managementGet(c, "/v1/projects");
  await c.env.KV_METADATA.put(
    `user:${userId}:supabase_projects_cache`,
    JSON.stringify(projects),
    { expirationTtl: 60 }
  );
  return c.json(projects);
});

// (… create, link, unlink, schema, sql, migrations endpoints follow same pattern …)

export default supabaseRouter;
```

---

## Appendix C — Frontend Client + Modal Skeleton

```ts
// lib/supabase-client.ts (calls our worker, NOT the supabase-js package)
import { WORKER_URL } from "./constants";

export async function startOAuth(token: string, projectId: string): Promise<string> {
  const res = await fetch(`${WORKER_URL}/api/supabase/oauth/start?projectId=${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("oauth_start_failed");
  return (await res.json()).url;
}

export async function listProjects(token: string) {
  const res = await fetch(`${WORKER_URL}/api/supabase/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("supabase_reauth_required");
  return (await res.json());
}

export async function linkProject(token: string, projectId: string, supabaseRef: string) {
  const res = await fetch(`${WORKER_URL}/api/supabase/link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, ref: supabaseRef }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "link_failed");
  return await res.json();
}

export async function runSql(token: string, projectId: string, sql: string) {
  const res = await fetch(`${WORKER_URL}/api/supabase/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sql }),
  });
  return await res.json();
}
```

```tsx
// components/editor/supabase-modal.tsx (essentials)
"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { startOAuth, listProjects, linkProject } from "@/lib/supabase-client";

export function SupabaseModal({ projectId, onLinked }: { projectId: string; onLinked: (link: any) => void }) {
  const { getToken } = useAuth();
  const [step, setStep] = useState<"auth" | "pick">("auth");
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "supabase-oauth" && e.data.payload?.ok) {
        setStep("pick");
        getToken().then(t => listProjects(t!).then(setProjects));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [getToken]);

  async function connect() {
    const t = await getToken();
    const url = await startOAuth(t!, projectId);
    window.open(url, "supabase_oauth", "popup,width=520,height=720");
  }

  async function link(ref: string) {
    const t = await getToken();
    const result = await linkProject(t!, projectId, ref);
    onLinked(result.link);
  }

  return step === "auth"
    ? <div>{/* Big "Sign in with Supabase" button → connect() */}</div>
    : <div>{/* List projects, each row → link(p.ref) */}</div>;
}
```

---

## Appendix D — Supabase Block (injected into AI system prompt)

This block is appended to `fullSystemPrompt` in `worker/src/routes/chat.ts` whenever a project is linked. The schema section is filled from the cached introspection.

```
# SUPABASE BACKEND IS CONNECTED

This project is linked to a real Supabase project. You can use it for auth, database, storage, and realtime.

Project ref: {ref}
REST URL: {restUrl}
Anon key (public, safe to commit): {anonKey}

## Current schema

{tablesAsMarkdown}

## How to use Supabase in generated code

- Import the client: `import { supabase } from './lib/supabase'`
- Do NOT create a new Supabase client anywhere. The shared instance is provided.
- Do NOT modify `/src/lib/supabase.ts` — it is system-managed.
- For any data the user wants to persist, use the schema above. If a needed table doesn't exist, propose a migration (see below).
- For auth, use `supabase.auth.signUp`, `signInWithPassword`, `signInWithOAuth`, `signOut`. Wrap in error handling.
- For storage, use `supabase.storage.from(bucket)`.

## Proposing migrations

If the user's request requires schema changes, return a `migration` object alongside `files` in your JSON response:

```json
{
  "files": { "/src/components/SignupForm.tsx": "..." },
  "migration": {
    "description": "Create leads table with email + name, RLS enabled, anon insert allowed.",
    "sql": "CREATE TABLE leads (...);\nALTER TABLE leads ENABLE ROW LEVEL SECURITY;\nCREATE POLICY \"anon_can_insert\" ON leads FOR INSERT TO anon WITH CHECK (true);"
  },
  "dependencies": {}
}
```

Migration rules:
- ALWAYS enable RLS on new tables.
- ALWAYS include at least one policy. Default to `anon` insert-only for lead-capture, authenticated read/write for app data.
- Prefer additive changes. Avoid `DROP` unless explicitly asked.
- Never reference tables that don't exist in the schema above and weren't created in this migration.
- The user reviews and approves migrations before they run; you don't have to be conservative, just be correct.
```

---

## Appendix E — AI JSON Response Shape (extended)

Existing shape (today):
```json
{
  "files": { "/src/App.tsx": "..." },
  "dependencies": { "lucide-react": "^0.400.0" }
}
```

Extended shape (with Supabase):
```json
{
  "files": { "/src/App.tsx": "...", "/src/components/SignupForm.tsx": "..." },
  "dependencies": { "@supabase/supabase-js": "^2.45.0" },
  "migration": {
    "description": "Create leads table",
    "sql": "CREATE TABLE leads (...);"
  }
}
```

`migration` is optional. When absent, no SQL diff modal opens. `file-parser.ts` must:
- Parse `migration` if present.
- Pass it through unchanged to the `done` SSE event so the frontend can render the diff modal.
- Reject malformed `migration` (must be object with both `description` and `sql` strings) — log and drop silently rather than fail the whole response.

---

## Appendix F — Schema Introspection SQL

```sql
SELECT
  c.table_schema,
  c.table_name,
  json_agg(json_build_object(
    'column_name', c.column_name,
    'data_type', c.data_type,
    'is_nullable', c.is_nullable,
    'column_default', c.column_default
  ) ORDER BY c.ordinal_position) AS columns,
  COALESCE(t.relrowsecurity, false) AS rls_enabled,
  COALESCE(p.policies, '[]'::json) AS policies
FROM information_schema.columns c
LEFT JOIN pg_class t ON t.relname = c.table_name
LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object(
    'name', polname,
    'command', polcmd,
    'definition', pg_get_expr(polqual, polrelid),
    'roles', (SELECT array_agg(rolname) FROM pg_roles WHERE oid = ANY(polroles))
  )) AS policies
  FROM pg_policy WHERE polrelid = t.oid
) p ON true
WHERE c.table_schema = 'public'
GROUP BY c.table_schema, c.table_name, t.relrowsecurity, p.policies
ORDER BY c.table_name;
```

Run via `POST /v1/projects/{ref}/database/query` with body `{ "query": "<above>" }`. Result is the schema cache value at §7 `project:{projectId}:supabase_schema`.

---

## Appendix G — `SUPABASE_USAGE_GUIDE` (added to `system-prompt.ts`)

```ts
export const SUPABASE_USAGE_GUIDE = `
This project has Supabase wired up.

ALWAYS:
- Import the client from './lib/supabase'.
- Use TypeScript and proper error handling on every Supabase call.
- Show a loading state while data is being fetched.
- Show an error state on failures.
- Use Supabase Auth (\`supabase.auth.*\`) — do not roll your own.
- Use RLS on every new table. Default policy: authenticated users can read/write their own rows.

NEVER:
- Modify /src/lib/supabase.ts. It is system-managed.
- Create a second Supabase client.
- Hardcode the anon key or URL — they're provided via the imported client.
- Use service-role keys.
- DROP a table without explicit user request.

When the user asks for any feature that needs persistence, propose a migration. The user must approve before it runs.
`;
```

Compose into `fullSystemPrompt` in `chat.ts:122-128`:
- If linked and SCAFFOLD: insert after `basePrompt`, before `memoryBlock`.
- If linked and ITERATION: insert after `historyBlock`, before `contextBlock`.
- If not linked: do not insert.

---

## Appendix H — Generated `lib/supabase.ts` + Sandpack injection

**File written into project on link, and re-injected on every chat call (system-managed):**

```ts
// /src/lib/supabase.ts
// SYSTEM-MANAGED FILE — DO NOT EDIT.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '__SUPABASE_URL__';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '__SUPABASE_ANON_KEY__';

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
```

**Worker substitutes the literal placeholders before sending the file map:**

```ts
// in chat.ts when assembling contextFiles
const linked = await kv.get(`project:${projectId}:supabase`).then(s => s ? JSON.parse(s) : null);
if (linked) {
  const tpl = readSupabaseLibTemplate(); // hardcoded string above
  const filled = tpl
    .replace("__SUPABASE_URL__", linked.restUrl)
    .replace("__SUPABASE_ANON_KEY__", linked.anonKey);
  contextFiles["/src/lib/supabase.ts"] = filled;
}
```

This ensures the Sandpack preview works with no env-var setup; the exported zip / GitHub still reads from env vars (the `import.meta.env.X ?? "..."` pattern works in both modes).

**`.env.example` for export/GitHub/Vercel:**
```
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## Appendix I — Phase-by-Phase Acceptance Walkthroughs

### After Phase 1
```bash
# Visit http://localhost:3015/editor/<projectId>, click Connect Supabase, finish OAuth
curl -H "Authorization: Bearer $JWT" http://localhost:8788/api/supabase/me
# → { "connected": true, "supabaseEmail": "mario@example.com", "scopes": [...] }
```

### After Phase 2
```bash
curl -H "Authorization: Bearer $JWT" http://localhost:8788/api/supabase/projects
# → [{ref:"abc...", name:"my-proj", ...}, ...]
curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"projectId":"lhbY6xPIo9","ref":"abc..."}' \
  http://localhost:8788/api/supabase/link
# → { ok: true, link: {...} }
curl -H "Authorization: Bearer $JWT" "http://localhost:8788/api/supabase/schema?projectId=lhbY6xPIo9"
# → { tables: [...] }
```

### After Phase 3
- Open project in browser, type *"add a leads table and a signup form"*.
- Diff modal appears with valid SQL.
- Click Apply → migration runs → schema panel auto-updates → form in preview saves real rows.

### After Phase 4
- Export zip → unzip → `npm install && npm run dev` outside Lovable Clone → form works.
- Push to GitHub → Vercel auto-deploys → Vercel-hosted form works.

---

**END OF SOP — hand off to implementing agent.**
