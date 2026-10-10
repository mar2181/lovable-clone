# HS Web App Builder — Audit Report

**Date:** 2026-10-10T11:12Z · **Run:** scheduled, 3-day cadence · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — Voice box P0 (pod unreachable); new P1 critical CVEs in Next.js. P1 dev-bypass security fix CONFIRMED RESOLVED (major win).

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 4 domains  |  Auto-healed: none (cloud — no RunPod key)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Voice Box DOWN

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **404** on all three probes (`/healthz`, `/`, `/dashboard/tools`).

- **Impact:** Pet Concierge voice widget broken for all site users. Every `/boxapi/*` request proxied from the Next.js app returns 404.
- **Wiring is intact:** `components/pet-concierge.tsx` has `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, and `agent_id` all present. `next.config.ts /boxapi` destination exactly matches the pod URL. The problem is the pod itself, not the code.
- **Root cause:** Pod likely stopped/crashed since the 2026-06-07 report. Cannot auto-fix in cloud (no `RUNPOD_API_KEY`).

**Fix (RunPod restart — local only):**
```bash
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start -X POST
# Then verify:
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
# Expect: {"ok":true,"tools":{"count":18},"tts":{"voices":["will","jack"]}}
```
If the pod no longer shows up in `runpod list`, the instance may have been reclaimed — you'll need to reprovision it and update `next.config.ts` with the new proxy URL.

---

### P1 — Next.js 16.2.6: 2 Critical + 17 High CVEs [NEW]

`npm audit` reports **28 vulnerabilities** in the installed `next@16.2.6`:

| Count | Severity | Notable findings |
|---|---|---|
| 2 | **Critical** | Unauthenticated RCE in Image Optimization API (AVIF), RCE in `next/og` ImageResponse |
| 17 | **High** | Middleware/proxy auth bypass (App Router + Turbopack + single locale), SSRF via Server Actions and rewrites, cache poisoning/confusion (SSG/ISR), unauthenticated disclosure of internal Server Function endpoints, DoS via Server Actions, RCE on Windows-hosted servers |
| 9 | Moderate | `proxy-addr` IP spoofing via IPv4-mapped IPv6 |

**Fix (non-breaking — same major version):**
```bash
cd /home/user/lovable-clone
npm install next@16.4.0
npm run build          # confirm still green
git add package.json package-lock.json
git commit -m "fix: upgrade next to 16.4.0 (critical CVE fixes)"
# Then redeploy to Vercel
```
Fix is a non-breaking semver minor bump (`16.2.6 → 16.4.0`). The build is confirmed clean at 16.2.6, so this should be safe.

---

### P1 ✅ RESOLVED — Dev-bypass-prod security fix CONFIRMED [was P1 persisting]

**Previous status:** `ENVIRONMENT=development` + `DEV_BYPASS_AUTH=1` deployed in `[vars]` — anyone with the public hardcoded token could access owner-level routes.

**Current status:** `worker/wrangler.toml` now has `ENVIRONMENT = "production"` (line 22). Comment at lines 16–21 confirms the 2026-08-09 security fix. `GET /api/credits` with `Bearer dev-local-user` → **401** (confirmed by probe and deep audit).

**Auth code note (P3 follow-up):** The `devBypassEnabled` block in `auth.ts` lines 65–93 is now inert (`ENVIRONMENT=production` → `devBypassEnabled=false`) but the code still exists. Full removal is gated on the dev UI moving to Clerk sign-in. Low risk given it can't fire, but the dead code should be cleaned up when that migration happens.

---

### P2 — Build Engine E2E + GitHub Import: UNVERIFIABLE FROM CLOUD [NEW]

The 2026-08-09 security fix removed `Bearer dev-local-user` from production. The cloud audit used this token for E2E testing. Both the build engine and GitHub import live tests now return 401.

**Impact on audit:** These two most-important checks cannot be run in the scheduled cloud audit until the auth method is updated.

**Fix — add `MCP_API_KEY` to cloud audit environment:**
The worker's `auth.ts` (lines 44–55) has a trusted internal path: `X-API-Key: <MCP_API_KEY>` with optional `X-User-Id`. This key is already a worker secret (`wrangler secret put MCP_API_KEY`). To restore cloud audit coverage:
1. Add `MCP_API_KEY=<value>` to the cloud audit's environment secrets (the scheduled agent's vault).
2. Update `qa/audit/audit-probe.mjs` and deep audit scripts to use `X-API-Key: $MCP_API_KEY` header instead of `Authorization: Bearer dev-local-user`.

Until then, the build engine and import tests **must be run manually with local creds**.

---

### P3 — /dashboard probe false-alarm [NEW — probe bug]

The probe reports `/dashboard → 404` (RED). Investigation shows this is **correct auth behavior**:
- Bot/curl requests → 404 (Clerk's `protect-rewrite` for non-browser agents — security feature)
- Browser requests → 307 → `https://accounts.hswebappbuilder.space/sign-in?redirect_url=...` ✅

