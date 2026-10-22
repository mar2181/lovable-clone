# HS Web App Builder — Audit Report

**Date:** 2026-10-22T11:20Z · **Run:** #17 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky  
**Overall: 🔴 RED** — P1 committed MCP key persists (day 9 unresolved). 2 P0 outages continue (dashboard day ~136, voice box day ~107). One prior P1 (dev-bypass-prod) remains RESOLVED.

> Probe: 6 GREEN · 9 YELLOW · 2 RED | Deep audit: completed | Auto-healed: none (cloud run; RUNPOD_API_KEY unavailable)

---

## 🚩 Needs Mario (ranked P1 → P0 → P0)

### P1 🔑 — MCP_API_KEY hardcoded in `mcp-server/lovable.sh` [PERSISTS — day 9, unresolved since Oct 13]

**Confirmed live today.** `mcp-server/lovable.sh` line 6:
```bash
API_KEY="${MCP_API_KEY:-<REDACTED — see mcp-server/lovable.sh line 6>}"
```
This key matches the `MCP_API_KEY` auth path in `worker/src/middleware/auth.ts` (line ~41) — grants `isOwner: true`, full operator privileges: arbitrary Supabase Management SQL, GitHub PAT pushes, Vercel prod deploys, Twilio SMS. **The repo is public. Anyone can extract this key from git history and impersonate the owner in production.**

Key has been live in the public repo since commit `5ec5e08` ("feat(dashboard): add Duplicate/Clone project action") — visible since Oct 13 per previous audit. Now 9 days exposed.

**Fix (ROTATE IMMEDIATELY — confirm-first per policy.md):**
1. Generate a new random 64-char hex key — **do NOT reuse** the committed value.
2. `cd worker && wrangler secret put MCP_API_KEY` (new value).
3. Patch `mcp-server/lovable.sh` line 6: replace the hardcoded fallback with `${MCP_API_KEY:?MCP_API_KEY is required}` — fail loudly if unset, never fall through to a default.
4. Rotate any credentials the key could have been used to extract (Supabase PAT, GitHub PAT, Vercel token) — the repo is public and key has been live 9 days.
5. Purge from git history: `git filter-repo --path mcp-server/lovable.sh --invert-paths` (add cleaned version back), or BFG Repo Cleaner. Force-push to purge remote history, then notify any forks.

---

### P0 🌐 — Dashboard `/dashboard` returns cached 404 (day ~136) [PERSISTS]

`/dashboard` → HTTP 404. Vercel response headers confirm:
```
HTTP/2 404
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-matched-path: /404
x-vercel-cache: HIT   (age: 517801s ≈ 6 days of edge-cached stale 404)
```

**Root cause (established Run #14):** Clerk's `auth.protect()` in `middleware.ts` does a `protect-rewrite` to /404 for unauthenticated requests because `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is not set in Vercel env vars — Clerk's `createRedirect()` produces an invalid URL and rewrites to /404 instead of redirecting to /sign-in. Vercel's edge CDN then caches that 404 indefinitely.

The app route (`app/dashboard/page.tsx`) and `/sign-in` both exist and build correctly (verified today). This is purely a middleware/env-var/cache bug.

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
   OR pass the unauthenticated URL: `await auth.protect({ unauthenticatedUrl: new URL('/sign-in', request.url).toString() })`
2. **Add Vercel env vars** (confirmed missing — `grep` found no `NEXT_PUBLIC_CLERK_SIGN_IN_URL` in the repo):
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
3. **Purge Vercel edge cache** after deploy — use Vercel dashboard "Purge Cache" or full redeploy. The edge-cached 404 will otherwise persist until TTL expires.

---

### P0 🎙️ — Voice box pod DOWN (day ~107) [PERSISTS]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **HTTP 404** (pod stopped or proxy expired).

Repo wiring verified correct today: `pet-concierge.tsx` has `data-backend="selfhosted"` and `data-connect-url="/boxapi"` (lines 99-100), and `next.config.ts` proxies `/boxapi/* → https://udcz4k7kse1zw6-7860.proxy.runpod.net/*` (lines 12-13). The pod is simply off.

**Fix (local, needs RUNPOD_API_KEY — cloud can't auto-fix):**
```bash
curl -X POST "https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
# Wait ~60s, then verify:
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
```
Per policy.md this is auto-fixable, but `RUNPOD_API_KEY` is unavailable in the cloud run.
Storage charges continue at ~$0.69/hr even while stopped. No idle-shutdown controller exists.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence this run |
|---|---|---|
| **P1 dev-bypass-prod** | 🟢 RESOLVED (was P1) | `GET /api/credits` with `Bearer dev-local-user` → 401. wrangler.toml `[vars]` now has `ENVIRONMENT = "production"` only. Commits `d511723` + `e5fc9f5` confirmed merged to master. |
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct gating). |
| **GitHub import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). |
| **Frontend root** | 🟢 GREEN | `GET https://hswebappbuilder.space/` → 200. |
| **Sandpack unit tests** | 🟢 GREEN | `test-sandpack-alias.ts` — **5/5 pass**; `test-sandpack-assets.ts` — **9/9 pass**. |
| **Frontend TypeScript build** | 🟢 GREEN | `next build` (Turbopack 16.2.6) — compiled in 9.2s; **TypeScript: 0 errors** (7.5s). 6 routes (4 static, 2 dynamic). |
| **Pet concierge wiring** | 🟢 GREEN | `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `next.config.ts:12-13` proxies `/boxapi → udcz4k7kse1zw6-7860.proxy.runpod.net`. Wiring intact; pod is off. |
| **.dev.vars gitignored** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; not tracked. Probe YELLOW was wrong — confirmed correct. |

---

## ⚠️ Cannot Verify From Cloud (flag for local testing)

| Check | Why blocked | What to run locally |
|---|---|---|
| **Build engine E2E** | Auth hardened (dev-bypass off) — no Clerk JWT in cloud | Sign in to hswebappbuilder.space, grab session token, then: `POST /api/projects`, `POST /api/build/<id>` (SSE, allow 180s+), confirm `build_complete` with files, `DELETE /api/projects/<id>`. Last confirmed working: Oct 19 run. |
| **TAVILY web_search** | Requires model turn + Clerk auth | After confirming build works: run a chat turn forcing web_search. If "TAVILY_API_KEY is not configured" → `cd worker && wrangler secret put TAVILY_API_KEY`. |
| **RunPod pod power state** | `RUNPOD_API_KEY` not set in cloud | `curl https://rest.runpod.io/v1/pods/udcz4k7kse1zw6 -H "Authorization: Bearer $RUNPOD_API_KEY"` |
| **Vercel deploy drift** | `VERCEL_TOKEN` not set in cloud | Check https://vercel.com/mar2181's dashboard — latest commit on Vercel vs master head (`eb5ab74`). |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY` not set | N/A — worker is currently healthy |
| **Telegram delivery** | Bot token not set in cloud | N/A — GitHub issue + email sent instead |

