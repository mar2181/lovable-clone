# HS Web App Builder — Audit Report

**Date:** 2026-09-28T11:20Z · **Run:** #34 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — Voice box down day 85+, dashboard 404 day 110+, critical CVE in Next.js. P1 dev-bypass RESOLVED. Build engine testability gap (auth required). 

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: all 6 domains  |  Auto-healed: none (box restart needs RunPod key)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Voice Box / Pet Concierge down (day 85+) [PERSISTS]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **404**. The RunPod pod is stopped or the container has crashed.

- **Wiring is intact** (`data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `next.config.ts /boxapi → proxy.runpod.net` — all match).
- The box was at build `2026-06-06-hsreels-tts`, 18 tools, voices `[will, jack]` on last confirmed healthy run (2026-06-07).
- Auto-fix requires `RUNPOD_API_KEY` (not in cloud). Mario must restart.

**Fix:**
```bash
# 1. Restart the RunPod pod:
curl -X POST "https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"

# 2. Wait ~60s, then confirm:
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
# expect: {"ok":true,"tools":{"count":18},...}
```

Note: If the pod restarts but /healthz still fails, the agent process may need restart via `POST /dashboard/agent/restart`.

---

### P0 → P2 — Dashboard 404 via Clerk auth rewrite (day 110+) [PERSISTS]

`GET https://hswebappbuilder.space/dashboard` → **404** (HTTP 404, not a redirect).

Clerk response headers: `x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing` — Clerk's `auth.protect()` in `middleware.ts` is rewriting the request to `/404` instead of redirecting to `/sign-in`. Unauthenticated users get a blank 404 page, not the sign-in flow.

**Root cause:** `auth.protect()` without a `signInUrl` option in the Clerk config. In Clerk Next.js SDK v5+, when no `signInUrl` is set in the app's Clerk dashboard or `middleware.ts`, protection rewrites to 404 instead of redirecting.

**Fix:**
Option A (code, ~1 line): Pass `signInUrl` to `auth.protect()` in `middleware.ts`:
```ts
// middleware.ts:16
await auth.protect({ unauthenticatedUrl: '/sign-in' })
```
Option B (Clerk dashboard): Set "Sign-in URL" in your Clerk application settings to `/sign-in`.

Either fix requires a Vercel redeploy to take effect.

---

### P1 — 94 vulnerabilities across full repo (4 critical, 38 high) [PERSISTS]

GitHub Dependabot reports **94 total vulnerabilities** on master (`4 critical, 38 high, 47 moderate, 5 low`) — same count as last run (2026-09-25). See `https://github.com/mar2181/lovable-clone/security/dependabot`.

Frontend-only `npm audit` breakdown: **1 critical (`next`), 7 high** — the `next` package itself has a critical CVE, which is the most urgent to patch:

| Severity | Package | Notes |
|---|---|---|
| **CRITICAL** | `next` | Next.js itself — check GitHub advisories for CVE + fixed version |
| HIGH | `brace-expansion` | |
| HIGH | `browserslist` | |
| HIGH | `fast-uri` | mcp-server Dependabot PR #47 already open |
| HIGH | `ip-address` | |
| HIGH | `js-yaml` | |
| HIGH | `nanoid` | |
| HIGH | `sharp` | |

The remaining 77 vulnerabilities are in `worker/` and `mcp-server/` packages.

**Fix:**
```bash
# Frontend:
npm audit fix          # lock-file-only safe fixes
npm audit fix --force  # only after reviewing each package
git add package-lock.json && git commit && git push  # triggers Vercel redeploy

# Worker:
cd worker && npm audit fix

# MCP server: merge Dependabot PR #47 (fast-uri bump — already open)
```
For `next` critical: check `https://github.com/vercel/next.js/security/advisories` for the exact CVE and patch version before force-upgrading.

---

### P2 — Build engine untestable from cloud (auth gap) [PERSISTS]

With the P1 dev-bypass now correctly disabled (`ENVIRONMENT=production`), `Bearer dev-local-user` returns 401 on all routes. The cloud audit cannot test the build engine E2E. This is correct security behavior but creates a monitoring blind spot.

`POST /api/projects` → `{"error":"Unauthorized — invalid token"}` (as expected).

**Status:** Build engine *health* is GREEN (worker /health 200, routes deployed), but actual build E2E is unconfirmed since 2026-09-25. Last confirmed working: run #2 (2026-06-07).

**Fix (monitoring):** The audit probe should use an `X-API-Key` (MCP_API_KEY secret) for build E2E. `worker/src/middleware/auth.ts` already checks `X-API-Key` before Clerk. Add `AUDIT_API_KEY=<mcp_api_key_value>` to cloud env vars, then update `audit-probe.mjs` to include it.

---

## 🔧 Auto-healed this run
**None.** Box restart requires RunPod API key (not in cloud). No other operationally-fixable REDs present.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct) |
| **P1 security bypass** | 🟢 RESOLVED | `Bearer dev-local-user` → 401 on all routes. `wrangler.toml` correctly has `ENVIRONMENT=production`, no `DEV_BYPASS_AUTH`. Committed `d511723` + `e5fc9f5`. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 |
| **Frontend build** | 🟢 GREEN | `next build` (Next.js 16.2.6 Turbopack) clean in 14.3s; **TypeScript: 0 errors** (10.1s). 6 routes built. |
| **Sandpack unit guards** | 🟢 GREEN | `test-sandpack-alias.ts` 5/5 PASS; `test-sandpack-assets.ts` 9/9 PASS |
| **Import route deployed** | 🟢 GREEN | `/api/github/import` anon → 401 (gated, correct) |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; confirmed not tracked |
| **Box wiring** | 🟢 GREEN | `data-backend="selfhosted"` → `/boxapi` → `proxy.runpod.net` — chain intact (box is down but wiring is correct) |

