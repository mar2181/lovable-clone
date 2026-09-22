# HS Web App Builder — Audit Report

**Date:** 2026-09-22T11:04Z · **Run:** #28 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 2 P0 outages persisting (voice box day 79+, dashboard day 107+). P1 security bypass RESOLVED. Build engine unverifiable from cloud (auth hardened).

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 6 domains  |  Auto-healed: none (all blocked on cloud creds)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Voice box unreachable (day 79+) [PERSISTS]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **404** (was `ok:true` in Jun 7 baseline).
Box has been unreachable since ~Jul 4. Pod may be stopped, terminated, or address changed.

**Fix:**
1. Check pod status: `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6`
2. If stopped: `POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start`
3. Verify: `GET .../healthz` → `{"ok":true}`
4. If pod terminated (404 on pod ID), reprovision and update `next.config.ts /boxapi destination` to new URL + Vercel redeploy.

Note: wiring is **correct** in code (`data-backend="selfhosted"`, `/boxapi` → `udcz4k7kse1zw6-7860.proxy.runpod.net`) — this is an operational/infra issue, not a code bug. Auto-fix blocked: no RUNPOD_API_KEY in cloud.

---

### P0 — Frontend `/dashboard` returns 404 for all visitors (day 107+) [PERSISTS]

`GET https://hswebappbuilder.space/dashboard` → **HTTP 404** with:
- `x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing`
- `x-matched-path: /404`
- `x-vercel-cache: HIT` (age: 1064430s ≈ 12 days cached)
- `server: Vercel`

Clerk's `auth.protect()` is routing unauthenticated users to `/404` instead of `/sign-in`. The route exists in the build (`○ /dashboard` — static). This is a Clerk configuration issue, not a code bug.

**Root cause:** `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is likely unset or misconfigured in Vercel environment variables. When Clerk doesn't know the sign-in URL, it falls back to a 404 rewrite.

**Fix:**
1. In Vercel dashboard → Project Settings → Environment Variables, confirm `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` is set for Production.
2. Trigger a Vercel redeploy (or it may auto-fix on next deploy).
3. Verify: `GET https://hswebappbuilder.space/dashboard` → 302 redirect to `/sign-in` for unauthenticated requests.

Frontend build is **clean** (TypeScript 0 errors, all 6 routes build successfully) — code is correct, env var is the fix.

---

### P2 — Build engine E2E UNVERIFIABLE from cloud [NEW — auth hardened 2026-08-09]

The production worker now requires `X-API-Key: <MCP_API_KEY>` or a real Clerk JWT. `Bearer dev-local-user` returns 401 (correct — the P1 security fix). The audit probe and this cloud runner **cannot verify build E2E** without the MCP_API_KEY secret.

Worker HTTP health is GREEN (`/health` → 200, `/api/spec.json` → 200), which suggests the worker is alive. But a build_complete SSE confirmation is not possible this run.

**Fix:**
1. Verify build locally: `curl -X POST /api/build/<id> -H "X-Api-Key: $MCP_API_KEY"` or via the app UI.
2. Update `qa/audit/RUNBOOK.md` to document the `X-Api-Key` auth path for automated build E2E tests.
3. Set `MCP_API_KEY` as a secret in this Claude scheduled session (or a dedicated CI secret) to restore cloud build verification.

---

### P2 — Dependabot security vulnerabilities: 4 CRITICAL + open PRs [PERSISTS]

From PR #77 title (Sep 13 report): "4 CRITICAL vulns NEW". Two Dependabot PRs remain open:
- **PR #47** (`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`): `fast-uri 3.1.2 → 3.1.4` in `/mcp-server` — **safe lock-file bump, merge recommended**
- **PR #28** (`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`): multi-dir npm_and_yarn group update across 3 directories — **review then merge**

**Fix:**
1. Check https://github.com/mar2181/lovable-clone/security/dependabot for all active alerts.
2. Merge PR #47 (safe).
3. Review and merge PR #28.
4. Address any CRITICAL advisories not yet covered by a PR.

---

### P3 — `middleware.ts` → `proxy.ts` rename still needed [PERSISTS from Jun 7]

