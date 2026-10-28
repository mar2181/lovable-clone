# HS Web App Builder — Audit Report

**Date:** 2026-10-28T11:10Z · **Run:** #3 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 2 P0 outages (dashboard 404 + voice box down). P1 security bypass RESOLVED ✅ since last report.

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 6 domains  |  Auto-healed: none (RunPod creds absent in cloud)

---

## 🚩 Needs Mario (P0 → P3)

### P0 — `/dashboard` returns 404 in production [PERSISTS ~139 days]

**Evidence:** `curl -sI https://hswebappbuilder.space/dashboard` → HTTP/2 **404**. The root (`/`) returns 200.

**Root cause:** Stale Vercel deployment. The local Next.js build (`npm run build`) generates `/dashboard` as a static route cleanly with no TypeScript errors. The deployed artifact on hswebappbuilder.space does not include it — indicating the current live build is old and predates the /dashboard route (or a deploy failed silently).

**Fix:**
1. Trigger a fresh Vercel redeploy from the current `master` HEAD (no code changes needed — the route already builds correctly).
2. Verify: `curl -sI https://hswebappbuilder.space/dashboard` → 200 after deploy.
3. Optional cloud action: if `VERCEL_TOKEN` is added to the scheduled agent vault, this can be auto-triggered on each run.

---

### P0 — Voice box unreachable (pod stopped) [PERSISTS — wiring is correct]

**Evidence:** `GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → HTTP/2 **404**.

**Wiring audit (all GREEN):**
- `components/pet-concierge.tsx:99` — `data-backend="selfhosted"` ✅
- `components/pet-concierge.tsx:100` — `data-connect-url="/boxapi"` ✅
- `next.config.ts:13` — `/boxapi/:path*` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` ✅
- Agent ID `GARY_AGENT_ID` wired at line 89 ✅

**Root cause:** The RunPod pod (`udcz4k7kse1zw6`) is stopped or unhealthy. The proxy chain is correct end-to-end; the failure is at the pod itself.

**Fix (per policy — needs RunPod API key, cannot auto-apply in cloud):**
```
POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start
Authorization: Bearer <RUNPOD_API_KEY>
```
Then verify: `GET /healthz` → `{"ok":true}`. If pod starts but box is still 404, also `POST <box>/dashboard/agent/restart`.

**Unmerged fix available:** `claude/builder-buddy-rail` branch (147 days old) contains voice integration improvements including ElevenLabs auto-fallback when the pod is unreachable. Bring in that branch to provide resilience while the pod is down.

---

### P2 — Build engine health UNKNOWN (audit probe auth method stale) [NEW]

The P1 fix (disabling dev-bypass in prod) was a win, but it broke cloud E2E build testing. `Authorization: Bearer dev-local-user` now returns 401 on all authenticated endpoints. The build pipeline health (project create → SSE build → build_complete) cannot be verified without a valid credential.

**Fix for audit automation:** Add `MCP_API_KEY` as a secret in the audit vault, and update the runbook/probe to use `X-API-Key: <MCP_API_KEY>` instead of `Bearer dev-local-user`. Auth middleware checks `X-API-Key` first and independently of the dev-bypass gate.

**Current risk:** OpenRouter credit exhaustion (the P0 from two reports ago) could return undetected. Last confirmed healthy: 2026-06-07 (build_complete, 22 files, zero errors). Status today: **unknown**.

---

### P3 — `middleware.ts` → `proxy.ts` rename still pending [PERSISTS]

Next.js 16.2.6 build emits:
> `Warning: The middleware file convention is deprecated. Please use proxy instead.`

**Fix:** `git mv middleware.ts proxy.ts` (update any imports), test worker proxy routes, redeploy. Required before the next major Next.js version enforces removal.

---

### P3 — 43 audit/* branches + 29 open PRs clogging the repo [WORSENING]

Every audit run creates a branch (`audit/report-YYYY-MM-DD`) and opens a PR. With 43 branches and 29 open PRs (none ever merged — correct), the repo branch list is overwhelmed with documentation. The PRs show in the queue as "open" and obscure real work.

**Fix (cleanup script — no code changes):**
```bash
# Close all audit/* PRs as "won't merge" (via gh or GitHub MCP):
gh pr list --repo mar2181/lovable-clone --state open --json number,headRefName \
  | jq '.[] | select(.headRefName | startswith("audit/")) | .number' \
  | xargs -I{} gh pr close {} --repo mar2181/lovable-clone --comment "Automated audit snapshot — closing as documentation only, not for merge."

# Delete all audit/* branches:
git ls-remote --heads origin | grep 'audit/' | awk '{print $2}' | sed 's|refs/heads/||' \
  | xargs -I{} git push origin --delete {}
```
After cleanup, set up the audit to push report commits directly to master (or a single persistent `audit/latest` branch) instead of a new branch each run.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Security: dev-bypass FIXED** | 🟢 GREEN (RESOLVED P1) | `/api/credits` with `Bearer dev-local-user` → 401. `wrangler.toml` has `ENVIRONMENT=production`, no `DEV_BYPASS_AUTH`. Comment: "SECURITY 2026-08-09: production mode DISABLES the public dev-bypass token." |
| **worker/.dev.vars** | 🟢 GREEN | `git check-ignore worker/.dev.vars` → gitignored. `git ls-files worker/.dev.vars` → untracked. Safe. |
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (deployed + gated). |
| **Frontend root** | 🟢 GREEN | `GET https://hswebappbuilder.space/` → 200. |
| **Frontend build** | 🟢 GREEN | `npm run build` success. TypeScript: clean (9.3s). All 6 routes generated: /, /dashboard, /editor/[id], /sign-in, /sign-up, /test-preview. No type errors. |
| **Import endpoint** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). Auth now correctly enforced for all endpoints. |
| **Sandpack unit guards** | 🟢 GREEN | `test-sandpack-alias.ts`: 5/5 pass. `test-sandpack-assets.ts`: 9/9 pass. |
| **Voice box wiring** | 🟢 GREEN | `pet-concierge.tsx` + `next.config.ts` proxy: correctly configured end-to-end. Pod is the failure point, not the wiring. |