---

## 🩹 Hygiene backlog (P3 — batched)

- **ESLint: 236 problems** (157 errors, 79 warnings). Errors include `no-explicit-any` in `worker/src/services/image-gen.ts`, `video-gen.ts`; `prefer-const` violations.
- **middleware.ts → proxy.ts rename** still needed. `next build` emits deprecation warning: "The 'middleware' file convention is deprecated. Please use 'proxy' instead." Needed before Next.js 17.
- **Telegram/SMS not configured** (`/api/share/health` → 401, integration values undefined). In-app share-to-phone is dark.
- **Pod billed 24/7** while stopped/idle (still accruing if not deleted). Consider a stop-when-down policy.
- **deploy/drift** — not verified (no Vercel token in cloud). Check Vercel dashboard confirms HEAD `eb5ab74` is live.
- **pod-power** — not checked (no RunPod key in cloud). Check pod state via RunPod dashboard.
- **`GET /api/projects/<deleted-id>`** returns 200 with `{"error":"Project not found"}` — should be 404. Cosmetic.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD: `eb5ab74` (chat: cap AI output at 32k tokens)

**Non-audit open branches:**

| Branch / PR | Age | What it is | Recommendation |
|---|---|---|---|
| **`claude/builder-buddy-rail`** (PR #20) | ~117 days | Docked Space Mario assistant rail — `buddy-panel.tsx`, `pc-embed.js` | **STALE — REVIEW OR CLOSE.** Updated June 4, 2026 to live endpoint. Now 117 days old and the live endpoint (box) is down day 85+. Needs a fresh review when box is restored. |
| **`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`** (PR #47) | ~69 days | `fast-uri` bump in mcp-server (fast-uri is also a HIGH vuln) | **MERGE** — lock-file-only dep bump, safe. Addresses a HIGH vuln. |
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** (PR #28) | ~100 days | 2 dep bumps across 3 dirs | **REVIEW + MERGE** — check the 2 packages bumped, merge if safe. 100 days is too long to leave Dependabot PRs open. |

**Stale audit report PRs:** PRs #22–#81 (all `audit/report-*`) are open with no plan to merge. These are reference-only. Consider closing them as "won't merge" after reading, to reduce noise, or using a dedicated audit-reports branch strategy instead.

---

## Δ vs previous (2026-09-25)

| Item | Direction | Detail |
|---|---|---|
| Vulnerability count | 🔴 PERSISTS | 94 total (full repo, per GitHub Dependabot) — same as 2026-09-25. Frontend: 1 critical (`next`) + 7 high. |
| **CRITICAL `next` CVE** | 🔴 CONFIRM | `next` package flagged critical in frontend `npm audit`. Patch urgently. |
| Voice box down | 🔴 PERSISTS | Day 85+ (was 82+ on 2026-09-25). No change. |
| Dashboard 404 | 🔴 PERSISTS | Day 110+ (was ~107+ on 2026-09-25). No change. |
| P1 dev-bypass | ✅ CONFIRMED RESOLVED | `ENVIRONMENT=production` in `wrangler.toml` — bypass off in prod. |
| Build auth gap | 🔴 PERSISTS | Dev-local-user → 401 prevents cloud E2E test. Fix: add X-API-Key to probe. |
| TypeScript | ✅ GREEN | 0 errors in `npm run build` |
| Sandpack unit tests | ✅ GREEN | 5/5 alias + 9/9 asset checks pass |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` absent | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Box restart (P0 self-heal)** | `RUNPOD_API_KEY` absent | `curl -X POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start -H "Authorization: Bearer $RUNPOD_API_KEY"` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` absent | `vercel ls` / check Vercel dashboard — confirm HEAD `eb5ab74` deployed |
| **Build engine E2E** | No real Clerk JWT / `X-API-KEY` for worker in cloud | Extend probe with `X-API-Key` from `MCP_API_KEY` secret, or test locally with a valid session |
| **GitHub import live test** | Same auth issue | `POST /api/github/import` with real auth token |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — works locally |
| **Box `POST /api/connect` session test** | Box is down + HMAC broker token in `.dev.vars` | Restore box first, then test locally |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 6 domain checks (parallel) → synthesis.
Probe: 6 GREEN · 9 YELLOW · 2 RED · overall RED.
Master HEAD: `eb5ab74` (`git log --oneline -1`).