`npm run build` still emits: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` (Next.js 16.2.6). Must be renamed before next major Next.js upgrade.

**Fix:** `git mv middleware.ts proxy.ts` → update imports → Vercel redeploy.

---

### P3 — Audit probe `dev-bypass-prod` check now miscalibrated [NEW]

The probe checks `Bearer dev-local-user` against `/api/credits` and passes when it gets 401. That's now always correct (auth hardened). But the build pipeline check (`--deep` mode) also uses this token. The runbook's RUNBOOK.md still references `Bearer dev-local-user` as the automation credential. Update RUNBOOK.md and audit-probe.mjs to use `X-Api-Key` for build E2E verification.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence this run |
|---|---|---|
| **P1 dev-bypass-prod** | 🟢 RESOLVED | `GET /api/credits` with `Bearer dev-local-user` → 401 (hardened 2026-08-09). `wrangler.toml` now has `ENVIRONMENT=production`, `DEV_BYPASS_AUTH` unset. **Major security fix confirmed.** |
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct). |
| **Worker routes deployed** | 🟢 GREEN | `/api/github/import` anon → 401 (gated + deployed). |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 |
| **Frontend build** | 🟢 GREEN | `next build` (Turbopack): TypeScript **0 errors** (7.4s). All 6 routes: `/`, `/_not-found`, `/dashboard`, `/editor/[id]`, `/sign-in`, `/sign-up`. Clean compile. |
| **GitHub Import unit guards** | 🟢 GREEN | `test-sandpack-alias.ts`: **5/5 PASS**; `test-sandpack-assets.ts`: **9/9 PASS** |
| **Security — .dev.vars** | 🟢 GREEN | `git check-ignore worker/.dev.vars` → gitignored and untracked |
| **Voice box wiring** | 🟢 GREEN | `pet-concierge.tsx`: `data-backend="selfhosted"`, `data-connect-url="/boxapi"` ✓; `next.config.ts`: `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net` ✓. Code correct — box is operationally down. |

---

## 🔧 Auto-healed this run

**None.** Both P0s require cloud creds not available in this session (RunPod for box, Vercel env-var check for dashboard). Per policy.md — flag, don't auto-fix.

---

## 🩹 Hygiene backlog (P3 — batched)

- **Pod billed when stopped?** Check RunPod billing — if pod terminated (vs. stopped) there's no cost, but capability is also gone.
- **Telegram/SMS still dark** (`/api/share/health` → `telegram=undefined`). In-app project sharing over phone undelivered.
- **`middleware.ts` → `proxy.ts`** deprecation warning persists (see Needs-Mario §P3 above).
- **ESLint warnings**: 130+ `@typescript-eslint/no-explicit-any`, 80 other warnings (unused vars, missing deps, `<img>` vs `<Image />`). Non-blocking but accumulating.
- **`GET /api/projects/<deleted-id>`** → 200 `{"error":"..."}` should be 404.
- **Audit probe needs update**: build E2E must use `X-Api-Key` not `Bearer dev-local-user` (see §Needs-Mario P3).
- **PR backlog**: 25+ stale draft audit report PRs open on GitHub. Only #47, #28 need action; rest are read-only records.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch | PR | Age | What it is | Recommendation |
|---|---|---|---|---|
| **`claude/builder-buddy-rail`** | #20 (open, non-draft) | 3.5 months | Docked Space Mario assistant rail — buddy-panel, pc-embed | **CLOSE/ARCHIVE** — Space Mario is already wired in production via `pet-concierge.tsx` (selfhosted config). This PR's work is superseded. |
| **`dependabot/npm_and_yarn/mcp-server/…`** | #47 (open) | 2 months | `fast-uri 3.1.2→3.1.4` in /mcp-server | **MERGE** — safe lock-file bump, no API changes |
| **`dependabot/npm_and_yarn/npm_and_yarn-…`** | #28 (open) | 3 months | npm_and_yarn group across 3 dirs | **REVIEW + MERGE** — check diff, then merge |

All `audit/report-*` branches: read-only records, no action needed.

---

## Δ vs previous audit (audit/report-2026-09-13, PR #77)

| Item | Direction | Detail |
|---|---|---|
| **P1 dev-bypass-prod** | ✅ **RESOLVED** | First time GREEN since baseline. 401 confirmed. Hardened 2026-08-09. |
| Voice box down | 🔴 PERSISTS | Day 79 (was day 70). No operational change. |
| Dashboard 404 | 🔴 PERSISTS | Day 107 (was day 97). No operational change. |
| 4 CRITICAL vulns (flagged Sep 13) | ⚠️ UNVERIFIED | No GitHub security API access in cloud. PR #47 and #28 open. Check Dependabot tab. |
| Build E2E verifiability | 🆕 NEW P2 | Auth hardening (good for P1) broke cloud build verification. Need MCP_API_KEY in audit runner. |
| Frontend build | 🟢 CLEAN | TypeScript 0 errors, same as previous. |
| Unit guards | 🟢 PASS | 5/5 alias, 9/9 assets, same as previous. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Build engine E2E** | `MCP_API_KEY` not in cloud env (dev-local-user disabled) | `curl -X POST /api/build/<id> -H "X-Api-Key: $MCP_API_KEY"` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` or Vercel dashboard — confirm latest master is deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | `selfheal.mjs` — not needed this run (worker is up) |
| **GitHub security advisories (CRITICAL count)** | No GitHub security tab API in MCP tools | Check https://github.com/mar2181/lovable-clone/security/dependabot |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — local run sends it |
| **Box `POST /api/connect` session test** | Box is down (P0) | Test after box restored |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → deep domain checks (parallel bash + inline) → synthesis.
Probe overall: RED (2 RED · 9 YELLOW · 6 GREEN).
Previous `latest.md` on master: 2026-06-07 (subsequent reports in draft branches only — none merged to master).
