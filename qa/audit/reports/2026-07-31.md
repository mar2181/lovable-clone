# HS Web App Builder — Audit Report

**Date:** 2026-07-31T11:30Z · **Run:** #3 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky  
**Overall: 🔴 RED** — Three P0 outages active simultaneously: build engine down (OpenRouter credits exhausted), dashboard 404 (stale Vercel deploy), voice box down (pod crashed). Additionally: 24 new GitHub dependency vulnerabilities (14 HIGH) discovered on push.

> Probe: 5 GREEN · 9 YELLOW · 3 RED | Deep audit: 6 domains | Auto-healed: **none** (all fixes require Mario)

---

## 🚩 Needs Mario (P0 → P1, ranked most urgent first)

---

### P0 — Build Engine DOWN: OpenRouter credits nearly exhausted 🔴 [REGRESSION — was RESTORED in 2026-06-07]

**Evidence:** POST /api/build SSE stream opened, emitted `build_start`, then hard-errored within ~1 second:
```
"This request requires more credits, or fewer max_tokens.
 You requested up to 65536 tokens, but can only afford 953.
 Visit https://openrouter.ai/settings/credits and add more credits"
```
Remaining balance: ~762–953 tokens. No `build_complete` received. Zero files produced. The product **cannot build anything**.

**Root cause:** OpenRouter account balance depleted. The worker's internal KV credit gate passes the request (user has enough internal credits), but OpenRouter rejects it at the API layer. The two systems are out of sync.

