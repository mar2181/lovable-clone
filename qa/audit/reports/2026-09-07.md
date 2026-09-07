# HS Web App Builder — Audit Report

**Date:** 2026-09-07T11:20Z · **Run:** #16 (scheduled, 3-day cadence) · **Mode:** cloud / secret-free
**Overall: 🔴 RED** — Two chronic P0 outages (dashboard + voice box) entering month 3+. Build engine untestable in cloud since P1 security fix. Infrastructure healthy.

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 6 domains  |  Auto-healed: none (no cloud creds for operational fixes)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 (CHRONIC, day ~90) — `/dashboard` returns 404

Live: `GET https://hswebappbuilder.space/dashboard` → HTTP 404 (Next.js not-found, no redirect).

**Root cause:** Vercel deployment is serving a build that does not include the dashboard route, OR the deployment failed silently. The code is correct — `app/dashboard/page.tsx` exists, `npm run build` produces `/dashboard` as a static route (confirmed this run, 0 TS errors). This is a Vercel hosting issue only.

**First seen:** 2026-06-08 (audit PR #27). Has appeared in every audit for 90 days.

**Fix:** Check Vercel dashboard for a failed deployment, then trigger a fresh deploy of `master` HEAD (`eb5ab74`). If the deploy succeeds and /dashboard still 404s, check if `NEXT_PUBLIC_DEV_BYPASS_AUTH` being unset causes Clerk middleware to fall through to not-found instead of redirecting to `/sign-in`.

---

### P0 (CHRONIC, day ~63) — Voice box unreachable

Live: `GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → HTTP 404 (empty body).

TLS handshake succeeds (RunPod reverse-proxy is up); the pod process inside the container is not responding. First confirmed down: ~2026-07-06 (audit PR #39). Wiring in `next.config.ts` (`/boxapi` → RunPod host) and `components/pet-concierge.tsx` (`data-backend="selfhosted"`, `/boxapi`) are both correct — this is an operational pod failure only.

**Fix (requires RunPod dashboard or API key):**
1. Log into RunPod → pod `udcz4k7kse1zw6` — check state (EXITED / ERROR).
2. Restart pod; wait for RUNNING.
3. Hit `POST <box>/dashboard/agent/restart` if the pod boots but the voice server doesn't come up.
4. Re-verify: `/healthz` → `{"ok":true}`.

> Per policy.md this would be auto-fixed if `RUNPOD_API_KEY` were available in the cloud run. It is not. Skipped.

---

### P1 (AUDIT PROCESS) — Build engine E2E untestable from cloud

The P1 security fix applied ~2026-08-09 (`d511723`) correctly set `ENVIRONMENT=production` and removed `DEV_BYPASS_AUTH` from `worker/wrangler.toml [vars]`. Side-effect: `Bearer dev-local-user` now 401s on every authenticated worker endpoint, so `qa/audit/audit-probe.mjs` (line 137) and this audit's E2E build test both fail at step 1 (`POST /api/projects`).

Worker infrastructure is healthy (`/health` → 200, `/api/spec.json` → 200, anon route → 401 correct). But the AI build pipeline (OpenRouter credits, SSE streaming, file generation) has not been verified since **2026-06-07 — 92 days ago**.

**Fix — provision an audit credential:**
```bash
# Generate a long-lived MCP_API_KEY for cloud audit use
cd worker
wrangler secret put AUDIT_API_KEY  # enter a long random value
```
Then update `qa/audit/audit-probe.mjs` line 137 to use `X-API-Key: <AUDIT_API_KEY>` (or add the deep build test to accept it), and add `AUDIT_API_KEY` to the cloud scheduled agent environment. Do NOT use `dev-local-user` — that bypass is correctly dead.

---

### P2 — 35 HIGH npm vulnerabilities (74 total across all roots)

GitHub Dependabot full-repo scan: **74 vulnerabilities** (35 high, 35 moderate, 4 low) across all three package roots (root, `worker/`, `mcp-server/`). Local `npm audit` in root only shows 8 HIGH / 16 total — the higher count reflects the worker and mcp-server packages. Two Dependabot PRs remain unmerged that would reduce this:

- **PR #28** (`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`) — "bump npm_and_yarn group across 3 directories with 2 updates" — open **79 days**.
- **PR #47** (`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`) — "bump fast-uri 3.1.2→3.1.4 in /mcp-server" — open **47 days**.

**Fix:** Review and merge both PRs from GitHub.

---

### P2 — `middleware.ts` deprecated (rename to `proxy.ts`)

`npm run build` emits: `The 'middleware' file convention is removed in Next.js 16+. Rename to 'proxy'.` Reference: https://nextjs.org/docs/messages/middleware-to-proxy

**Fix (repo edit — flag):** `git mv middleware.ts proxy.ts`, update any imports, redeploy. Low urgency but will become a hard break on next Next.js major.

---

### P2 — `setState` called synchronously inside `useEffect`

Two instances found by ESLint:
- `components/editor/preview-panel.tsx:647`
- `components/pet-concierge.tsx:67`

Cascading render risk — can cause infinite loops under concurrent rendering. Wrap the setState call in a condition or move the state update to an event handler.

---

## 🔧 Auto-healed this run
**None.** Both P0s require RunPod API key (pod restart) or Vercel token (deploy trigger), neither available in the cloud run.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), anon → 401 (correct auth gate) |
| **Frontend homepage** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 |
| **Frontend build** | 🟢 GREEN | `next build` (Turbopack 16.2.6): 0 TS errors, 6 routes, 12.3s. `/dashboard` in build output. |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated) |
| **Sandpack unit guards** | 🟢 GREEN (×2) | `test-sandpack-alias.ts`: 5/5 · `test-sandpack-assets.ts`: 9/9 PASS |
| **Security — dev bypass** | 🟢 RESOLVED | `Bearer dev-local-user` → 401 in prod. `wrangler.toml`: `ENVIRONMENT=production`, `DEV_BYPASS_AUTH` absent. `auth.ts` devBypassEnabled=false. |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; `git ls-files` returns empty. |
| **Pet-concierge wiring** | 🟢 GREEN | `pet-concierge.tsx`: `data-backend="selfhosted"`, `data-connect-url="/boxapi"`. `next.config.ts`: `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net`. Chain intact (pod is down, wiring is not the bug). |
| **auth.ts middleware** | 🟢 GREEN | `devBypassEnabled = ENVIRONMENT==="development" \|\| DEV_BYPASS_AUTH==="1"` → both false in prod. `isOwner=false` on bypass path. |
| **CORS** | 🟢 GREEN (carry-forward) | `worker/src/index.ts` exact-match origin allowlist, `credentials:true`. Not re-verified this run. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **PR #20 (builder-buddy-rail)**: open since 2026-06-03, **96 days**. Feature: docked Space Mario assistant rail. No updates since 2026-06-04. With voice box down for 63 days, the voice component it adds is currently non-functional. Recommend: close or rebase after voice box is restored, then review.
- **ESLint: 157 errors / 79 warnings** (236 total) — mostly `@typescript-eslint/no-explicit-any` in `worker/src/`. `npm run lint -- --fix` clears 2 auto-fixables. Accumulating tech debt.
- **`fetchTemplates` before declaration**: `components/dashboard/template-picker.tsx:80` — hooks ordering violation (was flagged in 2026-06-07 report, still present).
- **`package.json` missing `"type":"module"`**: Node.js reparse warning on every `--experimental-strip-types` run (cosmetic, not a functional bug).
- **Pod billed 24/7**: No idle-shutdown controller. `active_sessions:0` for 63+ days of billing.
- **Telegram/SMS**: `/api/share/health` → `telegram:false, sms:false`. Audit notifications arrive only via GitHub PR. Telegram would give faster mobile alert.
- **`GET /api/projects/<deleted-id>`** returns HTTP 200 `{"error":"Project not found"}` — should be 404.
- **Worker typecheck**: Not re-verified this run; was confirmed present in 2026-06-07 audit.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

**Non-master, non-audit branches:**

| Branch | Age | What | Recommendation |
|---|---|---|---|
| **`claude/builder-buddy-rail`** (PR #20) | 96 days | Docked Space Mario rail | **REVIEW AFTER VOICE BOX RESTORED** — feature depends on live pod; merging while box is down adds untestable code. |
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** (PR #28) | 79 days | npm group bump across 3 dirs | **MERGE** — routine dep bump, reduces vuln count |
| **`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`** (PR #47) | 47 days | fast-uri 3.1.2→3.1.4 in mcp-server | **MERGE** — patch security bump |

**Cleaned up since last report (2026-06-07):**
`fix/sanitizer-icon-imports`, `archive/windows-side-2026-05-11`, `backup/pr13-pre-resolve-2026-05-12` — all gone ✅

**Open audit PRs**: 15+ (PRs #27–#73) — all stale report branches. Can be batch-closed by the `gh pr close` loop; no code to preserve.

---

## Δ vs 2026-09-04 (previous run)

| Item | Direction | Detail |
|---|---|---|
| Dashboard 404 | 🔴 PERSISTS (day ~90) | No change |
| Voice box down | 🔴 PERSISTS (day ~63) | No change |
| P1 dev bypass | ✅ RESOLVED (confirmed again) | ENVIRONMENT=production, no DEV_BYPASS_AUTH |
| Vuln count | ⚠️ 35 HIGH / 74 TOTAL | GitHub full-repo scan: 35 HIGH (vs last report's 33). Root-only npm audit shows 8 HIGH (frontend) — worker+mcp roots add 27 more HIGH. 2 dependabot PRs still unmerged. |
| Build engine | ⚠️ STILL UNVERIFIED | Last GREEN: 2026-06-07. Audit credential gap confirmed. |
| ESLint / hooks bugs | 🔄 UNCHANGED | fetchTemplates, setState-in-effect still present |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | Local command |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` absent | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Worker self-heal (redeploy)** | `CLOUDFLARE_API_KEY` absent | `cd worker && wrangler deploy` — not needed (worker is up) |
| **Vercel deploy-drift** | `VERCEL_TOKEN` absent | Check Vercel dashboard: is `eb5ab74` deployed? |
| **Build engine E2E** | No cloud audit credential (see P1 above) | Provision `AUDIT_API_KEY` wrangler secret, add to cloud env |
| **Telegram notification** | No token in cloud | `POST /api/share/phone` or `notify_mario()` locally |
| **Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | Test locally once box is restarted |

---

*Probe JSON: `qa/audit/reports/latest-probe.json` · Report produced by cloud audit agent (session_01WDsCPrmdvVSw2EuhJqXKsC)*
