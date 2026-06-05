# Deploy Workflow — HS Solutions App & Web Builder

Operator guide for running the builder locally and shipping a generated project all
the way to a live URL. Everything here is grounded in the actual worker code
(`worker/src/routes/vercel.ts`, `worker/src/routes/github.ts`,
`worker/wrangler.toml`, `scripts/start-lovable-worker.sh`,
`scripts/start-lovable-frontend.sh`).

There are **two separate things called "deploy"** in this system; keep them straight:

1. **Project deploy** — shipping a user's *generated app* to GitHub + Vercel
   (the Save → GitHub → Vercel flow below).
2. **Worker deploy** — pushing the *builder backend itself* (this Cloudflare
   Worker) to `*.workers.dev` (the "Deploying the worker to Cloudflare"
   section).

---

## 1. Local dev startup

The canonical repo lives in WSL at `/home/mario/lovable-clone`. Two processes:
the Cloudflare **worker** on `:8799` and the Next.js **frontend** on `:3015`.
Both ship as helper scripts under `scripts/` that pin the port, rotate their
logs, and refuse to start a duplicate if the port is already answering.

### Worker (`:8799`)

```bash
cd /home/mario/lovable-clone
bash scripts/start-lovable-worker.sh
```

What it does (see `scripts/start-lovable-worker.sh`):
- `cd worker` and runs `npx wrangler dev --ip 0.0.0.0 --port 8799`.
- Port `8799` is also pinned in `wrangler.toml` under `[dev] port = 8799` —
  keep the three in sync (script, `wrangler.toml`, and the frontend's
  `NEXT_PUBLIC_WORKER_URL`).
- Logs to `.lovable-startup-logs/worker.log` (auto-rotated at 50 MB).
- If `:8799` is already responding it will NOT start a second copy (racing two
  `wrangler dev` instances on one port caused bind-fail/EPIPE crash loops). To
  intentionally restart: `fuser -k 8799/tcp` first.

Local secrets/vars come from `worker/.dev.vars` (gitignored): `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `OPENROUTER_API_KEY`, `FAL_KEY`,
`GITHUB_PAT`, `VERCEL_API_KEY`, `SUPABASE_PAT`, `FIRECRAWL_API_KEY`, plus
`ENVIRONMENT=development`. Because `.dev.vars` sets `ENVIRONMENT=development`,
the dev-auth bypass is on locally (see Auth below).

### Frontend (`:3015`)

```bash
cd /home/mario/lovable-clone
bash scripts/start-lovable-frontend.sh
```

What it does (see `scripts/start-lovable-frontend.sh`):
- Runs `npm run dev -- -H 0.0.0.0 --port 3015` with
  `NEXT_PUBLIC_WORKER_URL=http://localhost:8799` exported so the UI talks to the
  local worker.
- Dashboard opens at **http://localhost:3015/dashboard**.
- Same single-instance guard + 50 MB log rotation to
  `.lovable-startup-logs/frontend.log`.

### Dev auth

For local API calls (curl, scripts) the worker accepts the dev token:

```
Authorization: Bearer dev-local-user
```

This works locally because `.dev.vars` sets `ENVIRONMENT=development`
(see `worker/src/middleware/auth.ts`). The frontend's `lib/dev-auth.tsx` uses
the same fake user, so the dashboard shows the owner project list without a
real Clerk login.

---

## 2. Ship flow: Save → GitHub → Vercel

A generated project is a `{ "/path": "content" }` file map plus an optional
`dependencies` object, versioned append-only in storage:

```
KV  user:{userId}:project:{id}      -> JSON metadata { id, userId, name, ... }
KV  project:{id}:latest_version     -> "3"
R2  {id}/v{n}.json                  -> { version, createdAt, prompt, files, dependencies? }
```

`GET /api/versions/:id/latest` returns the newest version's `files` map, which is
what you hand to the deploy endpoints below.

### a) Push to GitHub — `POST /api/github/push`

```bash
curl -X POST http://localhost:8799/api/github/push \
  -H "Authorization: Bearer dev-local-user" \
  -H "Content-Type: application/json" \
  -d '{ "repoName": "my-coffee-shop", "projectId": "<id>", "files": { "/src/App.tsx": "..." } }'
```

Behavior (`worker/src/routes/github.ts`):
- Authenticates the server's `GITHUB_PAT`, resolves the owner from
  `GET /user`, then creates the repo (`auto_init`, public) if needed. A `422`
  (repo already exists) is treated as success.
