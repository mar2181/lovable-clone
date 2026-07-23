# HS Web App Builder — Audit Report

**Date:** 2026-07-07T11:30Z · **Run:** #10 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 2 P0s active (Voice Box completely DOWN, /dashboard 404 in prod). P1 security bypass persists. Build engine operational but approaching timeout cliff.

> Probe: 5 GREEN · 9 YELLOW · 3 RED | Deep audit: 6 domains | Auto-healed: none (no cloud creds)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Voice Box completely DOWN (`/healthz` → 404) [REGRESSION]

The RunPod pod `udcz4k7kse1zw6` port 7860 is behind Cloudflare (TLS handshake succeeds, cert valid through Sep 2026) but the Chatterbox service returns HTTP 404 with an empty body on **every** route tested: `/healthz`, `/dashboard/tools`, `/api/voice-session`, `/api/connect`. The process on the container is either crashed, the pod is stopped/hibernated, or misrouted.

**Impact:** Voice and brain features are completely non-functional for all users.

**Fix (operational — no repo change needed):**
1. Log into RunPod dashboard → pod `udcz4k7kse1zw6` → check status (stopped? crashed?).
2. If stopped: Start pod. If crashed: restart.
3. Verify: `curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → `{"ok":true,...}`
4. Check `tools.count` (should be ~18) and `tts.voices` (should include `will`/`jack`).

**Note:** Per policy.md, cloud run cannot auto-heal this (no `RUNPOD_API_KEY`). The wiring is correct on the app side — `data-backend="selfhosted"`, `/boxapi` proxy, `next.config.ts` rewrite all match exactly.

**Secondary issue — no automatic fallback:** There is no runtime detection for box failure. When `/boxapi/*` returns 404/502, the embed hangs silently with no recovery path. The only fallback is a manual code change (remove `data-backend` + `data-connect-url` from `pet-concierge.tsx`) + redeploy. Consider adding a probe-before-init pattern or a keepalive that switches to ElevenLabs on repeated 404s.

---

### P0 — `/dashboard` returns 404 in production [REGRESSION]

`https://hswebappbuilder.space/dashboard` returns HTTP 404. The local build confirms the route exists and compiles correctly as a static page — this is a **deployment lag** issue: the current codebase is not what's live on Vercel.

**Fix:**
1. Check Vercel dashboard — confirm the latest deploy matches master HEAD.
2. If stale: trigger a redeploy (`vercel --prod` or push a no-op commit).
3. Verify: `curl -o /dev/null -w "%{http_code}" https://hswebappbuilder.space/dashboard` → 200.

**Compounding risk — `middleware.ts` deprecation:** Next.js 16.2.6 emits a build warning: *"The middleware file convention is deprecated. Please use `proxy` instead."* If the framework stops honoring `middleware.ts` in a future patch, Clerk auth protection for `/dashboard`, `/editor/[id]`, and all protected routes will silently drop. Fix: `git mv middleware.ts proxy.ts` (update any imports) → test → redeploy. This is a **repo edit — flag**.

---

### P1 — Anyone can be owner in prod (`Bearer dev-local-user`) [PERSISTS — Run #10]

**Confirmed live this run:** `GET /api/credits` with `Bearer dev-local-user` → `{"tier":"unlimited","balance":9999}`. The full build pipeline, project CRUD, and all owner-level endpoints accept this credential.

Root cause: `worker/wrangler.toml` `[vars]` block contains both `ENVIRONMENT = "development"` (line 16) and `DEV_BYPASS_AUTH = "1"` (line 17). Auth gate in `worker/src/middleware/auth.ts` lines 62–63 is OR logic — either var alone enables the bypass.

**Fix (CONFIRM-FIRST per policy.md — not auto-applied):**
1. Log into `hswebappbuilder.space` with real Clerk credentials and confirm your projects are visible.
2. Edit `worker/wrangler.toml` — remove from `[vars]`:
   ```toml
   # DELETE these two lines:
   ENVIRONMENT = "development"
   DEV_BYPASS_AUTH = "1"
   ```
3. Move `ENVIRONMENT = "production"` to a `[env.production]` block or set via `wrangler secret put`.
4. `cd worker && wrangler deploy`
5. Verify: `curl -H "Authorization: Bearer dev-local-user" .../api/credits` → 401.

**Note:** `worker/.dev.vars` is properly gitignored (root `.gitignore` lines 52–53, confirmed not tracked). No live secrets in git.

---

### P1 — Build engine at timeout cliff — first attempt silently failed [NEW]

The build SSE E2E ran twice this audit:
- **Attempt 1:** Ran exactly 180s, connection cut mid-batch (batch 1, Contact page still generating). **No `build_complete`, no `{type:"error"}` event** — client received zero failure signal and would spin indefinitely.
- **Attempt 2:** Completed in 173s → `build_complete` + **24 files**. Zero error events. Engine is operationally UP.

The ~7s margin between attempts is pure LLM latency variance. Any upstream slowdown causes silent incomplete builds for real users.

**Fixes (repo changes — flag):**
1. **Server:** Add a hard-deadline timer that emits `{"type":"error","message":"Build timeout — please retry"}` before closing the stream. Prevents silent hangs.
2. **Client:** Increase recommended SSE client timeout from 180s → 240s (or use a keepalive ping from the server side).
3. **Planner:** The prompt *"A simple landing page with a hero section and one CTA button"* triggered a 4-page React app (Home, About, Services, Contact — 24 files, 2 batches). Add guardrails: single-sentence landing-page prompts should produce 1 page, not 4. This 4× over-generation pushed the build to the timeout edge and consumes 4× the LLM tokens.

---

### P1 — `claude/builder-buddy-rail` unmerged 34 days, no PR [PERSISTS]

A substantial completed feature (dual-backend Space Mario voice assistant rail: self-hosted GPU primary + ElevenLabs fallback, `buddy-panel.tsx` + `pc-embed.js`, 4253 net lines across 5 files) has been off master since June 3 with no pull request opened. As master advances, merge-conflict risk grows — especially in `public/pc-embed.js` (+3778 lines).

**Action:** Open a PR for `claude/builder-buddy-rail` now, or explicitly archive the branch with a decision record. Previous audit recommended "BRING IN FOR REVIEW" (as of 2026-06-07).

---

### P2 — `/dashboard` deployment lag → Vercel deploy drift unconfirmed

`VERCEL_TOKEN` is absent in cloud; cannot programmatically check drift. Given the /dashboard 404, a stale Vercel deploy is confirmed. Check: `vercel ls` or Vercel dashboard — confirm master HEAD is deployed.

---

### P2 — `fetchTemplates` hoisting in `template-picker.tsx` NOT fixed [PERSISTS]

ESLint error at `components/dashboard/template-picker.tsx:80`: `Cannot access variable before it is declared — fetchTemplates`. The `async function fetchTemplates` declared at line 84 is called inside a `useEffect` at line 80. Runtime hoists it (no crash) but the `useEffect` dependency array cannot track mutations → stale-closure risk.

**Fix:** Move the `fetchTemplates` declaration above the `useEffect`, or convert to `useCallback` and add to deps.

---

### P2 — `setState` called synchronously in `useEffect` [NEW]

Two files call `setState` directly in an effect body without a conditional or async boundary:
- `components/editor/preview-panel.tsx:647`
- `components/pet-concierge.tsx:67`

ESLint `react-hooks/immutability` flags these as errors. Can cause cascading re-renders and infinite loops under specific React Strict Mode conditions.

---

### P2 — 43 Dependabot vulnerabilities on master (5 high) [WORSENED]

GitHub Dependabot reports **43 vulnerabilities** on the default branch: **5 high, 30 moderate, 8 low** (confirmed via push output). `npm audit` locally surfaced 9 — GitHub's advisory database is more comprehensive. This has grown since the last report (was 10 moderate at 2026-06-07).

**Fix:** Visit `https://github.com/mar2181/lovable-clone/security/dependabot` and review each advisory. Accept Dependabot PRs for safe lock-file-only upgrades. The 5 high-severity advisories warrant immediate review.

---

### P2 — `web_search` likely dead (`TAVILY_API_KEY` unset) [PERSISTS — UNCONFIRMED]

`wrangler.toml` has no `TAVILY_API_KEY` in `[vars]` or secrets. Worker degrades gracefully (`"TAVILY_API_KEY is not configured"`). Cannot confirm live — build audit uses SSE, not chat turns.

**Fix:** Run a chat turn forcing web search. If "unavailable": `cd worker && wrangler secret put TAVILY_API_KEY`.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence this run |
|---|---|---|
| **Build engine** | 🟢 GREEN (operational) | SSE E2E attempt 2: `build_complete` + **24 files** (Home/About/Services/Contact pages + components + utils). Zero `{type:"error"}` events. OpenRouter credits intact. |
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (gated). |
| **GitHub Import** | 🟢 GREEN | Sandpack alias **5/5 PASS**, assets **9/9 PASS**. Live import of `dan5py/react-vite-shadcn-ui` → **201**, 22 files, 0 failed. Auth gate: anon → 401 (correct). Cleanup 200 ✅. |
| **Frontend HTTP (root)** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build** | 🟢 GREEN | `next build` (Turbopack, 9.4s compile, 7.8s TypeScript) — **0 TypeScript errors**. 6 routes compiled. |
| **Security — .dev.vars** | 🟢 GREEN | Root `.gitignore:52–53` covers `worker/.dev.vars`; `git ls-files worker/.dev.vars` → empty (not tracked). |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts` uses exact-match origin allowlist. `Access-Control-Allow-Origin: *` on `/api/assets/*` only (intentional CDN pattern). |
| **Concierge wiring** | 🟢 GREEN | App-side wiring intact: `data-backend="selfhosted"` → `data-connect-url="/boxapi"` → `next.config.ts /boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` (exact match). `agent_id` present. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **156 lint errors** across 50+ files — primarily `@typescript-eslint/no-explicit-any` in `worker/src/routes/`, `sdk/src/`, `mcp-server/src/`. Blocks any CI lint gate. Needs a one-time sweep.
- **`middleware.ts` → `proxy.ts` rename** — deprecation warning in every build. Fix before Next.js drops backward compat.
- **CORS preflight leaks `allow-headers`/`allow-methods`** to rejected origins (HTTP 204, no ACAO). Not browser-exploitable but leaks the API's capability surface to network observers. Low urgency.
- **`worker/.gitignore` missing** — `.dev.vars` protection relies solely on root `.gitignore`. A dedicated `worker/.gitignore` would be more robust.
- **Missing `"type":"module"` in `package.json`** — causes Node double-parse warning in QA scripts (`[MODULE_TYPELESS_PACKAGE_JSON]`). Verify no CJS files before adding.
- **`GARY_AGENT_ID` constant** — named for old persona, holds Space Mario agent ID. Rename to `SPACE_MARIO_AGENT_ID`.
- **Missing `useEffect` deps** — `clone-project-dialog.tsx:41` (missing `project`), `project-list.tsx:51` (missing `loadProjects`). Stale-closure risk.
- **`<img>` vs `<Image />`** — `attachment-preview.tsx:26`, `chat-message.tsx:66`. LCP/bandwidth impact.
- **Telegram/SMS not configured** (`/api/share/health` → `telegram:false, sms:false`). In-app phone sharing dark.
- **Pod billed 24/7** at ~$0.69/hr (≈ $500/mo) when idle. No idle-watcher/sleep controller.
- **`GET /api/projects/<deleted-id>`** returns 200 `{"error":"Project not found"}` — should be 404.
- **Unescaped apostrophe** in `components/editor/chat-panel.tsx:263` — use `&apos;` or curly-braced string.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch | Age | What it is | Recommendation | Reason |
|---|---|---|---|---|
| **`claude/builder-buddy-rail`** | 34 days | Dual-backend Space Mario voice rail (4253 lines, 5 files) | **OPEN PR NOW** | Complete feature, 34 days unmerged, growing conflict risk. See P1 above. |
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** | 17 days | `tsx` 4.7 → 4.22 in `mcp-server/` (dev-dep only) | **BRING IN** | Low-risk dev-toolchain bump, lock-file only. Merge or close before it goes stale. |
| **`audit/report-2026-06-10` through `audit/report-2026-07-04`** (8 branches) | 3–27 days | Audit report markdown only | **ARCHIVE (delete)** | Reports already exist in repo; branches are stale noise. **Exception:** confirm `audit/report-2026-06-13` — it contains a stray `package-lock.json` normalization commit (`chore: normalize fsevents dev flag`) that is NOT in master. Cherry-pick or drop before deleting. |

---

## Δ vs previous `latest.md` (2026-06-07)

| Item | Direction | Detail |
|---|---|---|
| **Box health** | 🔴 REGRESSED | Was GREEN (ok:true, 18 tools, voices [will,jack]) in 06-07. Now completely DOWN — all routes 404. |
| **/dashboard HTTP** | 🔴 REGRESSED | Was 200 GREEN in 06-07. Now 404 in prod (deployment lag). |
| **Build engine** | ✅ STABLE | Remains operational. Timeout cliff now confirmed as P1 (first attempt timed out silently). |
| **P1 dev-bypass-prod** | 🔄 PERSISTS | Unchanged since baseline. 10 consecutive runs. Still in `[vars]`. |
| **fetchTemplates hoisting** | 🔄 PERSISTS | Not fixed since 06-07. |
| **middleware.ts deprecation** | 🔄 PERSISTS | Not fixed since 06-07. |
| **web_search TAVILY** | 🔄 PERSISTS | Still unconfirmed. |
| **Sandpack unit guards** | ✅ STABLE | PASS (5/5 alias, 9/9 assets). Import 201. |
| **builder-buddy-rail** | 🔄 PERSISTS | "BRING IN FOR REVIEW" since 06-07 — no PR opened, now 34 days stale. |
| **hono security bump** | ✅ RESOLVED | PR #21 merged — confirmed not regressed. |
| **new: Build planner over-scopes** | 🆕 NEW P2 | Simple landing page prompt → 4-page app, 24 files, 173s build. |
| **new: setState in useEffect** | 🆕 NEW P2 | `preview-panel.tsx:647`, `pet-concierge.tsx:67`. |
| **new: npm audit 1 high** | 🆕 NEW P2 | 9 vulns total (2 low, 6 moderate, 1 high). |
| **new: CORS preflight leak** | 🆕 NEW P3 | Preflight reveals headers/methods to any origin (not exploitable but leaks surface). |
| **new: worker/.gitignore missing** | 🆕 NEW P3 | .dev.vars protection relies on root .gitignore only. |
| **template-picker.tsx ESLint** | 🆕 CONFIRMED | Previous run noted it; now confirmed ESLint error (not just warning). |

---

## ⛔ Checks skipped (cloud creds absent — run locally to cover)

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Box `POST /api/connect` session** | Broker HMAC token in `.dev.vars` | Confirm `connectUrl`+token returned; test real voice session |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` / Vercel dashboard — confirm master HEAD deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | `node qa/audit/selfheal.mjs` |
| **Telegram notification** | No Telegram token in cloud | `POST /api/share/phone` or `notify_mario()` |

---

*Tier-1 probe: `qa/audit/audit-probe.mjs --json` → 5 GREEN · 9 YELLOW · 3 RED*
*Deep audit: 6 parallel domain agents*
*Probe JSON: `qa/audit/reports/latest-probe.json`*
