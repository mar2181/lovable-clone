# HS Web App Builder — Audit Report

**Date:** 2026-06-07T11:04Z · **Run:** #2 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🟡 YELLOW** — infrastructure healthy and build engine RESTORED. P1 security bypass persists; fix confirmed safe but requires Mario's ownership-check before deploy.

> Probe: 7 GREEN · 9 YELLOW · 1 RED  |  Deep audit: 6 domains  |  Auto-healed: none

---

## 🚩 Needs Mario (ranked P0 → P3)

### P1 — Anyone can be owner in prod (`Bearer dev-local-user`) [PERSISTS]

`wrangler.toml [vars]` ships **`ENVIRONMENT = "development"`** (line 16) and **`DEV_BYPASS_AUTH = "1"`** (line 17) into the live Cloudflare Worker. Live confirmation: `GET /api/credits` → `{"tier":"unlimited","balance":9999}` with no Clerk JWT.

Auth gate in `worker/src/middleware/auth.ts` lines 62–74:
```ts
const devBypassEnabled =
  c.env.ENVIRONMENT === "development" || c.env.DEV_BYPASS_AUTH === "1";
if (devBypassEnabled && authHeader === "Bearer dev-local-user") {
  // → registerOwnerIfAdmin + unlimited credits — owner-level access
}
```
Because `DEV_BYPASS_AUTH="1"` is deployed in `[vars]`, `devBypassEnabled` is always `true` in production.

**Fix (CONFIRM-FIRST — not auto-applied per policy.md):**
1. **Verify ownership first:** log into hswebappbuilder.space with real Clerk credentials and confirm your projects still show.
2. Edit `worker/wrangler.toml` — remove lines 16–17 from `[vars]`:
   ```toml
   # DELETE these two lines:
   ENVIRONMENT = "development"
   DEV_BYPASS_AUTH = "1"
   ```
3. These values belong only in `worker/.dev.vars` (which IS already gitignored — confirmed safe).
4. `cd worker && wrangler deploy`
5. Verify `/api/credits` with `Bearer dev-local-user` now returns 401.

---

### ✅ Build Engine: RESTORED (was P0 in baseline)

**SSE E2E confirmed live:**
- POST /api/projects → 201, id `sDUOcNFuyb`
- POST /api/build with SSE → `build_start` (4 pages, 2 batches) → `page_status`×4 → `batch_stream` chunks → **`build_complete` — 22 files**
- Files: `App.tsx`, `index.tsx`, `styles.css`, 4 page components, Header/Footer, 10 UI components, `utils/constants`, `__lovable_select_runtime.ts`
- **Zero `type:"error"` events. Zero "Insufficient credits" messages.** OpenRouter credits are replenished.
- DELETE → 200 `{"success":true}` ✅

**P2 — Build latency approaching timeout (new concern):** The 4-page build took 180–200 seconds, racing the default 180s curl timeout. A first attempt timed out; a second run with 200s completed. Larger prompts risk hard timeout. Consider increasing the SSE client timeout to 240s or adding a server-side stream keepalive ping.

---

### P1/P2 — GitHub: 10 Dependabot moderate advisories on master [NEW — discovered at push]

During the `git push` of this audit branch, GitHub reported:
> "GitHub found 10 vulnerabilities on mar2181/lovable-clone's default branch (10 moderate)."

The hono PR #21 (4 GHSA advisories) was just merged this run, so these 10 are distinct — likely `npm` or transitive dep vulnerabilities not yet surfaced as PRs. Check:  
`https://github.com/mar2181/lovable-clone/security/dependabot`

**Fix:** review each advisory, accept Dependabot's PRs for any that are safe lock-file-only upgrades.

---

### P2 — `template-picker.tsx:80`: `fetchTemplates` called before declaration [NEW]

ESLint reports a React hooks immutability/hoisting violation: `fetchTemplates` is accessed inside a `useEffect` before it is declared. This creates a stale-closure risk at runtime — the effect may capture an undefined or outdated version of the function.

**File:** `components/dashboard/template-picker.tsx:80`
**Fix:** move the `fetchTemplates` declaration above the `useEffect` that calls it, or include it in the `useCallback` pattern.

