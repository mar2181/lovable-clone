# HS Web App Builder — Audit Report

**Date:** 2026-07-04T11:10Z · **Run:** #6 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — Dashboard 404 persists (day ~26), voice box down, build engine timed out (partial recovery vs #5). P1 security bypass — **5th consecutive audit without fix.**

> Probe: 5 GREEN · 9 YELLOW · 3 RED  |  Deep audit: 6 domains  |  Auto-healed: none (no cloud creds for operational fixes)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0-A — Vercel Deploy Drift: `/dashboard` → 404 (PERSISTS — day ~26, since ~2026-06-08)

`GET https://hswebappbuilder.space/dashboard` → **HTTP 404**. No redirect, no cache header seen.
`GET https://hswebappbuilder.space/` → 200 (root works).

Local `npm run build` shows the route exists and compiles:
```
○ /dashboard   (Static)   — zero TypeScript errors, compiled in 8.6s
```
Git master HEAD is `50a7531`. The same 4 commits have been undeployed since the #4 audit (June 7). Vercel is serving a stale build that predates the dashboard route being stable. **Real users cannot reach the app shell after sign-in.**

**Fix (needs Vercel access):**
1. Trigger redeployment: `vercel --prod` OR push a trivial commit to master (if Vercel auto-deploys on push).
2. Wait for deployment READY, then: `curl https://hswebappbuilder.space/dashboard` → expect 200 or 307 (Clerk redirect to sign-in).
3. This has been flagged every run since #3 — one `vercel --prod` command resolves it.

---

