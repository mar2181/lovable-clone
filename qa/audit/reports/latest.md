# HS Web App Builder — Audit Report

**Date:** 2026-10-01T11:13Z · **Run:** #3 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — Two P0 outages active (dashboard 404 + voice box down). P1 CVEs escalating (4 CRITICAL + 94 HIGH). P1 dev-bypass **RESOLVED** since last run.

> Probe: 6 GREEN · 9 YELLOW · 2 RED | Deep audit: 6 domains | Auto-healed: none (cloud creds absent)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — /dashboard returns 404 in production [~110 days unresolved]

`https://hswebappbuilder.space/dashboard` → HTTP 404. Root (`/`) is 200 and reachable. Local `npm run build` confirms `/dashboard` exists as a statically pre-rendered route (`○` in Next.js route table), so the production Vercel deployment is stale **or** Clerk middleware is returning 404 instead of a redirect for unauthenticated requests.

**Impact:** Dashboard is the app's primary page — users cannot navigate past the landing page. App is effectively unusable.

**Fix (try in order):**
1. Open `https://hswebappbuilder.space/dashboard` in an incognito browser — if it redirects to `/sign-in`, production is fine and the issue was curl following redirects; otherwise continue.
2. Check Vercel dashboard: confirm `master` HEAD is deployed. If the last successful deployment is old, trigger a manual redeploy.
3. Verify `middleware.ts`: confirm `clerkMiddleware` is returning a redirect (not 404) for unauthenticated `/dashboard` requests. Check whether `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set in Vercel env.

---

### P0 — Voice box (RunPod pod udcz4k7kse1zw6) down [~85 days unresolved]

All endpoints (`/healthz`, `/health`, `/dashboard`) → HTTP 404. TLS is valid (Cloudflare responds, cert expires 2026-11-22). The pod process on port 7860 is stopped or crashed — Cloudflare returns 404 on its behalf.

**Impact:** All `/boxapi/*` proxy calls from the app fail with 404. Self-hosted voice + brain path completely broken for all users. No auto-fallback (see P1 below).

**Fix:**
```bash
# Restart pod
curl -X POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
# Verify
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
# Expected: {"ok":true,"tools":{...},"tts":{...}}
```

**Short-term user-facing rollback (while restarting):** Remove lines 99–100 from the `<script>` element in `components/pet-concierge.tsx`:
```tsx
// DELETE these two lines temporarily to restore ElevenLabs:
data-backend="selfhosted"
data-connect-url="/boxapi"
```

> Cannot auto-fix: `RUNPOD_API_KEY` not available in cloud environment.

---

### P1 — 4 CRITICAL + 94 HIGH npm dependency CVEs [ESCALATING from 10 moderate in June]

Vulnerability count has grown dramatically. Timeline reconstructed from audit PR history:

| Date | Count |
|------|-------|
| 2026-06-07 (last audit) | 10 moderate |
| 2026-07-04 | 43 / 5 HIGH |
| 2026-08-04 | 15 HIGH + 3×P0 |
| 2026-09-13 | 4 CRITICAL appear |
| 2026-09-25 | 94 P1 total |
| 2026-09-28 (latest audit branch) | "critical next CVE" still open |

Local `npm audit` also shows **1 critical + 7 high** on the current checkout.

**Immediate fixes:**
1. **Merge PR #47** (`dependabot/npm_and_yarn/mcp-server/...`) — fast-uri security patch for `/mcp-server`. 72 days old, ready to merge.
2. **Merge PR #28** (`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`) — npm group bump across 3 directories. 103 days old, ready to merge.
3. Run `npm audit fix` on master after merging and check remaining count.
4. Full audit: `https://github.com/mar2181/lovable-clone/security/dependabot`

---

### P1 — No auto-fallback when voice box is down [PERSISTS]

`components/pet-concierge.tsx` has no runtime health detection. When `/boxapi` returns 404, the embed fails silently. Manual rollback comment at lines 97–98: "INSTANT ROLLBACK: delete these two lines → the embed resolves ElevenLabs again." This is not automatic.

**Short-term:** Delete `data-backend="selfhosted"` + `data-connect-url="/boxapi"` (lines 99–100) while box is being fixed.
**Long-term fix:** Add a `/boxapi/healthz` preflight check in `pet-concierge.tsx` that falls back to ElevenLabs automatically if the box is unreachable.

---

### P1 — Audit runbook broken: Bearer dev-local-user blocked in prod [NEW]

The P1 security fix (deployed ~2026-08-09) set `ENVIRONMENT=production` in `wrangler.toml`, correctly disabling the `Bearer dev-local-user` bypass. This is the right security posture. **Side effect:** the audit spec's instructions to use this token against the production worker no longer work — build engine E2E and import live tests get 401.

**Fix for runbook:** Add `MCP_API_KEY` to cloud scheduled-audit environment secrets. Update `qa/audit/RUNBOOK.md` to use `X-API-Key: <MCP_API_KEY>` header for all production worker calls (`auth.ts` line 46 confirms this grants `isOwner: true`).

---

### P1 — middleware.ts → proxy.ts rename not done [PERSISTS from June]

`middleware.ts` convention is deprecated in Next.js 16. Build emits a deprecation warning every run. Will break in the next major Next.js upgrade.

**Fix:** `git mv middleware.ts proxy.ts` (no imports to update — Next.js picks it up by filename convention), then push and redeploy.

---

### P2 — Build engine and GitHub import live tests: status UNKNOWN [NEW]

Auth blocked both build SSE E2E and live import test. Worker `/health` → 200 (infra up). Last confirmed build: 2026-06-07 (`build_complete` + 22 files). OpenRouter credits status unknown.

**Next step:** Once runbook is updated with X-API-Key, rerun E2E at next audit. Or manually: create a project from the dashboard and trigger a build.

---

### P2 — template-picker.tsx:80: fetchTemplates before declaration [PERSISTS]

`fetchTemplates` used inside a `useEffect` before its declaration; also missing from the deps array. Potential stale-closure bug on template fetch.

**Fix:** Move `fetchTemplates` declaration above the `useEffect`, or wrap in `useCallback` and include in deps.

---

### P2 — setState called synchronously in useEffect [NEW]

Two files call `setState` directly inside a `useEffect` body (no condition), risking cascading render loops:
- `components/editor/preview-panel.tsx:647`
- `components/pet-concierge.tsx:67`

**Fix:** Guard the setState with a condition checking whether the value actually changed, or separate into a derived state pattern.

---

## 🔧 Auto-healed this run

**None.** Both P0s require credentials absent in cloud (`RUNPOD_API_KEY` for pod restart, `VERCEL_TOKEN` for redeploy confirmation). No operationally-fixable RED was present that could be healed without those keys.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|--------|---------|----------|
| **P1 dev-bypass — RESOLVED** | 🟢 RESOLVED | `GET /api/credits` with `Bearer dev-local-user` → **401** confirmed. `wrangler.toml:22` `ENVIRONMENT=production`, `DEV_BYPASS_AUTH` absent. Security fix fully live. |
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401. |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). |
| **Import unit guards** | 🟢 GREEN | 5/5 sandpack-alias + 9/9 sandpack-assets = **14/14 PASS**. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build** | 🟢 GREEN | `next build` clean 12.4s, TypeScript **0 errors** (9.3s), 6 routes pre-rendered. |
| **CORS allowlist** | 🟢 GREEN | `allowList.includes(incoming)` strict string equality, no wildcard. |
| **worker/.dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars` (root pattern); not tracked. Probe's YELLOW was a false alarm. |
| **pet-concierge wiring** | 🟢 GREEN | `data-backend="selfhosted"` (line 99), `data-connect-url="/boxapi"` (line 100), `GARY_AGENT_ID` present (line 10). Component structure intact. |
| **next.config.ts proxy target** | 🟢 GREEN | `/boxapi/:path*` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` (exact match). |

---

## 🩹 Hygiene backlog (P3 — batched)

- **34 audit record branches + 28 draft PRs** accumulating since June. Batch-close all 28 draft PRs as "won't merge — record only"; delete 32 branches older than 30 days (keep 2026-09-28 and 2026-09-25).
- **31 open audit issues** — all labeled RED, none closed. Batch-close, keep the two most recent.
- **PR #20 (claude/builder-buddy-rail)** — 119 days open, zero review activity. Decision needed: review or close. Overlaps with voice box P0.
- **Pod billed 24/7 while crashed** — ~$0.69/hr ≈ $500/mo with process not running. Idle-shutdown controller needed.
- **Telegram/SMS not configured** (`telegram: false, sms: false`). In-app phone sharing dark.
- **ESLint: 157 errors, 79 warnings** (236 total, +2 vs last run). `@typescript-eslint/no-explicit-any` bulk of errors; 2 auto-fixable.
- **`<img>` vs `<Image />`** in `attachment-preview.tsx`, `chat-message.tsx` — LCP impact.
- **ENVIRONMENT as hardcoded [vars] string** in `wrangler.toml` — low risk (value is "production") but if accidentally changed to "development", bypass re-engages. Consider a `[env.production]` wrangler environment binding instead.
- **web_search (TAVILY_API_KEY)** — still unconfirmed; auth blocked the test again.
- **`GET /api/projects/<deleted-id>`** → 200 `{"error":"Project not found"}` instead of 404. Cosmetic.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

### State snapshot (2026-10-01)

| Metric | Count |
|--------|-------|
| Total branches | 38 |
| Open PRs | 30 |
| Open issues | 31 |
| Dependabot CVEs | **4 CRITICAL + 94 HIGH** |

### Branch changes since 2026-06-07

| Branch | Status |
|--------|--------|
| `fix/sanitizer-icon-imports` (PR #7) | ✅ Gone — closed/merged as recommended |
| `archive/windows-side-2026-05-11` | ✅ Deleted as recommended |
| `backup/pr13-pre-resolve-2026-05-12` | ✅ Deleted as recommended |
| `claude/builder-buddy-rail` (PR #20) | ⚠️ Still open, 119 days, zero reviews — **BRING IN OR CLOSE** |

### Dependabot PRs ready to merge

| PR | Age | Fix | Action |
|----|-----|-----|--------|
| **#47** | 72 days | fast-uri security patch (mcp-server) | **MERGE NOW** |
| **#28** | 103 days | npm group bump (3 directories) | **MERGE NOW** |

### Audit branches/PRs (do not merge)

34 branches + 28 draft PRs created 2026-06-10 → 2026-09-28 by prior audit runs. All are documentation records, not code. **Recommended:** batch-close all 28 draft PRs as "won't merge — record only"; delete 32 branches older than 30 days (retain `audit/report-2026-09-28` and `audit/report-2026-09-25`).

---

## Δ vs 2026-06-07 (last report)

| Item | Direction | Detail |
|------|-----------|--------|
| **P1 dev-bypass-prod** | ✅ RESOLVED | `ENVIRONMENT=production` deployed; `Bearer dev-local-user` → 401 confirmed |
| **`/dashboard` → 404** | 🔴 REGRESSED | Was GREEN on 2026-06-07; now 404 for ~110 days |
| **Voice box /healthz** | 🔴 REGRESSED | Was GREEN on 2026-06-07 (ok:true, 18 tools, 2 voices); now 404 for ~85 days |
| **npm CVEs** | 🔴 ESCALATED | 10 moderate → **4 CRITICAL + 94 HIGH** |
| **middleware.ts deprecation** | ⚠️ PERSISTS | Rename to proxy.ts still not done |
| **template-picker.tsx:80** | ⚠️ PERSISTS | fetchTemplates before declaration still present |
| **Audit runbook** | 🆕 NEW | Bearer dev-local-user blocked; runbook needs X-API-Key update |
| **setState in effect** | 🆕 NEW | preview-panel.tsx:647 + pet-concierge.tsx:67 — cascading render risk |
| **Import unit guards** | ✅ VERIFIED | 14/14 PASS (same as last run) |
| **.dev.vars probe YELLOW** | ✅ CLEARED | Gitignored via root pattern — probe's YELLOW was a false alarm |
| **npm audit (local)** | 🆕 NEW | 1 critical + 7 high on checkout (subset of broader 4 CRITICAL + 94 HIGH) |

---

## ⛔ Checks skipped — cloud creds absent

Local on-demand run covers these:

| Check | Reason skipped | What to run |
|-------|---------------|-------------|
| **Build engine E2E** | Dev bypass disabled; `MCP_API_KEY` not in cloud env | `X-API-Key: <MCP_API_KEY>` header — `POST /api/projects` + `POST /api/build/<id>` |
| **GitHub import live test** | Same auth issue | Same: X-API-Key |
| **OpenRouter credits** | Build engine unreachable | Run build manually from dashboard; watch for "Insufficient credits" |
| **RunPod pod-power state** | `RUNPOD_API_KEY` not in cloud | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud | Check Vercel dashboard — confirm master HEAD deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY` not in cloud | Not needed (worker /health is 200) |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` |
| **Box POST /api/connect session** | RunPod broker token in `.dev.vars` | Test locally after pod restart |

---

*Probe JSON: `qa/audit/reports/latest-probe.json`*
*Previous report: `qa/audit/reports/2026-06-07.md`*