**Fix (probe):** Update `audit-probe.mjs`'s dashboard check to send browser headers:
```
Accept: text/html
User-Agent: Mozilla/5.0 ...
```
Then assert `status === 307 && location.includes('/sign-in')` instead of `status === 200`.

---

### P3 — 37 audit/report-* branches accumulating on origin [NEW]

`git ls-remote --heads origin` shows 41 remote branches, 37 of which are `audit/report-YYYY-MM-DD` branches never cleaned up after the run. This clutter makes real branches harder to find.

**Fix:** Delete merged audit branches. Example batch delete via gh CLI:
```bash
git branch -r | grep 'audit/report' | sed 's|origin/||' | \
  xargs -I{} git push origin --delete {}
```
Or set up a GitHub Actions workflow to auto-delete merged `audit/*` branches.

---

### P3 — 2 stale Dependabot security PRs [PERSISTS]

| PR | Title | Age | Recommendation |
|---|---|---|---|
| #28 | bump npm_and_yarn group across 3 dirs (2 updates) | **112 days** | Review + merge (or close if superseded by next@16.4.0 upgrade above) |
| #47 | bump fast-uri in /mcp-server | **81 days** | Review + merge |

---

### P3 — `middleware.ts` → `proxy.ts` rename [PERSISTS]

`npm run build` warns: `"The 'middleware' file convention is deprecated. Please use 'proxy' instead."` This fires on every build.

**Fix:** `git mv middleware.ts proxy.ts` + update any imports, then Vercel redeploy.

---

