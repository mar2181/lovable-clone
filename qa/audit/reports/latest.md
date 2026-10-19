# HS Web App Builder — Audit Report

**Date:** 2026-10-19T11:20Z · **Run:** #16 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky  
**Overall: 🔴 RED** — MCP_API_KEY still hardcoded (day 6), dashboard 404 day ~133, voice box day ~104. One RESOLUTION: dev-bypass-prod P1 finally fixed.

> Probe: 6 GREEN · 9 YELLOW · 2 RED | Auto-healed: none (cloud run; RUNPOD_API_KEY unavailable)

---

## 🚩 Needs Mario (ranked P1 → P0 → P0)

### P1 🔑 — MCP_API_KEY hardcoded in `mcp-server/lovable.sh` [PERSISTS — day 6, unresolved since Oct 13]

**Confirmed live today.** `mcp-server/lovable.sh` line 6:
```bash
API_KEY="${MCP_API_KEY:-d821bb15d17bd44b19f41f0d68925eb917724a18b82521b1b3d3da809f9b1c73}"
```
This key matches the `MCP_API_KEY` auth path in `worker/src/middleware/auth.ts` — grants `isOwner: true`, full operator privileges: arbitrary Supabase Management SQL, GitHub PAT pushes, Vercel prod deploys, Twilio SMS. The repo is public. **Anyone can extract this key from git history and impersonate the owner in production.**

**Fix (ROTATE IMMEDIATELY — confirm-first per policy.md):**
1. Generate a new random 64-char hex key — do NOT reuse the committed value.
2. `cd worker && wrangler secret put MCP_API_KEY` (new value).
3. Update `mcp-server/lovable.sh` line 6: remove the fallback default, use `${MCP_API_KEY:?MCP_API_KEY is required}` — fail loudly if unset.
4. Also rotate Supabase PAT, GitHub PAT, and any credential that key could have been used to extract (repo is public; key has been live ~6 days since detection, longer since commit `0d64c49`).
5. Purge from git history: `git filter-repo --path mcp-server/lovable.sh --invert-paths` then re-add cleaned version, OR use BFG Repo Cleaner.

---

### P0 🌐 — Dashboard `/dashboard` returns cached 404 (day ~133) [PERSISTS]

`/dashboard` → HTTP 404 with `x-vercel-cache: HIT`. Confirmed today:
```
HTTP/2 404
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-matched-path: /404
x-vercel-cache: HIT   (age: 259502s ≈ 3 days of edge-cached stale 404)
```