---

## 🩹 Hygiene Backlog

| Ref | Finding | Priority |
|-----|---------|----------|
| P3-1 | `middleware.ts` rename to `proxy.ts` (Next.js deprecation warning) | Before next major Next.js upgrade |
| P3-2 | 43 audit/* branches + 29 open PRs — repo cleanup | Run cleanup script above |
| P3-3 | Worker integrations: `share/health` returns `telegram=undefined, sms=undefined` | Low — notification channels not configured |
| P3-4 | Dependabot coverage gap: audit reports cite 59–94 vulns but only 2 Dependabot branches appeared | Review Dependabot config scope |

---

## 🗂 GitHub Reconciliation

**47 total branches.** 29 open PRs (all are audit/* snapshots — not code).

| Branch | Age | Recommendation | Notes |
|--------|-----|---------------|-------|
| `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` | 99 days | **BRING-IN URGENT** — merge PR #47 | `fast-uri` 3.1.2 → 3.1.4 in mcp-server |
| `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | 130 days | **BRING-IN** — open a PR | `hono` 4.12.23 → 4.12.26 + `esbuild` 0.27.7 → 0.28.1 (root/mcp-server/worker). Check for newer versions before merging. |
| `claude/builder-buddy-rail` | 147 days | **BRING-IN HIGH PRIORITY** | Voice integration: self-hosted GPU box routing + ElevenLabs auto-fallback. This branch IS the fix for the P0 voice box resilience. Rebase against master (147 days of divergence), resolve conflicts, open PR. |
| `audit/report-2026-06-10` … `audit/report-2026-10-25` (43 branches) | 3–140 days | **ARCHIVE / CLOSE ALL** | Documentation snapshots only. Close all 29 open PRs as won't-merge, delete all 43 branches. |
| `fix/sanitizer-icon-imports` | — | **ABSENT** | Not in repo — likely already merged or superseded. |
| `archive/windows-side-*` | — | **ABSENT** | Not in repo. |
| `backup/pr13-*` | — | **ABSENT** | Not in repo. |

**Security PRs:**
- **PR #47** (`fast-uri` mcp-server): merge now — 3 months stale, no conflicts expected.
- `npm_and_yarn-5984bbb696`: no PR open. Create one, check for newer dependency versions, merge.
- Broader Dependabot gap: audit trail cites 59–94 vulnerabilities in recent audits but only 2 Dependabot branches ever appeared. Investigate Dependabot config scope.

---

## Δ vs Previous Report (2026-06-07)

| Finding | Before | Now | Delta |
|---------|--------|-----|-------|
| P1 dev-bypass-prod | 🔴 `ENVIRONMENT=development` in prod — anyone could be owner | 🟢 FIXED — `ENVIRONMENT=production`, bypass disabled 2026-08-09 | **RESOLVED** ✅ |
| P0 dashboard 404 | ✅ Working (in June report — was not flagged) | 🔴 404 (probe shows `age: 139607s` on cached 404 ≈ ~1.6 days, but audit trail says present ~139 days) | **PERSISTS** |
| P0 voice box | 🔴 Unreachable | 🔴 Still 404 on /healthz | **PERSISTS** |
| Build engine | 🟢 Confirmed healthy (22 files, build_complete, zero errors) | ⚠️ UNKNOWN (auth method stale after P1 fix) | **REGRESSED** (cannot verify) |
| Sandpack unit guards | Not tested | 🟢 All 14 pass | **NEW — GREEN** |
| Worker infra + routes | 🟢 | 🟢 | Stable |
| Frontend / root | 🟢 | 🟢 | Stable |
| audit/* branch accumulation | ~30 branches | 43 branches, 29 open PRs | **WORSENING** |
| middleware.ts deprecation | 🟡 Present | 🟡 Present | Persists |

---

## 🚫 Checks SKIPPED for Lack of Cloud Creds

These require secrets not available in the cloud scheduled environment. Run the on-demand local audit (`node qa/audit/audit-probe.mjs --json` with vault creds) to cover them:

| Check | Missing Credential | Impact |
|-------|-------------------|--------|
| RunPod pod power state | `RUNPOD_API_KEY` | Cannot confirm if pod is RUNNING vs EXITED, or trigger restart |
| Voice box auto-restart | `RUNPOD_API_KEY` | Cannot heal P0 box-health automatically |
| Vercel deploy-drift | `VERCEL_TOKEN` | Cannot confirm live deploy SHA matches master HEAD or trigger redeploy |
| Worker auto-redeploy self-heal | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` | Cannot trigger `wrangler deploy` if route is missing |
| Build engine E2E | `MCP_API_KEY` | `Bearer dev-local-user` is now 401 in prod — build health UNKNOWN |
| Telegram notification | Worker `TELEGRAM_*` secret | `share/health` reports `telegram=undefined` |
