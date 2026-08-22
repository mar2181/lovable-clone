# HS Web App Builder — Audit Report

**Date:** 2026-08-22T11:03Z · **Run:** #22 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 2 P0 outages persist (dashboard 404 day-75+, voice box down). P1 dev-bypass RESOLVED (fixed 2026-08-09) but **59 new GitHub vulnerabilities (25 HIGH) found on master**. Build engine health unknown (E2E test spec stale since bypass removal).

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 6 domains  |  Auto-healed: none (no cloud creds for RunPod/Vercel)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — `/dashboard` returns 404 in production [PERSISTS — day 75+]

The live site `https://hswebappbuilder.space/dashboard` returns HTTP 404. The route is **correctly compiled** in the current build (static, prerendered, appears in the Next.js route table). The build itself is clean (13.1s, zero TypeScript errors). The mismatch is at the Vercel deployment layer — the live deployment is stale.

**History:** First appeared ~2026-06-08 (PR #22); flagged every run since. Still unresolved as of PR #61 (2026-08-16).

**Fix (repo edit required → flag):**
1. Trigger a new Vercel deployment — push any trivial commit to master (e.g. a whitespace change in `README.md`) OR redeploy the current HEAD via the Vercel dashboard.
2. Confirm `https://hswebappbuilder.space/dashboard` → 200.
3. Vercel should auto-deploy on every push to master; if it did not, check the Vercel project's Git integration and any deployment error logs.

---

### P0 — Voice Box (`/healthz`) unreachable [PERSISTS — ~60+ days]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → HTTP 404 (Cloudflare proxy is live, upstream is not). The RunPod pod is stopped or the agent process is dead.

**Fix (operational, but needs RunPod API key):**
```bash
# Check pod state
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/pods/udcz4k7kse1zw6

# If EXITED/stopped: restart
curl -X POST -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start

# If RUNNING but box unreachable: restart agent
curl -X POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/dashboard/agent/restart
```

**Note:** The concierge wiring in the frontend is intact — `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `agent_id` present. The Next.js proxy `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net` is correctly configured. The only failure is the pod itself.

---

### P2 — Build engine E2E test spec stale (cannot verify build health) [NEW]

The audit's build engine E2E test uses `Authorization: Bearer dev-local-user`, which **correctly returns 401** in production as of the 2026-08-09 security fix. This means the scripted E2E check can no longer reach `/api/projects` or `/api/build`. The worker `/health` endpoint is GREEN (200) and auth logic is correct, but the build pipeline itself cannot be confirmed working or broken from a cloud agent.

**Fix:** Update the audit runbook to use `X-API-Key: <MCP_API_KEY>` (the trusted automation path, grants `isOwner=true` per `auth.ts:46-51`). The `MCP_API_KEY` is a worker secret (not in the repo). Set it in `worker/.dev.vars` and keep it in the vault for cloud audit runs.

Until then: **verify the build engine manually** after each deployment — open a project in the builder UI and confirm it generates code.

---

### P2 — GitHub Import cannot be tested (same root cause) [NEW]

`POST /api/github/import` also 401s with `Bearer dev-local-user`. Import route health is confirmed deployed (`/api/github/import` anon → 401 = correct gating). Functional import E2E needs the same `X-API-Key` fix above. Both sandpack unit guards pass (5/5 alias, 9/9 assets).

---

### P1 — 59 Dependabot vulnerabilities on master (25 HIGH) [ESCALATED]

GitHub push scan reports: **59 vulnerabilities on `master` — 25 HIGH, 31 moderate, 3 low**.

This is a sharp escalation from the "10 moderate" noted in the June 2026 reports. The two open Dependabot PRs (#28, #47) cover only 2 of these bumps; 57 more advisories remain unaddressed.

**Fix immediately:**
1. Review `https://github.com/mar2181/lovable-clone/security/dependabot`
2. Accept all Dependabot PRs for safe lock-file-only upgrades (especially the 25 HIGH severity ones).
3. For any that require manual resolution, create patch PRs promptly.

---

### P2 — Two Dependabot PRs unmerged (32 and 63 days old) [PERSISTS]

| PR | Branch | Age | What it bumps |
|---|---|---|---|
| #28 | `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | 63 days | npm_and_yarn group × 3 directories, 2 updates |
| #47 | `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` | 32 days | `fast-uri` 3.1.2 → 3.1.4 in /mcp-server |

**Fix:** Review and merge both (they are lock-file-only Dependabot bumps, typically safe). Check the Dependabot security advisory for PR #28 to confirm severity.

---

### P3 — `middleware.ts` → `proxy.ts` rename needed [PERSISTS]

`next build` emits: *"Warning: 'middleware' file convention is deprecated. Use 'proxy' instead."* (Next.js 16.2.6). Will become a hard break in the next major Next.js upgrade.

**Fix (repo edit — flag):**
```bash
git mv middleware.ts proxy.ts   # update any imports referencing it
npm run build                    # confirm no errors
git commit -m "chore: rename middleware.ts to proxy.ts (Next.js 16 deprecation)"
```

---

### P3 — ESLint: 157 hard errors accumulating [PERSISTS, slightly worse]

`npm run lint` reports **157 errors + 79 warnings = 236 total problems** (was 130+ errors in June). Primary categories:
- `@typescript-eslint/no-explicit-any` — dominated by `worker/src/routes/` and `components/`
- `prefer-const` in `build-orchestrator.ts:263`
- Unused vars, missing `useEffect` deps, `<img>` vs `<Image />`
- 2 errors auto-fixable with `--fix`

Lint is **not gating the build** — this has silently worsened by ~27 errors since June.

---

## 🔧 Auto-healed this run
**None.** No cloud creds for RunPod (pod restart) or Vercel (deploy trigger). Per policy.md: flagged for Mario.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (deployed + gated). |
| **Frontend HTTP (root)** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build** | 🟢 GREEN | `next build` (Next.js 16.2.6 Turbopack) clean in 13.1s; TypeScript: 0 errors. 6 routes including /dashboard prerendered. |
| **Pet concierge wiring** | 🟢 GREEN | `data-backend="selfhosted"`, `data-connect-url="/boxapi"`, `agent_id` present in `components/pet-concierge.tsx`. |
| **BoxAPI proxy config** | 🟢 GREEN | `next.config.ts /boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` — exact match. |
| **Security: dev-bypass** | 🟢 GREEN (RESOLVED) | `GET /api/credits` with `Bearer dev-local-user` → **401**. `wrangler.toml` sets `ENVIRONMENT=production`; `DEV_BYPASS_AUTH` absent. Fixed 2026-08-09. |
| **Security: .dev.vars** | 🟢 GREEN | `.gitignore` covers `worker/.dev.vars`; `git ls-files worker/.dev.vars` → empty. Not tracked, not in history. |
| **Security: wrangler.toml** | 🟢 GREEN | No `DEV_BYPASS_AUTH` or `ENVIRONMENT=development` in `[vars]`. |
| **Import route deployed** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). |
| **Sandpack alias unit guard** | 🟢 GREEN | 5/5 checks pass. |
| **Sandpack assets unit guard** | 🟢 GREEN | 9/9 checks pass. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **Pod billed 24/7 idle** — voice box pod running (or being billed while stopped depending on RunPod tier) with `active_sessions:0`. No idle-watcher/sleep controller. ~$500/mo if left always-on.
- **Telegram/SMS** — `/api/share/health` → `telegram:undefined, sms:undefined`. In-app phone sharing is dark.
- **npm outdated**: 10.9.7 installed, 12.0.2 available. Not blocking but 2 major versions behind.
- **22 stale `audit/report-*` branches** on origin — by design (each run creates one). Consider a periodic prune of branches older than 30 days: `git push origin --delete audit/report-<old>`.
- **`GET /api/projects/<deleted-id>`** → 200 `{"error":"…"}` should be 404. Cosmetic.
- **Next.js workspace warning** — stray `/home/mario/package-lock.json` confuses Turbopack workspace root detection.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch / PR | Age | What it is | Recommendation |
|---|---|---|---|
| **PR #20 `claude/builder-buddy-rail`** | 79 days | Docked Space Mario assistant rail — builder right-panel, voice + EL fallback, live pod endpoint | **REVIEW AND MERGE or CLOSE** — 79 days without action. If the feature is still wanted, rebase on current master and merge; otherwise close the PR and archive the branch. |
| **PR #28 `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** | 63 days | Dep bump × 3 dirs | **MERGE** — routine Dependabot security bump, 63 days old. |
| **PR #47 `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`** | 32 days | fast-uri 3.1.4 in /mcp-server | **MERGE** — fast-uri patch bump, safe. |
| **22× `audit/report-*` branches** | 3-75 days | This audit's own snapshots | **BATCH DELETE** old ones (keep last 3-4). `git push origin --delete audit/report-2026-06-10 audit/report-2026-06-13 …` |

