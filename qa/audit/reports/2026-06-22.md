# HS Web App Builder — Audit Report

**Date:** 2026-06-22T11:04Z · **Run:** #5 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 3 P0 outages active (build engine, dashboard, voice box). P1 security bypass persists unchanged. No P0s self-healed (cloud run — no vault creds).

> Probe: 5 GREEN · 9 YELLOW · 3 RED  |  Deep audit: 6 domains (4 parallel agents)  |  Auto-healed: none

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Build Engine DEAD (OpenRouter credits exhausted again) [PERSISTS since 2026-06-19]

The core product cannot build anything. Every call to `POST /api/build/<id>` fails immediately after `build_start` with:

```
{"type":"error","message":"This request requires more credits, or fewer max_tokens.
You requested up to 65536 tokens, but can only afford 403."}
```

**Evidence (live E2E this run):**
- POST /api/projects → 201, id `T8nKs1NGmN`
- POST /api/build/T8nKs1NGmN → SSE: `build_start` → `batch_start` → 3×`page_status(generating)` → **`error` event, stream terminated**
- 0 files produced. Build time: ~0 seconds.
- DELETE /api/projects/T8nKs1NGmN → 200 ✓ (cleanup succeeded)

**Fix:** Top up OpenRouter credits at https://openrouter.ai/settings/credits for the key set via `wrangler secret put OPENROUTER_API_KEY`. This is the THIRD time credits have run out in this billing period (June 01, June 19, June 22). Consider setting an auto-refill threshold in OpenRouter account settings to prevent repeat outages.

---

### P0 — Dashboard `/dashboard` → 404 [PERSISTS since 2026-06-19]

`GET https://hswebappbuilder.space/dashboard` returns HTTP 404. The page code exists (`app/dashboard/page.tsx`) and the local build compiles cleanly (6 routes, 0 TS errors). The 404 is Vercel-served and CDN-cached (age: ~72 hours, `etag: "305ccd30..."`).

**Root cause (confirmed):** `middleware.ts` calls `auth.protect()` with no `redirectUrl`. Clerk cannot find `NEXT_PUBLIC_CLERK_SIGN_IN_URL` in the Vercel environment and falls through to a `protect-rewrite → /404`. Response headers confirm: `x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing`.

Note: The `middleware.ts` filename is also deprecated in Next.js 16 (should be `proxy.ts`) — the build emits a deprecation warning — this may be causing the file to not execute correctly on Vercel.

**Fix options (pick one, then purge CDN):**

**Option A — Environment variable (fastest):** In the Vercel dashboard, add `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` as an environment variable, then trigger a redeploy.

**Option B — Code fix (preferred):** Edit `middleware.ts` line 17–19:
```ts
// BEFORE:
await auth.protect()

// AFTER:
await auth.protect({ redirectUrl: '/sign-in' })
```
Then rename `middleware.ts` → `proxy.ts` (Next.js 16 convention), `git push`, redeploy.

**After deploying either fix:** Run `vercel cache purge /dashboard` or wait for Vercel cache to expire (should be immediate on redeploy since `cache-control: must-revalidate`).

---

### P0 — Voice Box `/healthz` → 404 [NEW — was GREEN on 2026-06-07, not checked on 2026-06-19]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` returns HTTP 404 (Cloudflare, `cf-cache-status: BYPASS`). All box endpoints return 404 — the RunPod pod appears stopped/exited or the agent process is dead.

`/boxapi/healthz` proxy path (via `https://hswebappbuilder.space/boxapi/healthz`) also 404s.

**Auto-fix eligible per policy.md** (`concierge/pod-power = RED → POST pods/<id>/start`) but **cannot execute in cloud** — `RUNPOD_API_KEY` not in cloud env.

**Fix (requires local access):**
1. Check pod status: `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6`
2. If STOPPED: `curl -X POST -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start`
3. If RUNNING but box unreachable: `POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/dashboard/agent/restart`
4. Verify: `/healthz` → `ok:true`

Pet Concierge wiring and next.config.ts proxy target are correct in code — this is a pod/agent runtime issue only.

---

### P1 — dev-bypass-prod: Anyone can impersonate owner in production [PERSISTS — run #2–#5]

**Live confirmation this run:**
```
GET /api/credits  Authorization: Bearer dev-local-user
→ {"tier":"unlimited","balance":9999}  HTTP 200
```

