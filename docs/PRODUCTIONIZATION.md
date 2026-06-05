# Productionization Checklist — HS Solutions App & Web Builder

Production-readiness status for the builder backend (Cloudflare Worker in
`worker/`) and the surrounding tooling. Grounded in the live code, primarily
`worker/src/middleware/auth.ts`, `worker/wrangler.toml`, and the route files
under `worker/src/routes/`.

---

## DONE — shipped and verified in the codebase

- **Clone-and-swap "re-target" engine** (`worker/src/routes/retarget.ts`,
  mounted at `/api/retarget` in `worker/src/index.ts`):
  - `POST /api/retarget/:id` — manual identity swap (`target`, `createCopy`
    [default true → master stays pristine], `newProjectName`,
    `extraReplacements`).
  - `POST /api/retarget/:id/from-url` — scrape a target firm's website →
    LLM-extract its identity → swap. Supports `dryRun: true` (returns
    `{ extracted, missing, sourceMeta }` without writing) and the same
    `createCopy`/`newProjectName` options.
  - Persists append-only: a new project on `createCopy`, otherwise a new R2
    version in place (the standard `{id}/v{n}.json` + `latest_version` model).
- **Deploy-identity persistence (idempotent re-deploys):**
  - GitHub: KV `project:{id}:github_repo` pins the backing repo so a rename
    never spawns a duplicate (`worker/src/routes/github.ts`).
  - Vercel: KV `project:{id}:vercel_project_id` pins the Vercel project name so
    re-deploys promote the same production alias instead of orphaning it
    (`worker/src/routes/vercel.ts`).
- **Vercel framework auto-detection** (Vite vs CRA) with missing-file scaffolding
  and build-poll-until-READY, including build-error extraction
  (`worker/src/routes/vercel.ts`).
- **GitHub import** as a new editable project, with file/size caps
  (200 files / 256 KB per file / 6 MB total text; images inlined as data URIs
  within their own 3 MB budget) — `POST /api/github/import`.
- **Supabase linking** — injects `REACT_APP_*` + `VITE_*` env at deploy and
  `.env.example` at push when a project is linked (`project:{id}:supabase`).
- **Image picker** in the editor (`components/editor/supabase-image-picker.tsx`,
  used by `inspector-panel.tsx`).
- **Stable worker URL deployed to Cloudflare** —
  `https://lovable-clone-backend.hssolutions2181.workers.dev`
  (`lovable-clone-backend`, see `wrangler.toml`); frontend points at it via
  `NEXT_PUBLIC_WORKER_URL`, stable across deploys.
- **Append-only version storage + daily GC cron** (`crons = ["0 3 * * *"]` in
  `wrangler.toml`) for orphaned attachment R2 objects.
- **`@hs/builder-sdk` package scaffolded** at `sdk/` (package + tsconfig).

> Items the broader program counts as "done" but that are landing as **separate
> deliverables in this same multi-agent release** — verify they are mounted in
> `worker/src/index.ts` before treating them as shipped: the **worker tab** UI,
> **MCP retarget tools**, the **OpenAPI `/api/spec.json`** route, and the
> **lovable-pp-cli**. They were NOT present in `worker/src/routes/` at the time
> this checklist was written; the leader integrates the mounts centrally.

---

## REMAINING / RECOMMENDED — before broad production use

### 1. Auth hardening (HIGHEST PRIORITY)

The dev-auth bypass in `worker/src/middleware/auth.ts` accepts the literal token
`Bearer dev-local-user` (and registers it as the owner with unlimited credits)
whenever **either** condition is true:

```
ENVIRONMENT === "development"   OR   DEV_BYPASS_AUTH === "1"
```

**Production `wrangler.toml` currently sets BOTH:**

```toml
[vars]
ENVIRONMENT = "development"
DEV_BYPASS_AUTH = "1"
```

That means anyone can authenticate against the production worker as the owner
just by sending `Authorization: Bearer dev-local-user`. **Fix before any public
exposure:**

- Set `ENVIRONMENT = "production"` and **remove** `DEV_BYPASS_AUTH` from the
  prod `[vars]`. With both gone, only valid **Clerk JWTs** are accepted (the
  real auth path), exactly as intended.