- Pushes every file via the Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`),
  fetching each file's existing SHA first so it updates instead of failing on
  re-push. Good for **< 100 files**.
- If the project has Supabase linked it injects a `.env.example` with the
  Supabase URL + anon key.
- **Identity persistence (idempotent):** on the first successful push it stores
  the repo's bare name at KV `project:{id}:github_repo`. Every later push reuses
  THAT repo even if the caller passes a different `repoName` (e.g. after a
  rename), so a rename can never spawn a second/duplicate repo and orphan the
  first. Response includes `reusedExisting`, `pushed`, `total`.

### b) Deploy to Vercel — `POST /api/vercel/deploy`

```bash
curl -X POST http://localhost:8799/api/vercel/deploy \
  -H "Authorization: Bearer dev-local-user" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<id>", "files": { "/src/App.tsx": "...", "/package.json": "..." } }'
```

Behavior (`worker/src/routes/vercel.ts`):
- Requires `VERCEL_API_KEY` on the server (500 if missing).
- **Framework auto-detection:** reads the incoming `package.json`. If the build
  script or deps reference `vite`, it deploys as a **Vite** project (and
  scaffolds a root `index.html`, `vite.config.ts`, and a bundler-style
  `tsconfig.json` if missing). Otherwise it scaffolds a **create-react-app**
  project (synthesizing `package.json`, `public/index.html`, `src/index.tsx`,
  `src/index.css`, `tsconfig.json`, and an `App.tsx` wrapper when only loose
  components exist). The default template ships Vite, so most deploys take the
  Vite path.
- Deploys via the Vercel **v13 deployments API** with `target: "production"`, so
  the build is promoted to the project's **stable** `{project}.vercel.app`
  hostname instead of a per-deploy hash subdomain.
- If Supabase is linked it injects both `REACT_APP_*` and `VITE_*` env vars so
  client code works regardless of template.
- **Polls until READY** (3s interval, ~3 min cap). It deliberately does not
  return the URL early — the production alias returns `DEPLOYMENT_NOT_FOUND`
  (a 404) until the build finishes. On `ERROR` it pulls the build error line
  from the events API and returns it. If still building after 3 min it returns
  the per-deploy URL with a `warning`.
- **Project name + identity persistence (idempotent):** the project name is
  derived from the human-readable name (`{slug}-{idTail}`, e.g.
  `my-coffee-shop-abc12345`). On the first deploy it stores that name at KV
  `project:{id}:vercel_project_id`; every later deploy reuses it regardless of
  the current display name. The v13 API routes by `name`, so without this a
  rename would spin up a SECOND Vercel project and orphan the first one's
  production domain. Response includes `deploymentUrl` (clean production alias),
  `previewUrl`, `aliases`, `vercelProjectName`, `reusedExisting`, `status`.

**Typical operator sequence:** Save the project (creates a new R2 version) →
`POST /api/github/push` → `POST /api/vercel/deploy`. Re-running either is safe and
lands in the same repo / same Vercel project thanks to the persisted identity
keys above.

---

## 3. Deploying the worker itself to Cloudflare

The builder backend is a Cloudflare Worker (`worker/`, entry `src/index.ts`,
service name `lovable-clone-backend` per `wrangler.toml`). Deploy with Wrangler:

```bash
cd /home/mario/lovable-clone/worker
CLOUDFLARE_API_KEY=<key> CLOUDFLARE_EMAIL=<account-email> npx wrangler deploy
```

Notes:
- **Stable URL:** the worker is served at
  **https://lovable-clone-backend.hssolutions2181.workers.dev**, and that
  hostname is **stable across deploys**. The frontend points at it via
  `NEXT_PUBLIC_WORKER_URL`, so re-deploying the worker never requires a frontend
  change.
- Bindings (`wrangler.toml`): R2 bucket `lovable-projects` (`R2_PROJECTS`), KV
  namespace `KV_METADATA`, a daily GC cron (`0 3 * * *`), and `[vars]` for
  `ENVIRONMENT`, `DEV_BYPASS_AUTH`, `R2_PUBLIC_DOMAIN`.
- **Production secrets** are NOT in `wrangler.toml`. Set each once with
  `wrangler secret put` (they persist across deploys):

```bash
cd /home/mario/lovable-clone/worker
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
npx wrangler secret put FIRECRAWL_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put FAL_KEY
npx wrangler secret put VERCEL_API_KEY
npx wrangler secret put GITHUB_PAT
npx wrangler secret put SUPABASE_PAT
# Required for MCP/service tool access (X-API-Key auth path):
npx wrangler secret put MCP_API_KEY
```

- **CORS:** allowed origins come from the `ALLOWED_ORIGINS` env var
  (comma-separated) merged with a built-in fallback that already includes
  `https://hswebappbuilder.space` and the two localhost ports. Add any new
  frontend origin to `ALLOWED_ORIGINS` rather than editing code.

After a worker deploy, smoke-test from the frontend (generate → save → deploy a
toy project) or curl an authenticated endpoint with a real Clerk JWT (the
`dev-local-user` bypass should be OFF in prod — see `docs/PRODUCTIONIZATION.md`).