**Root cause (established Run #14):** Clerk's `auth.protect()` in `middleware.ts` uses a `protect-rewrite` for non-browser requests lacking a Clerk session. Vercel's edge CDN cached that 404 and keeps serving it. The app route (`app/dashboard/page.tsx`) and `/sign-in` both exist and build correctly — this is purely a routing/cache bug.

**Fix (three steps, all required):**
1. **Patch `middleware.ts`** — explicit redirect instead of `auth.protect()`:
   ```ts
   const { userId } = await auth()
   if (!userId) {
     const signInUrl = new URL('/sign-in', request.url)
     signInUrl.searchParams.set('redirect_url', request.url.toString())
     return NextResponse.redirect(signInUrl)
   }
   ```
   or: `await auth.protect({ unauthenticatedUrl: '/sign-in' })`
2. **Add Vercel env vars** (confirmed missing): `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`. Without these, Clerk's `createRedirect()` produces an invalid URL and falls back to the rewrite.
3. **Purge Vercel edge cache** after deploy — use Vercel dashboard "Purge Cache" or full redeploy; the edge-cached 404 otherwise persists until TTL expires.

---

### P0 🎙️ — Voice box pod DOWN (day ~104) [PERSISTS]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **HTTP 404** (was `ok:true` in June 7 baseline).

The wiring in the repo is correct: `pet-concierge.tsx` has `data-backend="selfhosted"` and `data-connect-url="/boxapi"`, and `next.config.ts` proxies `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net`. The pod is simply off.

**Fix (local, needs RUNPOD_API_KEY):**
```bash
curl -X POST "https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
# After ~60s, verify:
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
```
Per policy.md auto-fix would restart the pod, but RUNPOD_API_KEY is not available in cloud. Pod billed at $0.69/hr even while stopped (storage charge) — still no idle-shutdown controller.

---

## ✅ Verified WORKING / Resolved

| Domain | Verdict | Evidence this run |
|---|---|---|
| **P1 dev-bypass-prod** | 🟢 RESOLVED ✅ | `GET /api/credits` with `Bearer dev-local-user` → 401 Unauthorized. Commits `d511723` + `e5fc9f5` disabled public dev-bypass in production. This P1 had persisted since the June 7 baseline. |
| **Worker infra** | 🟢 GREEN | `/health` → 200 `{"status":"ok"}`, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct gating). |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). |
| **Unit guards** | 🟢 GREEN | `test-sandpack-alias.ts` — **5/5 pass**; `test-sandpack-assets.ts` — **9/9 pass**. |
| **Frontend build** | 🟢 GREEN | `next build` (Turbopack) clean in 10.8s; **TypeScript: 0 errors** (9.7s). 6 routes static/SSR. |
| **Pet concierge wiring** | 🟢 GREEN | `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `next.config.ts: /boxapi → udcz4k7kse1zw6-7860.proxy.runpod.net` (exact match). Pod is off; wiring itself is correct. |
| **.dev.vars gitignore** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; `git ls-files` → empty (not tracked). |

---

## ⚠️ Cannot Verify From Cloud (flag for local testing)

| Check | Why blocked | What to run |
|---|---|---|
| **Build engine E2E** | Auth hardened (P1 fix) — no Clerk JWT in cloud | Sign in to hswebappbuilder.space, grab session token, then: `POST /api/projects`, `POST /api/build/<id>` (SSE 180s+), confirm `build_complete` with files, `DELETE /api/projects/<id>`. Latency was 180–200s last confirmed test. |
| **TAVILY web_search** | Requires model turn + auth | After confirming build works: run a chat turn with `/api/chat` forcing web_search. If "TAVILY_API_KEY is not configured" → `wrangler secret put TAVILY_API_KEY`. |

---

## 🩹 Hygiene backlog (P3)

- **middleware.ts → proxy.ts rename** pending (Next.js 16 deprecation warning emitted every build). `git mv middleware.ts proxy.ts`, update any imports, then redeploy. Required before any Next.js 17 upgrade.
- **40+ open audit report PRs** in GitHub — all never merged (expected policy), but they clog the PR list. Consider closing/archiving PRs older than 30 days.
- **Dependabot PR #47**: `fast-uri 3.1.2→3.1.4` in mcp-server (3 months old) — safe lockfile-only bump, MERGE.
- **Dependabot PR #28**: npm_and_yarn group across 3 dirs (4 months old) — review and merge safe bumps.
- **6 critical + many high GitHub security vulns** flagged in Oct 16 report — verify current count at https://github.com/mar2181/lovable-clone/security/dependabot; accept safe Dependabot PRs.
- **Pod billed 24/7** at $0.69/hr with 0 active sessions — no idle-shutdown/sleep controller.
- **`builder-buddy-rail` PR** (`claude/builder-buddy-rail`) still open — review for merge when ready.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch/PR | Age | What it is | Recommendation |
|---|---|---|---|
| `claude/builder-buddy-rail` | ~4+ months | Docked Space Mario assistant rail, re-pointed to live pod | **REVIEW FOR MERGE** when box is back up |
| `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` (PR #47) | 3 months | fast-uri 3.1.2→3.1.4 in mcp-server | **MERGE** (safe lockfile bump) |
| `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` (PR #28) | 4 months | npm_and_yarn group across 3 dirs | **REVIEW + MERGE safe bumps** |
| `audit/report-2026-*` (~40 branches) | 3 days – 4 months | Each run's report branch | **CLOSE/ARCHIVE** PRs older than 30 days to reduce noise |

---

## Δ vs previous (2026-10-16, Run #15)

| Item | Direction | Detail |
|---|---|---|
| **P1 dev-bypass-prod** | ✅ RESOLVED | `d511723` + `e5fc9f5` — confirmed 401 today. Was a P1 since June 7 baseline. |
| **P1 MCP_API_KEY hardcoded** | 🔴 PERSISTS | Day 6 since Oct 13 detection. Key still in `mcp-server/lovable.sh:6`. |
| **P0 Dashboard 404** | 🔴 PERSISTS | Day ~133 (+3 vs last run). Root cause and fix unchanged. |
| **P0 Voice box** | 🔴 PERSISTS | Day ~104 (+3 vs last run). Pod still off. |
| **Build engine E2E** | ⚠️ UNVERIFIABLE | Expected: auth locked down, can't test from cloud without Clerk JWT. |
| **Unit guards** | ✅ STABLE | Both pass (no regression). |
| **Frontend build** | ✅ STABLE | TypeScript 0 errors, clean build. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` absent | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` absent | `vercel ls` or Vercel dashboard — confirm HEAD `eb5ab74` deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY` absent | Not needed (worker is up) |
| **Telegram notification** | No Telegram token | `notify_mario()` / `POST /api/share/phone` |
| **Build engine E2E** | No Clerk JWT (auth hardened) | Sign in, grab session token, run E2E manually |
| **GitHub vuln count** | No GitHub security API in cloud | Check https://github.com/mar2181/lovable-clone/security/dependabot |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) + deep manual checks.
Probe JSON: `qa/audit/reports/latest-probe.json`.