- **Local dev is unaffected:** `worker/.dev.vars` sets `ENVIRONMENT=development`,
  so `wrangler dev` keeps the `dev-local-user` bypass for curl/scripts.
- Note `[vars]` in `wrangler.toml` apply to the deployed worker; if you prefer
  not to hand-edit per environment, move these to environment-scoped vars or set
  `ENVIRONMENT` via the dashboard so prod and preview differ cleanly.

### 2. MCP_API_KEY must be set in production

The service/MCP auth path (`X-API-Key` header) in `auth.ts` requires a non-empty
`MCP_API_KEY` env var AND an exact header match — there is no fallback. It is in
the `Bindings` type but is **not** in `wrangler.toml` `[vars]` or `.dev.vars`.
Until `wrangler secret put MCP_API_KEY` is run for prod, every MCP retarget tool
call returns 401. (Conversely, leaving it unset is the safe default — set it only
when MCP tooling is meant to work.)

### 3. Rate limiting

No rate limiting today. The expensive endpoints — `/api/vercel/deploy` (polls
Vercel for up to 3 min and triggers real builds), `/api/github/push`/`import`
(many GitHub API subrequests), `/api/retarget/:id/from-url` (Firecrawl scrape +
LLM call), and the AI generation routes — can be abused or run up cost. Add
per-user / per-IP limits (Cloudflare Rate Limiting rules or a KV/DO token bucket
keyed on `userId`).

### 4. Structured error envelopes

Error responses are inconsistent: some return `{ error: string }`, some add
`detail`, some include partial-success fields (`pushed`, `errors[]`,
`deploymentId`, `warning`). Standardize on one envelope (e.g.
`{ ok: false, code, message, detail? }` vs `{ ok: true, data }`) so the SDK,
the CLI, and the frontend can branch reliably. The OpenAPI spec (sibling
deliverable) should document the chosen shape.

### 5. Observability / logging

Today it's `console.log`/`console.error` only (e.g. the `[Auth]` and Vercel/GitHub
error logs), visible via `wrangler tail`. For production add: a request-id per
call, structured JSON logs, a Logpush/Workers Analytics or Tail Worker sink, and
alerting on deploy `ERROR` states and auth failures. Avoid logging secrets or
full file contents.

### 6. Credits / billing review

`registerOwnerIfAdmin` (called from `auth.ts` via `services/credits`) grants the
owner unlimited credits and the cache is in-process (re-runs per cold start).
Before charging real users: confirm the credit ledger is durable (KV/DO, not
in-memory), that the owner-allowlist email (`hssolutions2181@gmail.com`) is the
only privileged account, and that deploy/generation costs are metered against
credits. This is intertwined with Auth hardening (#1) — the dev bypass currently
hands out owner-level unlimited credits.

### 7. Design-variety gallery

Needs product/design input before building. Goal: surface multiple visual
directions per generation instead of a single output. Blocked on a decision
about how variants are generated and presented; not a code-only task.

### 8. buddy-rail branch decision

Resolve the outstanding buddy-rail branch (merge, rebase onto the canonical
HEAD, or abandon) so production deploys ship from one known-good tree. Decide
before the next worker `wrangler deploy` so the deployed bundle matches the
reviewed source.

---

## Pre-deploy quick checklist

- [ ] `wrangler.toml`: `ENVIRONMENT = "production"`, `DEV_BYPASS_AUTH` removed.
- [ ] All prod secrets set via `wrangler secret put` (CLERK_SECRET_KEY,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, FIRECRAWL_API_KEY, OPENROUTER_API_KEY,
      FAL_KEY, VERCEL_API_KEY, GITHUB_PAT, SUPABASE_PAT, and MCP_API_KEY if MCP
      tools are in use).
- [ ] `ALLOWED_ORIGINS` includes every production frontend origin.
- [ ] Sibling deliverables (worker tab, MCP tools, `/api/spec.json`,
      lovable-pp-cli) confirmed mounted in `worker/src/index.ts`.
- [ ] `cd worker && npx tsc --noEmit` clean.
- [ ] Smoke test: generate → save → GitHub push → Vercel deploy with a real
      Clerk JWT (dev bypass OFF).