`wrangler.toml [vars]` deploys both `ENVIRONMENT = "development"` AND `DEV_BYPASS_AUTH = "1"` to the live Worker. Either flag alone enables the bypass in `auth.ts` lines 62–66. Anyone who knows the string `dev-local-user` has full owner-level access.

**Fix (CONFIRM-FIRST per policy.md):**
1. Verify your projects are visible at hswebappbuilder.space under your real Clerk account.
2. Edit `worker/wrangler.toml` — remove lines 16–17 from `[vars]`:
   ```toml
   # DELETE these two lines:
   ENVIRONMENT = "development"
   DEV_BYPASS_AUTH = "1"
   ```
3. `cd worker && wrangler deploy`
4. Verify: `GET /api/credits` with `Bearer dev-local-user` → 401.

This has been flagged in every run since June 07 (4 consecutive audits). The fix is safe; it just needs your ownership verification first.

---

### P3 — `middleware.ts` deprecation → Next.js 16 `proxy.ts` rename [PERSISTS]

Build emits `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` every compile. This is also the suspected cause of the `/dashboard` 404 (middleware may not execute correctly under the deprecated convention in Vercel's Next.js 16 runtime). Fix: `git mv middleware.ts proxy.ts`, update any imports, test locally, push.

---

### P3 — `template-picker.tsx:80` hoisting bug [PERSISTS]

ESLint: `Cannot access variable before it is declared` — `fetchTemplates` is called inside `useEffect` at line 80 before it is declared at line 84. Risk: stale closure captures. Move `fetchTemplates` declaration above its calling `useEffect`.

---

### P2 — 38 Dependabot vulnerabilities on master (5 HIGH, 28 moderate, 5 low) [ESCALATED]

At push time, GitHub flagged **38 vulnerabilities on the default branch** — up from 10 moderate at last report (2026-06-07). 5 are now rated HIGH severity.

**Fix:** Review the Dependabot security tab at `https://github.com/mar2181/lovable-clone/security/dependabot`. Merge PR #28 (hono + esbuild bump, already open) as a first step; that likely resolves some. For remaining advisories, accept safe lock-file-only Dependabot PRs or apply manual patches.

---

### P3 — ESLint: +2 new problems (236 vs baseline 234)

Total: 236 problems, 156 errors, 80 warnings, 2 auto-fixable. The 2 new problems are the `template-picker.tsx:80` error and one additional warning. The 80 warnings match baseline exactly.

---

## 🔧 Auto-healed this run

**None.** All three P0s require either cloud creds (box: RunPod key) or human judgment (build: credit top-up; dashboard: Vercel env var or code change). No safe operational self-heal was available.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence this run |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct). Project CRUD: list 13 projects, create, delete all functional. |
| **GitHub Import** | 🟢 GREEN | Unit guards **2/2 PASS** (5/5 alias · 9/9 asset). Live import `dan5py/react-vite-shadcn-ui` → **201, 22 files, 1 skipped, 0 failed**. DELETE → 200. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build** | 🟢 GREEN | `next build` clean in 10.4s, TypeScript 0 errors in 8.2s. 6 routes (/, /dashboard, /editor/[id], /sign-in, /sign-up, /test-preview). |
| **Pet concierge wiring** | 🟢 GREEN | `pet-concierge.tsx` lines 99–100: `data-backend="selfhosted"`, `data-connect-url="/boxapi"`. `next.config.ts` `/boxapi` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net` (exact match). Wiring correct — pod runtime is the issue. |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore` lines 52–53: two rules cover `worker/.dev.vars`. Not tracked in git. |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts`: exact-match origin allowlist, no `*`. `credentials:true` correct. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **OpenRouter auto-refill:** Credits have run out 3× since June. Set a minimum balance alert or auto-refill in the OpenRouter dashboard to prevent repeat P0s.
- **Pod billed 24/7** — RunPod pod `udcz4k7kse1zw6` is now down but was previously billed `$0.69/hr` with 0 active sessions. Implement idle-shutdown + broker-wake for cost control.
- **Telegram/SMS still dark** — `/api/share/health` → `telegram:false, sms:false`. Sharing feature still unimplemented.
- **130+ `@typescript-eslint/no-explicit-any`** in worker + components — tech debt accumulation.
- **`GET /api/projects/<deleted-id>` → 200 + JSON error** — should be 404.
- **deploy/drift** — not verified (no Vercel token in cloud). Check Vercel dashboard for HEAD `50a7531` deployment status.
- **pod-power** — not verified (no RunPod key). Run locally: `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6`
- **Voice box: no auto-fallback** if box dies — ElevenLabs was quota-dead as of June 07; no HA solution in place.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch/PR | Age | What it is | Recommendation | Reason |
|---|---|---|---|---|
| **PR #28** `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | 2 days | Bumps `hono` 4.12.23→4.12.26 (3 directories) + `esbuild` bump in /mcp-server and /worker. 360 add / 335 del (lock-file patch). | **MERGE** | Safe lock-file patch across all 3 dirs. Hono 4.12.26 is a bug-fix release. Merge via GitHub UI. |
| **PR #20** `claude/builder-buddy-rail` | 18 days | Docked Space Mario rail UI (+4,253 / -106, 5 files). `mergeable_state: dirty` (conflicts with master). | **REBASE THEN REVIEW** | Feature is well-tested (Playwright, live session) but now conflicts with master changes. Needs `git rebase master` + conflict resolution before it can be reviewed/merged. |
| **PR #27** `audit/report-2026-06-19` (draft) | 3 days | Previous audit report — RED run. | **CLOSE/ARCHIVE** | Superseded by this report. |
| **`audit/report-2026-06-10`** | 12 days | Audit report branch | **DELETE** | Superseded. `git push origin --delete audit/report-2026-06-10` |
| **`audit/report-2026-06-13`** | 9 days | Audit report branch | **DELETE** | Superseded. `git push origin --delete audit/report-2026-06-13` |
| **`audit/report-2026-06-19`** | 3 days | Audit report branch (PR #27 attached) | **DELETE after closing PR #27** | Superseded by this run. |

**Open issues:** 0. **Dependabot PRs:** 1 (PR #28, ready to merge).

**Branches resolved since last report (2026-06-07):**
- `archive/windows-side-2026-05-11` — DELETED ✓ (was: archive recommendation)
- `backup/pr13-pre-resolve-2026-05-12` — DELETED ✓ (was: archive recommendation)
- `fix/sanitizer-icon-imports` — DELETED ✓ (was: rebase then review)

---

## Δ vs previous reports

### vs `latest.md` (2026-06-07, Run #2)

| Item | Direction | Detail |
|---|---|---|
| Build engine (OpenRouter credits) | 🔴 REGRESSED | Was RESTORED on 2026-06-07. Depleted again by 2026-06-19. Still P0 |
| Dashboard `/dashboard` | 🔴 REGRESSED | Was GREEN 200 on 2026-06-07. Now 404 (Clerk protect-rewrite, since 2026-06-19) |
| Voice box `/healthz` | 🔴 NEW P0 | Was GREEN ok:true on 2026-06-07. Now 404 — pod/agent down |
| P1 dev-bypass-prod | 🔴 PERSISTS | 4th consecutive audit. `ENVIRONMENT="development"` still in wrangler.toml |
| GitHub Import | ✅ STILL GREEN | 2/2 unit guards, 22-file live import |
| Frontend build (tsc) | ✅ STILL GREEN | 0 TypeScript errors |
| .dev.vars gitignore | ✅ STILL GREEN | Not tracked, 2 gitignore rules |
| middleware.ts → proxy.ts | ⚠️ STILL OUTSTANDING | Deprecation warning persists; now linked to dashboard 404 |
| template-picker.tsx:80 | ⚠️ STILL OUTSTANDING | fetchTemplates hoisting bug persists |

### vs audit/report-2026-06-19 (Run #4)

| Item | Direction | Detail |
|---|---|---|
| Build engine | 🔴 STILL P0 | OpenRouter credits still exhausted (403 tokens remaining) |
| Dashboard 404 | 🔴 STILL P0 | Clerk protect-rewrite still firing in prod |
| Voice box | 🆕 NOW P0 | Was not flagged in June 19 run — newly down |
| P1 dev-bypass | 🔴 STILL P1 | Unchanged |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Box `POST /api/connect` session** | RunPod broker token in `.dev.vars` | Test HMAC-gated broker: POST /api/connect → expect Daily `connectUrl` + token |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` or Vercel dashboard — confirm HEAD `50a7531` is deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | `selfheal.mjs` — not needed this run (worker is operationally up) |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — send local |
| **Box agent restart** | `RUNPOD_API_KEY` not available | Cannot execute auto-fix for box P0 — flag only |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 4 parallel domain agents (build E2E, frontend, import, security) + orchestrator direct checks (box, GitHub).
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (3 RED · 9 YELLOW · 5 GREEN).