---

## Δ vs previous reports

| Item | Direction | Detail |
|---|---|---|
| **P1 dev-bypass-prod** | ✅ **RESOLVED** | Fixed 2026-08-09 — `ENVIRONMENT=production`, `DEV_BYPASS_AUTH` unset. `401` confirmed live. |
| **P0 /dashboard 404** | 🔴 PERSISTS (day 75+) | First appeared ~2026-06-08. Flagged in every report since. Stale Vercel deployment; local build is clean. Fix: trigger Vercel redeploy. |
| **P0 voice box down** | 🔴 PERSISTS (~60 days) | Box unreachable every run since ~late June. RunPod pod needs restart; no cloud creds to auto-fix. |
| **Audit E2E test spec** | 🆕 NEW / P2 | `Bearer dev-local-user` now correctly 401s everywhere. Build engine and import can't be probed. Update to `X-API-Key: <MCP_API_KEY>`. |
| **Dependabot PRs** | ⚠️ PERSISTS | PRs #28 (63d) and #47 (32d) unmerged. |
| **ESLint errors** | 🔻 WORSE | 130+ in June → 157 today. Lint not gating build. |
| **middleware → proxy** | ⚠️ PERSISTS | Still needed — next major Next.js will hard-break. |
| **Sandpack unit guards** | ✅ PASS | 5/5 alias + 9/9 assets. |
| **Security: .dev.vars** | ✅ CONFIRMED SAFE | Gitignored, not tracked. |
| **Concierge wiring** | ✅ CONFIRMED OK | Full chain intact (previously YELLOW in probe — now deep-confirmed). |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Voice box restart** | Same — `RUNPOD_API_KEY` needed | `POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start` if EXITED |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` or check Vercel dashboard; trigger redeploy to fix /dashboard 404 |
| **Build engine E2E** | `MCP_API_KEY` not in cloud env | `curl -H "X-API-Key: $MCP_API_KEY" -X POST ...` — see §Needs-Mario |
| **GitHub import live E2E** | Same — `MCP_API_KEY` needed | Same X-API-Key path |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email absent | `cd worker && wrangler deploy` (not needed this run — worker is up) |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — run locally or configure as secret |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 3 parallel deep-audit agents (build engine, frontend build + wiring, security + import + github) → this synthesis.
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (2 RED · 9 YELLOW · 6 GREEN).
