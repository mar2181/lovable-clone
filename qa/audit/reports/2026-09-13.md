# HS Web App Builder — Audit Report

**Date:** 2026-09-13T11:00Z · **Run:** #17 (scheduled, 3-day cadence) · **Mode:** cloud / secret-free
**Overall: 🔴 RED** — Two chronic P0 outages (dashboard 404 day ~97 + voice box DOWN day ~70) persist with no evidence of repair. Build engine E2E untestable from cloud (correct auth fix side-effect). **NEW: 4 CRITICAL + 37 HIGH vulnerabilities on master** (GitHub Dependabot). P1 dev-bypass confirmed resolved.

> Probe: 10 GREEN · 6 YELLOW · 2 RED  |  Deep audit: 6 domains  |  Auto-healed: none (no cloud creds for operational fixes)  |  Master commits since last audit: 0

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 (CHRONIC, day ~97) — `/dashboard` returns 404 in prod

**Live:** `GET https://hswebappbuilder.space/dashboard` → HTTP 404 (Next.js not-found; no redirect).

**Status:** First flagged 2026-06-08 (PR #27). Appears in every audit for 97 days. Zero owner action logged.

**Root cause (unchanged):** Code is correct — `app/dashboard/page.tsx` exists, `npm run build` produces `/dashboard` as a static route with 0 TypeScript errors. This is a **Vercel hosting failure** — either the live deployment is stale/failed, or Clerk middleware is not redirecting unauthenticated users to `/sign-in` and is instead falling to not-found.

**Fix:**
1. Check Vercel dashboard for a failed deployment against HEAD `eb5ab744`.
2. Trigger a fresh redeploy of `master` HEAD.
3. If /dashboard still 404s after deploy: check that `NEXT_PUBLIC_DEV_BYPASS_AUTH` (or similar Clerk env var) is set in Vercel and that the middleware is redirecting to `/sign-in`, not returning 404.
4. Verify: `curl -I https://hswebappbuilder.space/dashboard` should return `307 → /sign-in` (for unauthed users) or `200`.

---

### P0 (CHRONIC, day ~70) — Voice box unreachable

**Live:** `GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → HTTP 404 (empty body). All paths return 404. TLS handshake succeeds — RunPod reverse-proxy is up; the **application process inside the pod has stopped**.

**Status:** First confirmed down ~2026-07-06 (PR #39). Wiring is intact: `pet-concierge.tsx` has `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, correct `agent_id`. `next.config.ts` proxy destination `https://udcz4k7kse1zw6-7860.proxy.runpod.net` matches exactly. Operational pod failure only.

**Per `policy.md`:** would be auto-fixed if `RUNPOD_API_KEY` were available in cloud. It is not. Flagged.

**Fix (RunPod dashboard or API key needed):**
1. Log into RunPod → pod `udcz4k7kse1zw6` — check state (EXITED / ERROR / RUNNING).
2. If EXITED: restart pod; wait for RUNNING.
3. After pod is RUNNING: `POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/dashboard/agent/restart`
4. Verify: `GET /healthz` → `{"ok":true, "tools":{"count":18}, "tts":{"voices":["will","jack"]}}`.

---

### P1 (AUDIT PROCESS, ongoing) — Build engine E2E unverifiable from cloud

The 2026-08-09 security fix (`d511723`) correctly set `ENVIRONMENT=production` and removed `DEV_BYPASS_AUTH` from `worker/wrangler.toml [vars]`. Side-effect: `Bearer dev-local-user` now correctly returns HTTP 401 on all authenticated worker endpoints, blocking the audit's build E2E test and GitHub import live test.

**Infrastructure is healthy** (`/health` → 200, `/api/spec.json` → 200, anon → 401 correct). But the AI build pipeline (OpenRouter credits, SSE streaming, file generation) has not been verified live since **2026-06-07 — 98 days ago**. This is a critical gap.

**Fix — provision an audit credential:**
```bash
cd worker
# generate a long random value and store as a secret:
wrangler secret put AUDIT_API_KEY
```
Add `AUDIT_API_KEY` to the cloud scheduled agent environment. Update `qa/audit/audit-probe.mjs` to use `X-API-Key: <AUDIT_API_KEY>` for build E2E tests. The MCP API-Key path grants `isOwner:true` and can reach `/api/build` and `/api/github/import`.

---

### P1 — 4 CRITICAL + 37 HIGH vulnerabilities on master (WORSENING)

**GitHub Dependabot scanner (authoritative):** `93 total` on default branch — **4 critical, 37 high, 47 moderate, 5 low** (per push-to-origin feedback this run).

This is UP from 35 HIGH / 74 total (2026-09-07). The 4 CRITICAL advisories are new and not previously seen. Full advisory list: https://github.com/mar2181/lovable-clone/security/dependabot

*Note: local `npm audit` only showed 14 HIGH / 72 total across all three package roots — GitHub's GHSA scanner catches more transitive dependencies.*

**Unmerged Dependabot PRs:**

| PR | Title | Age | Status |
|---|---|---|---|
| **#28** | bump npm_and_yarn group across 3 directories (2 packages) | **87 days** | OPEN |
| **#47** | bump fast-uri 3.1.2→3.1.4 in /mcp-server | **54 days** | OPEN |

**Fix:** 
1. Immediately review the 4 CRITICAL advisories at the Dependabot URL above.
2. Merge PRs #28 and #47 — safe lock-file-level bumps.
3. Accept any additional safe Dependabot PRs that GitHub generates for the remaining advisories.

---

### P2 — `middleware.ts` rename to `proxy.ts` (4th month, unactioned)

`npm run build` emits: *"The 'middleware' file convention is removed in Next.js 16+. Rename to 'proxy'."* File `/home/user/lovable-clone/middleware.ts` still exists unchanged. Flagged since 2026-06-07.

**Fix (repo edit — flag):** `git mv middleware.ts proxy.ts`, update any imports referencing it, redeploy to Vercel. Low urgency but will hard-break on next Next.js major.

---

### P3 — 22 stale audit PRs accumulating, blocking GitHub signal

22 open audit PRs (`audit/report-*`) are cluttering the PR list. None have been reviewed or closed. This buries real work (e.g., PR #20 builder-buddy-rail, PR #28, PR #47) in noise.

**Recommendation:** Close all `audit/report-*` PRs in bulk and delete their branches. Audit reports should be archived as files on master, not kept as open PRs — or consider skipping the PR step if it produces no value.

---

## 🔧 Auto-healed this run
**None.** Both P0s require RunPod API key (pod restart) or Vercel token (deploy trigger), neither available in the cloud run.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Security — dev bypass** | 🟢 RESOLVED | `Bearer dev-local-user` → HTTP 401 `{"error":"Unauthorized — invalid token"}` in prod. `wrangler.toml`: `ENVIRONMENT=production`, `DEV_BYPASS_AUTH` absent. `auth.ts` devBypassEnabled=false. |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore` covers `worker/.dev.vars`; `git ls-files worker/.dev.vars` → empty (not tracked). |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts` uses exact-match origin allowlist. Correct. |
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), anon → 401 (correct gate). |
| **Frontend homepage** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build** | 🟢 GREEN | `app/dashboard/page.tsx` exists, build produces `/dashboard` route. Code is correct; 404 is Vercel-side. |
| **Sandpack unit guards** | 🟢 GREEN (×2) | `test-sandpack-alias.ts`: 5/5 PASS · `test-sandpack-assets.ts`: 9/9 PASS |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). Auth fix is correct. |
| **Pet Concierge wiring** | 🟢 GREEN | `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `agent_id` present. |
| **Proxy target** | 🟢 GREEN | `next.config.ts` `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` — correct match. |
| **Deploy drift** | 🟢 GREEN | Probe: local HEAD = remote HEAD = `eb5ab744`. No drift. |
| **Worker typecheck** | 🟢 GREEN | `worker/package.json` has `"typecheck": "tsc --noEmit"`. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **Pod billed 24/7** at ~$0.69/hr (~$500/mo) while box is DOWN (sessions: 0). Idle-shutdown controller still absent.
- **Telegram/SMS** still not configured (`telegram=undefined, sms=undefined`). In-app project-sharing over phone is dark.
- **ESLint `@typescript-eslint/no-explicit-any`** — 130+ instances across `worker/src/routes/` and `components/`. Non-blocking tech debt.
- **`GET /api/projects/<deleted-id>`** returns HTTP 200 with `{"error":"Project not found"}` instead of 404. Cosmetic.
- **Probe `hygiene/worker-scripts` YELLOW** — false-alarm: the `typecheck` script does exist; the YELLOW is only for missing `npm test`. No action needed until a real test suite is added.
- **`deploy/drift` and `pod-power`** — YELLOW in probe due to absent cloud creds (expected, not actionable in this run).
- **30 non-master branches** — 27 are stale `audit/report-*` branches and 1 `backup/*`, 1 `claude/builder-buddy-rail` (stale since June 3). See §GitHub Reconciliation.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD: `eb5ab744` (unchanged since 2026-09-07 — 6 days idle).

**Non-audit branches:**

| Branch | PR | Age | What it is | Recommendation |
|---|---|---|---|---|
| **`claude/builder-buddy-rail`** | #20 | 102 days | Docked Space Mario assistant rail | **REVIEW + merge or close.** Stale 102 days. If still relevant, rebase on master; otherwise close. |
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** | #28 | 87 days | npm_and_yarn group bump × 3 directories | **MERGE.** Safe lock-file bump, 87 days old. |
| **`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`** | #47 | 54 days | fast-uri 3.1.2→3.1.4 in /mcp-server | **MERGE.** Safe dep bump, 54 days old. |

**Audit branches (27 stale `audit/report-*`):** All contain only the audit report MD file. The data is in `latest.md` on master. **ARCHIVE all 27** (delete branches, close PRs). No code to preserve.

**Open PR count:** 25 total — 22 are audit PRs (signal-to-noise = bad).

---

## Δ vs 2026-09-07 (run #16)

| Item | Direction | Detail |
|---|---|---|
| P0 dashboard 404 | 🔴 PERSISTS | Day ~97 (was ~90). No owner action. |
| P0 voice box DOWN | 🔴 PERSISTS | Day ~70 (was ~63). No owner action. |
| P1 audit process (build untestable) | 🔴 PERSISTS | Still no AUDIT_API_KEY provisioned. Build pipeline unverified 98 days. |
| P2 Dependabot PRs #28, #47 | 🔴 PERSISTS | Now 87 + 54 days. |
| P2 middleware.ts rename | 🔴 PERSISTS | 4th month flagged. |
| **Security — dev bypass** | ✅ CONFIRMED GREEN | P1 from June now fully confirmed off in prod. |
| GitHub Dependabot vulns | 🔴 WORSENED | 74 total (35H) → 93 total (4 CRITICAL + 37H). Merging PRs #28+#47 is not keeping pace. |
| Master activity | ℹ️ IDLE | 0 commits since 2026-09-07. |
| Stale audit PRs | 🔴 WORSENING | +1 PR, now 22. No PRs reviewed or closed. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **Build engine E2E** | `AUDIT_API_KEY` not in cloud env (dev-local-user correctly 401s) | Provision `AUDIT_API_KEY` (see Needs-Mario §P1); then re-run probe with `X-API-Key` header |
| **GitHub Import live test** | Same — owner-only route, dev-bypass off | Same fix as above |
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift deep** | `VERCEL_TOKEN` not in cloud | `vercel ls` or Vercel dashboard — confirm HEAD `eb5ab744` is live |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | Run `selfheal.mjs` locally if worker goes down |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — local run sends it |
| **Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | Test HMAC-gated broker locally: confirm `connectUrl`+token returned |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`, `AUDIT_ROOT=/home/user/lovable-clone`) → 5 parallel domain agents → synthesis.
Probe JSON: `qa/audit/reports/2026-09-13T11-02-33-892Z-probe.json`.
Probe overall: 10 GREEN · 6 YELLOW · 2 RED.