---

## 🩹 Hygiene backlog (P3)

- **ESLint: 157 errors** (`no-explicit-any` throughout `worker/src/` — `build-orchestrator.ts:66`, `image-gen.ts:81`, `video-gen.ts:139/177/217`, `attachments.ts`, `templates/builder.ts`, `templates/pages.ts`); 79 warnings. Does not block build but masks type safety issues. Fix: add explicit types or use `unknown` + type guards.
- **`middleware.ts` → `proxy.ts` rename** (Next.js 16 deprecation warning on every build). `git mv middleware.ts proxy.ts`, update any imports, redeploy. Required before any Next.js 17 upgrade.
- **40+ open audit report PRs** clog the PR list — none ever merged (expected, per policy). Consider bulk-closing PRs older than 30 days via GitHub API.
- **Dependabot PR #47** (`fast-uri 3.1.2→3.1.4` in mcp-server, 3 months old) — safe lockfile-only bump. **MERGE.**
- **Dependabot branch** `npm_and_yarn-5984bbb696` (PR #28, 4 months old) — npm_and_yarn group across 3 dirs. **Review + merge safe bumps.**
- **Pod billed 24/7** at ~$0.69/hr (storage) even while stopped. No idle-shutdown/sleep controller exists. Over 107 days this is ~$1,750 in storage charges while the pod delivers no value.

---

## 🗂 GitHub Reconciliation (surface only — NEVER merged by this audit)

| Branch / PR | Age | What it is | Recommendation |
|---|---|---|---|
| `claude/builder-buddy-rail` | ~4+ months | Docked Space Mario assistant rail, re-pointed to live pod | **REVIEW FOR MERGE** when voice box is back up |
| `dependabot/…/mcp-server/npm_and_yarn-04db377a11` (PR #47) | 3 months | `fast-uri 3.1.2→3.1.4` in mcp-server | **MERGE** — safe lockfile bump, no API changes |
| `dependabot/…/npm_and_yarn-5984bbb696` (PR #28) | 4 months | npm_and_yarn group across 3 dirs | **REVIEW + MERGE safe bumps** |
| `audit/report-2026-*` (~40 branches + ~30 draft PRs) | 3 days–4 months | Each scheduled run's report | **CLOSE/ARCHIVE** PRs older than 30 days — use `gh pr list --state open --author app/claude --limit 100 \| awk '{print $1}' \| xargs -I{} gh pr close {}` to bulk-close |

---

## Δ vs previous (2026-10-19, Run #16)

| Finding | Oct 19 | Oct 22 | Change |
|---|---|---|---|
| P1 MCP_API_KEY committed | 🔴 Day 6 | 🔴 Day 9 | **PERSISTS — unresolved 3 more days** |
| P0 dashboard 404 | 🔴 Day ~133 | 🔴 Day ~136 | PERSISTS |
| P0 voice box down | 🔴 Day ~104 | 🔴 Day ~107 | PERSISTS |
| P1 dev-bypass-prod | ✅ RESOLVED | ✅ RESOLVED | Stable, no regression |
| Worker health | ✅ GREEN | ✅ GREEN | No change |
| Sandpack unit tests | ✅ 14/14 pass | ✅ 14/14 pass | No change |
| Frontend TypeScript build | ✅ 0 errors | ✅ 0 errors | No change |
| `.dev.vars` gitignore | ✅ GREEN | ✅ GREEN | Probe YELLOW clarified: confirmed correct |

**Nothing new surfaced; nothing resolved.** The P1 key is on day 9 with no action taken — urgency is increasing.

---

## ⏭️ Skipped Checks (cloud creds absent — cover in local on-demand run)

| Check | Missing cred | Impact |
|---|---|---|
| RunPod pod power state | `RUNPOD_API_KEY` | Can't auto-restart voice box |
| Vercel deploy drift | `VERCEL_TOKEN` | Can't confirm latest master is deployed |
| Worker self-heal redeploy | `CLOUDFLARE_API_KEY` | N/A (worker healthy) |
| Telegram summary | Bot token | GitHub issue + email used instead |
| Build engine E2E | Clerk JWT (auth hardened) | Last confirmed OK Oct 19 |
| TAVILY web_search live test | Clerk JWT | Unconfirmed for weeks |