## 🔧 Auto-healed this run
**None.** Box restart requires `RUNPOD_API_KEY` (absent in cloud). P1 CVEs require a `git commit` (per policy — flag only). No operationally-fixable RED without creds.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Security: dev-bypass-prod** | 🟢 RESOLVED | `GET /api/credits` with `Bearer dev-local-user` → 401. `wrangler.toml` confirmed `ENVIRONMENT=production` (2026-08-09 fix). |
| **Worker HTTP** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (gated). |
| **Frontend HTTP** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. `/dashboard` → 307 → sign-in for browser users (correct auth behavior). |
| **Frontend build** | 🟢 GREEN | `next build` (Next.js 16.2.6 Turbopack) succeeds in 10.7s; **TypeScript: 0 errors** (9.3s). 6 routes generated. |
| **Box wiring** | 🟢 CORRECT (code) | `pet-concierge.tsx`: `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `agent_id` present. `next.config.ts /boxapi` → pod URL (exact match). Wiring is correct; pod is the problem. |
| **Sandpack unit guards** | 🟢 PASS | `test-sandpack-alias.ts`: 5/5 checks pass. `test-sandpack-assets.ts`: 9/9 checks pass. |
| **Security: .dev.vars** | 🟢 SAFE | `.gitignore:53` covers `worker/.dev.vars`; `git ls-files` confirms not tracked. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **ESLint: 236 problems (157 errors, 79 warnings)** — majority `@typescript-eslint/no-explicit-any` across worker routes and components. 2 auto-fixable. No type safety at API boundaries.
- **Pod billed 24/7** (no idle-watcher) — estimated ~$500/mo at $0.69/hr with `active_sessions:0`. Needs idle-shutdown controller.
- **Dead dev-bypass code in `auth.ts:65–93`** — inert (can't fire with `ENVIRONMENT=production`) but cleanup gated on dev UI Clerk migration.
- **`GET /api/projects/<deleted-id>` returns HTTP 200 with `{"error":"Project not found"}`** — should be 404.
- **Telegram/SMS not configured** — `/api/share/health` shows `telegram:undefined, sms:undefined`. In-app project sharing over phone is dark.
- **Build E2E latency** — prior report noted 180–200s for 4-page builds; timeouts remain a risk for larger prompts (still unverifiable from cloud without MCP_API_KEY).
- **Next.js workspace warning** — stray `/home/mario/package-lock.json` confuses Turbopack workspace root detection.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

41 remote branches total (37 are stale audit branches — see P3 above).

| Branch | Age | Recommendation | Notes |
|---|---|---|---|
| **`claude/builder-buddy-rail`** | ~4 months | **REVIEW** (stale — reassess) | Was "BRING IN FOR REVIEW" in June. Now 4 months old with no action. Check if still relevant or superseded. |
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** | unknown | **MERGE or CLOSE** | PR #28, 112 days old |
| **`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`** | unknown | **MERGE or CLOSE** | PR #47, 81 days old |
| **`audit/report-2026-06-10` through `audit/report-2026-10-07`** | various | **DELETE (37 branches)** | Automated audit branches; reports are in the commit history. None contain code — safe to mass-delete. |

---

## Δ vs 2026-06-07 (last report in latest.md)

| Item | Direction | Detail |
|---|---|---|
| **P1 dev-bypass-prod** | ✅ RESOLVED | `ENVIRONMENT=production` in wrangler.toml; `Bearer dev-local-user` → 401 in prod. Major security win. |
| **P0 voice box** | 🔴 REGRESSED | Was UP (18 tools, voices [will,jack], 0 sessions). Now all probes → 404. Pod likely stopped/reclaimed. |
| **P1 Next.js CVEs** | 🆕 NEW | 16.2.6 ships with 2 critical + 17 high CVEs discovered since June. Fix: `next@16.4.0`. |
| **Build engine E2E** | ⚠️ AUTH CHANGE | Was GREEN in June (dev-bypass worked). Now BLOCKED (dev-bypass removed from prod — security fix side-effect). Cloud audit needs MCP_API_KEY. |
| **GitHub import live** | ⚠️ AUTH CHANGE | Same: needs MCP_API_KEY or Clerk JWT. Sandpack guards still PASS. |
| **Probe dashboard 404** | ℹ️ FALSE ALARM | Was 200 (DEV_BYPASS active). Now 404 (correct Clerk auth + probe bug). Browser gets 307 → sign-in. |
| **middleware→proxy rename** | ⚠️ PERSISTS | Still unresolved from June. |
| **Dependabot PRs** | ⚠️ AGING | 2 open, 81 and 112 days old; not yet merged. |
| **37 audit branches** | 🆕 ACCUMULATING | Every run adds a branch; none cleaned up since June. |
| **latest.md not updated** | ℹ️ NOTE | `latest.md` in the working tree still shows the June report. Intermediate audits (37 runs) committed to their own branches but latest.md on master was never updated. This run fixes that. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **Build engine E2E** | `MCP_API_KEY` not in cloud env (now required; `Bearer dev-local-user` rejected) | `curl -H "X-API-Key: $MCP_API_KEY" -H "Content-Type: application/json" -d '{"name":"test"}' https://lovable-clone-backend.hssolutions2181.workers.dev/api/projects` then the build SSE flow |
| **GitHub import live** | Same + `ownerOnly` gate | Same header; `POST /api/github/import {"repoUrl":"..."}` |
| **RunPod pod-power** | `RUNPOD_API_KEY` absent | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` absent | `vercel ls` / Vercel dashboard — confirm current HEAD deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email absent | Not needed this run — worker is up |
| **Telegram notification** | No Telegram token in cloud | `POST /api/share/phone` or `notify_mario()` from local |
| **Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | HMAC-gated broker test: `POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/api/connect` from local with broker token |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 4 parallel domain agents (build engine, frontend/security, GitHub import, box/wiring/branches) → synthesis.
Note: `audit-probe.mjs` reports `ROOT=/home/mario/lovable-clone` which doesn't exist in cloud; wiring/proxy-target checks degraded to YELLOW. All HTTP checks ran against live prod URLs.
