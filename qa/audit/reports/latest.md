# HS Web App Builder — Audit Report

**Date:** 2026-10-04T11:12Z · **Run:** #4 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — two P1 regressions since last report: voice box process down, `/dashboard` 404 for unauthenticated users. Previously critical P1 (dev-bypass-prod) is now RESOLVED.

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 3 domain agents  |  Auto-healed: none (no cloud creds for pod restart)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P1 — Voice Box process DOWN (new since 2026-06-07)

The RunPod container at `udcz4k7kse1zw6-7860.proxy.runpod.net` is reachable over HTTP (responses received — not connection refused), but **every route returns 404**: `/healthz`, `/health`, `/` all return HTTP 404. The Chatterbox voice server process is not running or not listening on port 7860.

**Impact:** The Pet Concierge widget will fail whenever a user tries to start a voice session. The `/boxapi` proxy chain (frontend → Next.js rewrite → RunPod) is wired correctly (confirmed below), but the server-side process is dead.

**Fix (CANNOT auto-fix — no `RUNPOD_API_KEY` in cloud):**
1. SSH into the pod or use RunPod dashboard — check if the Chatterbox/faster-whisper process is running on port 7860.
2. Try restarting: `POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/dashboard/agent/restart`
3. If that fails, stop/start the pod via RunPod API:
   ```bash
   curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
     -X POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start
   ```
4. Re-verify: `curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → should return `{"ok":true,...}`.

---

### P1 — `/dashboard` returns 404 for unauthenticated users (new since 2026-06-07)

**Confirmed:** `GET https://hswebappbuilder.space/dashboard` returns HTTP 404 for unauthenticated requests. Response headers reveal the cause:
```
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-clerk-auth-status: signed-out
x-matched-path:      /404
age: 274708  (≈3 days stale — regression began ≈2026-10-01)
```

Clerk's `auth.protect()` in `middleware.ts` is **rewriting** unauthenticated requests to `/404` instead of **redirecting** them to `/sign-in`. This is a misconfiguration — users bookmarking or sharing a dashboard link hit a dead-end 404 with no sign-in prompt.

**Impact:** Any unauthenticated user navigating to `/dashboard` directly cannot access the app. This breaks onboarding and users returning from bookmarks.

**Fix (repo edit — flag for Mario):**

Option A (one-line code change in `middleware.ts`):
```ts
// Change:
auth.protect()
// To:
auth.protect({ unauthorizedUrl: '/sign-in' })
```

Option B (Vercel env var — no code change):
Set `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` in Vercel → redeploy.

The cached `/dashboard` 404 response (age=274708s) suggests Vercel CDN cached the 404 response ~3 days ago. After fixing, purge or wait for cache expiry.

---

### P2 — Build Engine E2E: UNTESTABLE from cloud (audit process regression)

The audit runbook uses `Authorization: Bearer dev-local-user` to test the build engine. As of 2026-08-09 security hardening, **this token is intentionally disabled in production** (`wrangler.toml` sets `ENVIRONMENT=production`, `DEV_BYPASS_AUTH` is absent). All project/build API calls return 401.

**The build engine itself may be functioning normally** — the worker health endpoint (`GET /`) returns 200 and the auth middleware correctly rejects the dev token. But we cannot run the SSE E2E build test (`POST /api/build/<id>`) without an authenticated identity.

**Impact on audit:** Build engine health is currently UNVERIFIED. This is a critical gap — the last confirmed E2E test was run #2 (2026-06-07).

**Fix (update audit process):**
The runbook must be updated to use `X-API-Key: <MCP_API_KEY>` + `X-User-Id` header (the service-account auth path in `auth.ts` lines 45–55, which preserves `isOwner: true`). Store `MCP_API_KEY` as a cloud secret. Until then, build engine E2E must be run locally.