---

### P2 — `web_search` likely dead (`TAVILY_API_KEY` unset) [PERSISTS]

`wrangler.toml` has no `TAVILY_API_KEY` or `FIRECRAWL_API_KEY` in secrets. Worker code degrades gracefully (`"TAVILY_API_KEY is not configured"`). Could not confirm live because the OpenRouter outage blocks model turns before tools fire.

**Fix:** after resolving P0, run a chat turn forcing web search. If unavailable: `cd worker && wrangler secret put TAVILY_API_KEY`.

---

### P3 — `middleware.ts` → `proxy.ts` rename needed [NEW]

`next build` emits a deprecation warning: the `middleware` file convention is removed in Next.js 16+. The file must be renamed to `proxy` before the next major Next upgrade breaks the proxy layer entirely.

**Fix (repo edit — flag):** `git mv middleware.ts proxy.ts` (and update any imports), then test the worker proxy routes, then `wrangler deploy` / Vercel redeploy.

---

## 🔧 Auto-healed this run
**None needed.** No operationally-fixable RED was present. The P1 requires Mario's confirm-first workflow (per policy.md). Pod, box, and worker are all operationally up.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence this run |
|---|---|---|
| **Build engine** | 🟢 GREEN (RESTORED) | SSE E2E: `build_complete` + **22 files**, 4 pages (Home/About/Services/Contact), zero errors. OpenRouter credits replenished. Latency 180–200s on 4-page build — watch timeout (see §Needs-Mario). |
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct). Project CRUD functional. |
| **GitHub Import** | 🟢 GREEN | Both Sandpack unit guards **PASS** (5/5 alias · 9/9 asset checks). Live import of `dan5py/react-vite-shadcn-ui` → **201**, 22 files, 0 failed, 0 errored. Cleanup 200. |
| **Frontend HTTP** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200; `/dashboard` → 200. |
| **Frontend build** | 🟢 GREEN | `next build` (Next.js 16.2.6 Turbopack) clean in 11.3s; **TypeScript: 0 errors** (9.2s). 6 routes built (static + SSR). |
| **Pet Concierge / Box** | 🟢 GREEN | `/healthz` → `ok:true`, build `2026-06-06-hsreels-tts`, **18 tools** (not stripped), voices `[will, jack]`, sessions 0/3. Wiring fully coherent: `data-backend="selfhosted"` → `data-connect-url="/boxapi"` → `next.config.ts /boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net` (exact match). `agent_id` present. No auto-fallback gap. |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; `git ls-files worker/.dev.vars` → empty (not tracked, not in history). |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts` uses exact-match origin allowlist (not `*`). `credentials:true` is correct for auth. |
| **Hono security bump** | 🟢 RESOLVED | PR #21 merged (`d612ffa`) — hono `4.12.18 → 4.12.23`, 4 GHSA advisories fixed. |
| **Worker typecheck script** | 🟢 RESOLVED | `86e84ea` added `"typecheck":"tsc --noEmit"` to worker `package.json`. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **Pod billed 24/7** at `$0.69/hr ≈ ~$500/mo` with `active_sessions:0`. No idle-watcher/sleep controller. Needs an idle-shutdown + on-demand broker-wake flow.
- **Telegram/SMS not configured** (`/api/share/health` → `telegram:false, sms:false`). In-app project sharing over phone is dark.
- **ESLint: 130+ `@typescript-eslint/no-explicit-any`** across `worker/src/routes/` and `components/`. No type safety at API boundaries. Non-blocking but accumulates tech debt.
- **ESLint: 80 warnings** — unused vars, missing `useEffect` deps, `<img>` vs `<Image />`, prefer-const. (234 total problems, 2 auto-fixable.)
- **deploy/drift** — not verified (Vercel token absent in cloud run). Verify locally: `vercel ls` or check Vercel dashboard that HEAD `86e84ea` is deployed.
- **pod-power** — not checked (RUNPOD_API_KEY absent in cloud). Verify locally: `curl https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` with RunPod key.
- **Voice box: no auto-fallback** if box dies (ElevenLabs is quota-dead; real fix is HA/uptime, not re-wiring EL).
- **`GET /api/projects/<deleted-id>`** returns HTTP 200 with `{"error":"Project not found"}` — should be 404. Cosmetic.
- **Next.js workspace warning** — stray `/home/mario/package-lock.json` confuses Turbopack's workspace root detection.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD moved from `8cd0b87` → `86e84ea` since baseline (+4 commits: hono merge, QA harness, worker typecheck, deps bump). No drift to Vercel to confirm locally.

| Branch | Age | What it is | Recommendation | Reason |
|---|---|---|---|---|
| **`claude/builder-buddy-rail`** (PR #20) | 3 days | Docked Space Mario assistant rail — builder UI right-panel, `buddy-panel.tsx`, `pc-embed.js`, recently re-pointed to live pod | **BRING IN FOR REVIEW** | Ready & tested per PR body; updated 2026-06-04 to live endpoint — no longer dead EL. Human review needed before merge. |
| **`fix/sanitizer-icon-imports`** (PR #7) | 31 days | Bug fix: `fetchTemplates`-style "Home is not defined" red-screen — wires sanitizer into `template.ts`/`bridge.ts`/`blog.ts` + broadens icon regex | **REBASE THEN REVIEW** | Real bug fix content but PR base is 31 days behind master. Needs `git rebase master` + conflict resolution before actionable. |
| **`archive/windows-side-2026-05-11`** | 27 days | One-shot Windows-checkout safety snapshot — commit message says "NOT meant to be merged" | **ARCHIVE (delete)** | Self-documenting parking spot; 0 unique work not in master. |
| **`backup/pr13-pre-resolve-2026-05-12`** | 26 days | Pre-merge checkpoint for PR #13 | **ARCHIVE (delete)** | Pure backup, superseded by merge. |

**Open issues:** 0.
**Dependabot PRs:** 0 (PR #21 merged; no new advisories flagged this run).

---

## Δ vs baseline (2026-06-07 first run)

| Item | Direction | Detail |
|---|---|---|
| hono 4.12.23 security bump | ✅ RESOLVED | PR #21 merged `d612ffa` — 4 GHSA advisories fixed |
| Worker `typecheck` script | ✅ RESOLVED | `86e84ea` added `"typecheck":"tsc --noEmit"` |
| Build engine P0 (OpenRouter credits) | ✅ RESOLVED | Credits replenished — `build_complete` + 22 files confirmed live. Latency note: 180–200s for 4 pages. |
| P1 dev-bypass-prod | 🔴 PERSISTS | `ENVIRONMENT=development` + `DEV_BYPASS_AUTH=1` still in `[vars]` |
| PR #20 builder-buddy-rail | 🔄 UPDATED | Was IGNORE; now BRING IN (live pod re-pointed 2026-06-04) |
| middleware→proxy rename | 🆕 NEW | Next.js deprecation warning surfaced in build |
| template-picker.tsx:80 hook bug | 🆕 NEW | fetchTemplates before declaration — lint + runtime staleness risk |
| P2 web_search TAVILY | ⚠️ STILL UNCONFIRMED | Build engine now up — verify next: run a chat turn forcing web_search; if "unavailable", `wrangler secret put TAVILY_API_KEY` |
| Box wiring / proxy-target | ✅ VERIFIED | Deep audit confirms full chain coherent (previously YELLOW in probe) |
| unit-guards | ✅ VERIFIED | Both Sandpack guards PASS (previously YELLOW in probe) |
| .dev.vars gitignore | ✅ VERIFIED | Gitignored + not tracked (previously YELLOW in probe) |

---

## ⛔ Checks skipped for lack of cloud creds

These require local/vault access. Owner's on-demand local run covers them:

| Check | Reason skipped | What to run |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` / check Vercel dashboard — confirm HEAD `86e84ea` deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | Would re-run `selfheal.mjs` — not needed this run (worker is up) |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — local run sends it |
| **Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | Test HMAC-gated broker locally: confirm `connectUrl`+token returned |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 6 parallel domain agents → this synthesis.
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (1 RED/security P1 + 9 YELLOW/cloud-cred limits + 7 GREEN).