**Fix (takes 2 minutes):**
1. Log into [https://openrouter.ai/settings/credits](https://openrouter.ai/settings/credits)
2. Top up — suggest $10–$20 to cover ~1–3 months of audit/test builds
3. Verify: `curl -s -N --max-time 30 -X POST https://lovable-clone-backend.hssolutions2181.workers.dev/api/build/<any-project-id> -H "Authorization: Bearer dev-local-user" -H "Content-Type: application/json" -d '{"description":"test"}' | head -5` — should see `build_start` and then eventually `build_complete`.

---

### P0 — Dashboard `/dashboard` returns 404 🔴 [NEW — not present in 2026-06-07 report]

**Evidence:** `curl -sI https://hswebappbuilder.space/dashboard` → HTTP 404. Response body: Next.js `_not-found` RSC payload. Root `/` returns 200 (healthy).

**Root cause:** The live Vercel deployment (`dpl_8XiJJU2BgEUzPFLQ96ygxGr5A8P4`) is stale — it predates or failed to include the dashboard route, even though `app/dashboard/page.tsx` exists locally and `npm run build` succeeds and correctly lists `○ /dashboard` in the output. No recent commit touches the dashboard route itself; this is a **deployment pipeline failure**, not a code regression.

**Fix:**
1. In the Vercel dashboard, trigger a new deployment from the current master HEAD.
2. If it fails, check Vercel build logs for env var mismatches or Node version incompatibilities that differ from the local build environment (local builds succeed cleanly).
3. Verify: `curl -so /dev/null -w "%{http_code}" https://hswebappbuilder.space/dashboard` → must return 200 or 307 (auth redirect).

---

### P0 — Voice Box DOWN: port 7860 not responding 🔴 [PERSISTS/WORSENED]

**Evidence:** GET `https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → HTTP 404, empty body. The RunPod proxy is reachable (TLS succeeds, Cloudflare responds), but nothing is listening on port 7860 inside the container — the Voice Box application process has crashed or never started.  
All three endpoints checked: `/healthz`, `/dashboard/tools`, `/api/connect` — all 404.

**Fix (requires RunPod access — no cloud creds available here):**
1. Go to [https://runpod.io/console/pods](https://runpod.io/console/pods)
2. Find pod `udcz4k7kse1zw6`
3. If stopped: Start the pod. If running but process crashed: SSH in and restart the agent process (or stop→start the pod).
4. Verify: `curl -s https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → `{"ok":true,...}`

**Note:** Per `policy.md`, auto-fix of pod restart requires `RUNPOD_API_KEY` which is not available in cloud runs. Flag for Mario.

---

### P1 — 24 GitHub Dependency Vulnerabilities on master (14 HIGH, 10 moderate) 🔴 [NEW — ESCALATED from last audit]

Discovered on push: GitHub security scanner reports **24 vulnerabilities** on `mar2181/lovable-clone`'s default branch — 14 **high** severity and 10 moderate. This is a major escalation from the 10 moderate reported in 2026-06-07 (which were thought resolved by commit `5cef645`; these are new or newly-detected advisories).

**Fix:**
1. Go to [https://github.com/mar2181/lovable-clone/security/dependabot](https://github.com/mar2181/lovable-clone/security/dependabot)
2. Review each HIGH-severity advisory first. Accept Dependabot PRs for safe lock-file-only upgrades.
3. For breaking-change upgrades, review the diff carefully before merging.
4. Two Dependabot branches already exist on origin: `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` and `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` — start there.

---

### P1 — Dev-bypass LIVE in production: anyone with `Bearer dev-local-user` is owner 🔴 [PERSISTS — 3rd consecutive audit]

**Live confirmation:**
```
GET /api/credits → {"credits":{"userId":"dev-local-user","balance":9999,"tier":"unlimited",...}}
```
Any actor who knows the token gets owner-level access to the production worker — unlimited credits, all projects visible.

**Root cause:** `worker/wrangler.toml` lines 15-17:
```toml
[vars]
ENVIRONMENT = "development"
DEV_BYPASS_AUTH = "1"
```
These are in `[vars]` (deployed to prod), not `[dev]` (local only). The auth middleware at `worker/src/middleware/auth.ts:~62-74` fires on either condition:
```ts
const devBypassEnabled =
  c.env.ENVIRONMENT === "development" || c.env.DEV_BYPASS_AUTH === "1";
```

**Fix (CONFIRM-FIRST per policy.md — not auto-applied):**
1. Log into `hswebappbuilder.space` with real Clerk credentials and confirm your projects appear (so you don't lose project ownership after closing bypass).
2. Edit `worker/wrangler.toml` — remove lines 15-17 from `[vars]`:
   ```toml
   # DELETE these two lines from [vars]:
   ENVIRONMENT = "development"
   DEV_BYPASS_AUTH = "1"
   ```
   These belong only in `worker/.dev.vars` (which IS gitignored — confirmed safe, see P3 below).
3. `cd worker && wrangler deploy`
4. Verify: `curl -s https://lovable-clone-backend.hssolutions2181.workers.dev/api/credits -H "Authorization: Bearer dev-local-user"` → must return 401.

---

## ✅ Verified-Working

| Domain | Check | Result |
|--------|-------|--------|
| Worker | `/health` → 200 | GREEN |
| Worker | `/api/spec.json` → 200 (OpenAPI 3.1.0) | GREEN |
| Worker | `/api/projects` anon → 401 (deployed + gated) | GREEN |
| Frontend | `GET /` → 200 | GREEN |
| GitHub Import | Route `/api/github/import` anon → 401 (deployed + gated) | GREEN |
| GitHub Import | POST import `dan5py/react-vite-shadcn-ui` → 201, 22 files, 0 failed | GREEN |
| GitHub Import | Sandpack alias unit tests (5/5) | PASS |
| GitHub Import | Sandpack asset unit tests (9/9) | PASS |
| Security | `worker/.dev.vars` is gitignored (`.gitignore:53`) | CONFIRMED |
| Wiring | `/boxapi` rewrite → `udcz4k7kse1zw6-7860.proxy.runpod.net` (matches current box) | CORRECT |
| Build | Local `npm run build` (tsc) — all routes compile including `/dashboard` | PASS |

---

## 🩹 Hygiene Backlog (P2–P3)

### P2 — `agent_id` absent in `components/pet-concierge.tsx` [NEW]

The pet-concierge embed has `data-backend="selfhosted"` (line 99) and `data-connect-url="/boxapi"` (line 100), but no `agent_id` attribute. If the selfhosted box routes calls by agent_id, the concierge will silently connect to the wrong or default agent. Confirm with the box's `/dashboard/tools` endpoint once the box is back up.

**File:** `components/pet-concierge.tsx:99`

### P2 — `middleware.ts` deprecated; rename to `proxy.ts` [NEW]

Next.js 16.2.6 warns at build time:
```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
```
Currently non-breaking but will become a hard error in a future Next.js version.

**Fix:** `mv middleware.ts proxy.ts` and update any imports.

### P2 — `web_search` status unknown (TAVILY_API_KEY) [PERSISTS]

Could not confirm TAVILY_API_KEY status this run — build engine credits exhausted before any chat turn could execute. `wrangler.toml` has no `TAVILY_API_KEY` or `FIRECRAWL_API_KEY` in secrets list.

**Fix:** After restoring OpenRouter credits, run: `cd worker && wrangler secret list` — if `TAVILY_API_KEY` is absent, `wrangler secret put TAVILY_API_KEY`.

### P3 — `template-picker.tsx:80`: `fetchTemplates` before declaration [PERSISTS — 3rd audit]

ESLint hard error: `fetchTemplates` is called in a `useEffect` on line 78 but declared on line 84 below it. Stale-closure risk.

**Fix:** Move `fetchTemplates` declaration above the `useEffect` that calls it.

### P3 — 20+ `no-explicit-any` lint errors across SDK and worker [PERSISTS]

Files: `sdk/src/index.ts` (11 instances), `worker/src/ai/tools.ts` (3), `worker/src/middleware/auth.ts` (2), `worker/src/index.ts` (4), `worker/src/ai/build-types.ts`, `worker/src/ai/file-parser.ts`, `components/editor/build-panel.tsx`. Non-blocking but lint fails with exit code 1.

### P3 — Telegram/SMS integrations disabled

`GET /share/health` → `{"ok":true,"telegram":false,"sms":false}`. Notifications will not reach Mario via those channels. (Noted in all prior audits.)

### P3 — Build latency warning (from 2026-06-07 report)

Prior audit noted 4-page builds taking 180–200s, racing the SSE timeout. Could not re-measure this run (credits exhausted). Still an open concern once credits are restored.

---

## 🗂 GitHub Reconciliation

20 branches on origin. No unexpected branches.

| Branch | Age / Purpose | Recommendation |
|--------|--------------|----------------|
| `master` | Main branch | — |
| `claude/builder-buddy-rail` | Feature branch — builder buddy rail UI | **Review for merge** — unclear if superseded by recent auth work |
| `audit/report-2026-06-10` through `audit/report-2026-07-28` | 16 periodic audit snapshots | **Archive** — keep `latest.md` pattern, delete old audit branches after 30 days to reduce branch noise. Or accept as historical record. |
| `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` | Dependabot security update | **Review and merge** if tests pass |
| `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | Dependabot security update | **Review and merge** if tests pass |

**Note:** Commit `5cef645` ("fix(deps): clear all 44 dependabot alerts") was merged recently. The 2 remaining Dependabot branches are new post-merge advisories.

---

## Δ vs Previous Report (2026-06-07)

| Domain | 2026-06-07 | 2026-07-31 | Change |
|--------|-----------|-----------|--------|
| Build engine | ✅ RESTORED (P0 fixed) | 🔴 DOWN (OpenRouter credits exhausted) | **REGRESSION** |
| Dashboard | Not tested | 🔴 404 (stale Vercel deploy) | **NEW P0** |
| Voice box | Not confirmed healthy | 🔴 DOWN (port 7860 not responding) | **WORSENED** |
| P1 dev-bypass | 🔴 PERSISTS | 🔴 PERSISTS | **No change** |
| GitHub import | Not tested E2E | ✅ 201, 22 files | **IMPROVED** |
| Sandpack tests | Not run | ✅ 14/14 pass | **IMPROVED** |
| Dependabot 10 moderate | 🔴 NEW | Thought resolved via 5cef645, 24 new (14 HIGH) discovered on push | **ESCALATED** |
| `template-picker.tsx:80` | 🔴 P2 open | 🔴 P3 open | **No change** |
| agent_id in concierge | Not checked | 🔴 Missing | **NEW P2** |
| middleware.ts deprecation | Not flagged | ⚠️ Deprecated | **NEW P3** |

**Summary of changes:** 1 P0 regressed (build engine), 1 P0 new (dashboard), 1 resolved (dependabot), 2 new findings (agent_id, middleware deprecation).

---

## ⏭ Skipped Checks (Require Local Creds)

These checks were **not run** in this cloud session due to missing credentials. Mario's on-demand local run should cover them:

| Check | Reason skipped | What to run locally |
|-------|---------------|---------------------|
| RunPod pod power state | `RUNPOD_API_KEY` not set | `audit-probe.mjs --json` with key set |
| Voice box auto-restart | `RUNPOD_API_KEY` not set | `node qa/audit/selfheal.mjs` |
| Vercel deploy-drift | `VERCEL_TOKEN` not set | `audit-probe.mjs --json` with token set |
| Worker auto-redeploy self-heal | `CLOUDFLARE_API_KEY` not set | `selfheal.mjs` |
| Telegram notification delivery | Worker telegram=false | Confirm `TELEGRAM_BOT_TOKEN` set in worker secrets |
| TAVILY_API_KEY / web_search | OpenRouter credits exhausted (build blocked before tool execution) | Re-run chat probe once credits restored |
| `node qa/lovable-daily-qa.mjs` | Frontend script needs browser + prod session | Run in WSL with `LOVABLE_FRONTEND_URL=https://hswebappbuilder.space` |
| Import render verification | `node qa/verify-import-render.mjs` | Run locally with an import project id |