**To run locally:**
```bash
# Create project
curl -H "X-API-Key: $MCP_API_KEY" -H "X-User-Id: mario" \
  -d '{"name":"audit","description":"x"}' \
  https://lovable-clone-backend.hssolutions2181.workers.dev/api/projects

# Run build (SSE, 200s timeout)
curl -N --max-time 200 -H "X-API-Key: $MCP_API_KEY" -H "X-User-Id: mario" \
  -d '{"description":"A simple landing page with a hero and one button."}' \
  https://lovable-clone-backend.hssolutions2181.workers.dev/api/build/<id>
```

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (gated). Worker process healthy. |
| **Security — dev-bypass-prod** | 🟢 RESOLVED | `wrangler.toml` has `ENVIRONMENT="production"` (line 15), no `DEV_BYPASS_AUTH`. `GET /api/credits` with `Bearer dev-local-user` → 401. Previously P1 is fully fixed. |
| **Security — .dev.vars** | 🟢 GREEN | `git check-ignore worker/.dev.vars` exits 0; `git ls-files worker/.dev.vars` empty; file doesn't exist on disk. `.gitignore` explicitly covers `worker/.dev.vars`, `.dev.vars`, `.dev.vars.*`. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 (route deployed and gated) |
| **Sandpack unit guards** | 🟢 GREEN | 5/5 alias checks + 9/9 asset checks = **14/14 assertions pass**. Both scripts exit 0. |
| **Pet-concierge wiring** | 🟢 GREEN | `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `agent_id="agent_4101ksg0ad0kf8f8ff7rr2sxqghc"` present. `next.config.ts` `/boxapi` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` — exact match. No auto-fallback gap. |
| **wrangler.toml security** | 🟢 GREEN | No `DEV_BYPASS_AUTH`, `ENVIRONMENT="production"`. Clean. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **35 stale `audit/report-*` branches** on origin cluttering the remote. Bulk-delete: `git push origin --delete $(git ls-remote --heads origin 'refs/heads/audit/report-*' | awk '{print $2}' | sed 's|refs/heads/||')` or via GitHub UI → Branches.
- **Missing `"type": "module"` in root `package.json`** — causes `[MODULE_TYPELESS_PACKAGE_JSON]` warning on every test run. One-line fix.
- **Audit runbook outdated** — `Bearer dev-local-user` no longer valid for build engine E2E; runbook needs updating to use `X-API-Key` service-account path.
- **Telegram/SMS not configured** — `/api/share/health` → `telegram:false, sms:false`. In-app sharing over phone is dark.
- **Pod billed 24/7** — `active_sessions:0` but pod running. No idle-watcher.
- **ESLint warnings persist** — 130+ `@typescript-eslint/no-explicit-any`, 80 other warnings. Non-blocking.
- **`GET /api/projects/<deleted-id>`** returns HTTP 200 with `{"error":"Project not found"}` — should be 404.
- **deploy/drift** — unverified (no Vercel token in cloud).
- **pod-power** — unverified (no `RUNPOD_API_KEY` in cloud).
- **P3 from last report** — `middleware.ts → proxy.ts` rename still pending (Next.js deprecation warning); `template-picker.tsx:80` hook bug still unaddressed; `web_search`/TAVILY_API_KEY still unconfirmed.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch | Age est. | What it is | Recommendation |
|---|---|---|---|
| `claude/builder-buddy-rail` | ~4 months | Docked Space Mario assistant rail — builder UI right-panel feature | **REVIEW + MERGE OR CLOSE** — feature-complete per prior audit; 4 months since last activity |
| `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` | unknown | Dependabot dep update for `mcp-server` | **BRING IN** — review and merge if safe |
| `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | unknown | Dependabot dep update for root package | **BRING IN** — review and merge if safe |
| 35× `audit/report-*` | various | Automated audit snapshot branches | **BULK DELETE** — no code value, pure noise |

**Open PRs:** Check GitHub for any open Dependabot security PRs not yet visible via `ls-remote`.

---

## Δ vs last report (2026-06-07)

| Item | Direction | Detail |
|---|---|---|
| P1 dev-bypass-prod | ✅ RESOLVED | `ENVIRONMENT=production`, no `DEV_BYPASS_AUTH`. `/api/credits` with dev token → 401. Confirmed fixed. |
| Voice box health | 🔴 REGRESSED | Was GREEN (18 tools, voices, sessions confirmed). Now all endpoints 404. Process down. |
| `/dashboard` | 🔴 REGRESSED | Was 200 (confirmed in last report). Now 404 — Clerk rewrite misconfiguration. Began ~2026-10-01 (cached). |
| Build engine E2E | ⚠️ UNVERIFIABLE | Last confirmed working 2026-06-07. Auth token changed — need MCP_API_KEY to re-test. |
| Sandpack unit guards | ✅ VERIFIED AGAIN | 14/14 pass (same as last). |
| Pet-concierge wiring | ✅ VERIFIED AGAIN | Still coherent. |
| .dev.vars gitignore | ✅ VERIFIED AGAIN | Still clean. |
| 35 stale audit branches | 🆕 NEW | Accumulating automated audit branches. Bulk-delete needed. |
| Runbook `dev-local-user` path | 🆕 BROKEN | Security hardening invalidated the audit's own test vector. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason | What to run locally |
|---|---|---|
| **Build engine E2E** | `Bearer dev-local-user` disabled in prod; `MCP_API_KEY` not in cloud env | `curl -H "X-API-Key: $MCP_API_KEY" -H "X-User-Id: mario" ...` per §Needs-Mario above |
| **GitHub import live test** | Same auth issue + `ownerOnly` gate | Use owner Clerk JWT or MCP_API_KEY |
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` or Vercel dashboard |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY` not in cloud | `selfheal.mjs` — not needed (worker up) |
| **Telegram notification** | No Telegram token in cloud | `POST /api/share/phone` or `notify_mario()` locally |
| **Box POST /api/connect session** | RunPod broker token in `.dev.vars` | Test HMAC-gated broker locally |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 3 parallel deep-audit agents → this synthesis.
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (2 RED · 9 YELLOW · 6 GREEN).