### P0-B — Voice Box DOWN (PERSISTS — confirmed down since at least #3, ~2026-06-19)

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **HTTP 404** (was `ok:true` + 18 tools + voices `[will, jack]` in #2).
TLS handshake succeeds (pod proxy is reachable) but the agent process is not running or has crashed.

Code wiring is **correct** (no repo fix needed):
- `components/pet-concierge.tsx:99` → `data-backend="selfhosted"`, `data-connect-url="/boxapi"`
- `next.config.ts:13` → destination `https://udcz4k7kse1zw6-7860.proxy.runpod.net` ✅ (chain coherent)

**Fix (needs RunPod API key — cannot auto-fix in cloud):**
```bash
# 1. Check pod state
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/pods/udcz4k7kse1zw6

# 2a. If EXITED/stopped:
curl -X POST -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start

# 2b. If RUNNING but agent crashed:
curl -X POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/dashboard/agent/restart

# 3. Verify:
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz  # expect ok:true, tools.count ≥ 18
```
**Cost note:** pod billed ~$0.69/hr even while crashed/idle ≈ $500/mo burn with 0 active sessions.

---

### P0-C — Build Engine: Timed Out (PARTIAL RECOVERY vs #5 — was error "no files")

**SSE E2E result this run:**
- POST `/api/projects` → 201, id `NPhdNcsbqb` ✅
- POST `/api/build/NPhdNcsbqb` `{"description":"A simple landing page with a hero section and one button."}` → SSE stream:
  - `build_start` (4 pages, 2 batches) ✅
  - Batch 0 (Home/About Us/Services): `batch_stream` received full JSON with App.tsx, Header.tsx, Footer.tsx, 3 page components ✅
  - `batch_done` for batch 0 ✅
  - Batch 1 (Contact): `page_status → generating`… **curl timeout at 200s — no `build_complete`, no `error` event**
- DELETE → 200 ✅

**Interpretation:** OpenRouter credits are non-zero (batch 0 generated successfully). The build engine is partially functional — it generates pages but **takes >200s for a trivial 4-page site**. Last run (#4, June 7) completed in 180–200s; #5 (July 1) failed with "no files" error; this run (#6) produced no error but exceeded 200s while Contact was still generating.

**Status:** YELLOW (not confirmed broken, not confirmed working). A 240s+ timeout run locally might capture `build_complete`. Core concern is latency regression.

**Fix:**
1. Check OpenRouter rate limits / model latency — if throttling on `o3` or equivalent, try a faster model.
2. Add a server-side SSE keepalive ping every 30s to prevent gateway timeout on long builds.
3. Consider raising the worker's fetch timeout beyond 180s (`worker/src/routes/build.ts`) and documenting the expected 4-min SLA.
4. Next audit will use `--max-time 300` to definitively confirm pass/fail.

---

### P1 — Dev-bypass in prod (PERSISTS — 5th consecutive audit, unfixed since June 7)

`GET /api/credits` with `Authorization: Bearer dev-local-user` → `{"tier":"unlimited","balance":9999}` — owner-level access, HTTP 200.

`worker/wrangler.toml` still deploys `ENVIRONMENT="development"` + `DEV_BYPASS_AUTH="1"` into production `[vars]`. Anyone with knowledge of the header value has owner-level access to your worker and all projects.

**Fix (CONFIRM-FIRST per policy.md — NOT auto-applied):**
1. Log into `https://hswebappbuilder.space` with real Clerk credentials; confirm your projects are present.
2. In `worker/wrangler.toml`, remove from `[vars]`:
   ```toml
   ENVIRONMENT = "development"   # DELETE
   DEV_BYPASS_AUTH = "1"         # DELETE
   ```
   (These belong only in `worker/.dev.vars`, which IS gitignored ✅.)
3. `cd worker && wrangler deploy`
4. Verify: `curl -H "Authorization: Bearer dev-local-user" https://lovable-clone-backend.hssolutions2181.workers.dev/api/credits` → expect 401.

**This is a 45-second fix. It has now been unfixed for 27+ days across 5 audits.**

---

## ✅ Verified Working

| Domain | Verdict | Evidence this run |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` → 200; `/api/spec.json` → 200 (openapi 3.1.0); `/api/projects` anon → 401 (correct auth gate). |
| **GitHub Import** | 🟢 GREEN | Both Sandpack unit guards **PASS** (5/5 alias · 9/9 asset checks). Live import `dan5py/react-vite-shadcn-ui` → 201, 22 files, 0 failed. Cleanup 200 ✅. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build (local)** | 🟢 GREEN | `npm run build`: Next.js 16.2.6 Turbopack, compiled in 8.6s, **TypeScript 0 errors** (7.3s). 6 routes generated (/, /dashboard, /editor/[id], /sign-in, /sign-up, /test-preview). |
| **Pet Concierge wiring (code)** | 🟢 GREEN | `pet-concierge.tsx:99` `data-backend="selfhosted"`, `data-connect-url="/boxapi"`. `next.config.ts:13` → `udcz4k7kse1zw6-7860.proxy.runpod.net`. Chain coherent. Box itself is down (infra, not wiring). |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; confirmed not tracked. |
| **Worker CORS** | 🟢 GREEN | `worker/src/index.ts` uses exact-match origin allowlist (not `*`). |
| **Build engine (batch 0)** | 🟡 YELLOW | Batch 0 generated files successfully (App.tsx, Header, 3 pages). Batch 1 timed out. OpenRouter credits non-zero. Latency is the blocker. |

---

### P1/P2 — 43 Dependabot Vulnerabilities on master (ESCALATION — was 10 moderate in #2)

GitHub push notification: **43 vulnerabilities on the default branch — 5 HIGH, 30 moderate, 8 low.**

This is a significant escalation from the 10 moderate advisories flagged in audit #2 (June 7). 5 HIGH-severity vulnerabilities have appeared.

**Fix:**
1. Review advisories: `https://github.com/mar2181/lovable-clone/security/dependabot`
2. PR #28 (`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`) addresses 2 of them — review and merge if safe.
3. For remaining advisories, accept Dependabot's auto-PRs for any that are safe lock-file-only upgrades.
4. HIGH-severity advisories should be addressed within 7 days.

---

## 🩹 Hygiene Backlog (P3 — batched)

- **Next.js `middleware` → `proxy` rename** — `npm run build` still emits: *"The 'middleware' file convention is deprecated. Please use 'proxy' instead."* `middleware.ts` exists, `proxy.ts` does not. Flagged since #2. Fix: `git mv middleware.ts proxy.ts` + update any imports.
- **Telegram/SMS not configured** — `/api/share/health` → `{telegram:false, sms:false}`. In-app phone sharing is dark.
- **ESLint: 156 errors, 80 warnings (236 total)** — dominated by `@typescript-eslint/no-explicit-any` in worker routes and components. Non-blocking.
- **Pod billed 24/7 at ~$0.69/hr** with 0 active sessions ≈ $500/mo. Idle-shutdown controller not implemented.
- **`GET /api/projects/<deleted-id>` returns 200 `{"error":"Project not found"}`** — should be 404.
- **`TAVILY_API_KEY` likely unset** — web_search may be dead. Not confirmed this run (build timeout blocked chat-turn test). Verify: send a chat turn forcing web_search; if "unavailable", `cd worker && wrangler secret put TAVILY_API_KEY`.
- **Next.js workspace warning** — stray `/home/mario/package-lock.json` confuses Turbopack.
- **Sandpack unit test warning** — `MODULE_TYPELESS_PACKAGE_JSON` warning in both test files; add `"type": "module"` to `package.json` to eliminate.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD: `50a7531` (unchanged since #2, 2026-06-07). No new commits to master.

**Branches on remote:**

| Branch | PR | Age | Recommendation | Notes |
|---|---|---|---|---|
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** | #28 (open, June 20) | 14 days | **MERGE or close** | "bump npm_and_yarn group across 3 directories with 2 updates" — Dependabot security/patch bump. 14 days old. Review the diff; if it's a safe lock-file update, merge. If it conflicts with active work, close and re-run Dependabot. |
| **`claude/builder-buddy-rail`** | #20 (open, June 4) | 30 days | **REVIEW (overdue)** | Docked Space Mario assistant rail — builder UI right-panel. Updated to live endpoint. Recommended BRING IN FOR REVIEW in #2. Now 30 days without action. |
| **`audit/report-2026-06-10` → `audit/report-2026-07-01`** | #27, #29, #32, #33, #36 (all open) | 3–24 days | **ARCHIVE after reading** | Normal audit cadence. Consider closing old report PRs after reading; they are informational, not for merge. |

**Resolved since #2 (June 7):**
- `fix/sanitizer-icon-imports` — DELETED ✅ (was recommended REBASE THEN REVIEW)
- `archive/windows-side-2026-05-11` — DELETED ✅ (was recommended ARCHIVE)
- `backup/pr13-pre-resolve-2026-05-12` — DELETED ✅ (was recommended ARCHIVE)

**Open Dependabot advisories on master:** Not checked this run (no GitHub Security API access in cloud). Previous run (#5, July 1) had 10 moderate advisories. PR #28 may address some of them.

---

## Δ vs #5 (2026-07-01)

| Item | Direction | Detail |
|---|---|---|
| Build engine (batch 0) | 🟡 PARTIAL RECOVERY | Was "error: no files" in #5. Now batch 0 generates without error. Still timed out at 200s on batch 1. Not confirmed complete. |
| Dashboard 404 | 🔴 PERSISTS (day ~26) | Same stale Vercel deployment. Unchanged. |
| Voice box DOWN | 🔴 PERSISTS | `/healthz` → 404. Unchanged. |
| P1 dev-bypass | 🔴 PERSISTS (5th audit) | `Bearer dev-local-user` → unlimited. Unfixed. |
| GitHub import | ✅ VERIFIED GREEN | 201, 22 files, 0 failed. |
| Sandpack unit guards | ✅ VERIFIED GREEN | 5/5 alias + 9/9 asset checks pass. |
| Old stale branches | ✅ CLEANED | `fix/sanitizer-icon-imports`, `archive/windows-side-*`, `backup/pr13-*` all deleted from remote. |
| Dependabot PR #28 | 🆕 ACTION NEEDED | 14 days old, no action taken. Review and merge or close. |
| PR #20 builder-buddy-rail | ⚠️ OVERDUE | 30 days open, still unreviewed. |

---

## ⛔ Checks Skipped for Lack of Cloud Creds

These require local/vault access. Cover them in the owner's on-demand local run:

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` / check Vercel dashboard — confirm HEAD `50a7531` deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | `selfheal.mjs` not run |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` |
| **Box POST /api/connect session test** | RunPod broker token in `.dev.vars` | Test HMAC-gated broker: `POST <box>/api/connect` → expect `connectUrl`+token |
| **Build E2E full confirmation** | 200s SSE timeout insufficient | Re-run with `--max-time 300` locally to capture `build_complete` |
| **TAVILY_API_KEY web_search test** | Blocked by build latency | `POST /api/chat` with web_search tool turn |

---

## How This Was Produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) + 6-domain deep audit.
Probe overall: RED (3 RED/P0+P1 · 9 YELLOW/cloud-cred limits · 5 GREEN).
Run #6 — 3-day scheduled cadence.
