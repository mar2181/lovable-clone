# HS Web App Builder — Audit Report

**Date:** 2026-10-07T11:13Z · **Run:** #12 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — P0 Voice Box fully down; build engine E2E unverifiable in cloud (auth gap); dashboard auth misconfiguration (P2). Core worker infra healthy. P1 security RESOLVED.

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 5 of 6 domains  |  Auto-healed: none (operational fix blocked — no RUNPOD_API_KEY in cloud)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Voice Box / Pet Concierge completely down [REGRESSION from June GREEN]

`https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **HTTP 404** (empty body).
`https://udcz4k7kse1zw6-7860.proxy.runpod.net/` → **HTTP 404** (empty body).

Both the root and the health endpoint return 404, confirming the pod is stopped or the Chatterbox service inside it is not running. The wiring in the repo is correct (confirmed this run):
- `components/pet-concierge.tsx` → `data-backend="selfhosted"`, `data-connect-url="/boxapi"` ✅
- `next.config.ts` `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` ✅

**Fix (cannot auto-apply in cloud — needs RUNPOD_API_KEY):**
```bash
# 1. Wake the pod
curl -X POST -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start

# 2. Wait 30–60s, then confirm box is alive
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
# expect: {"ok":true,"build":"2026-06-06-hsreels-tts","tools":{"count":18},...}
```

---

### P2 — Dashboard auth misconfiguration: /dashboard → 404 instead of redirect to /sign-in [NEW]

`GET https://hswebappbuilder.space/dashboard` → **HTTP 404** (no `Location:` redirect).
Headers confirm: `x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing`

The Clerk middleware (`middleware.ts:18`) calls `auth.protect()` on all non-public routes. When `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is not set in the Vercel environment, Clerk falls back to a **protect-rewrite** (rewrites to the 404 page) instead of redirecting to `/sign-in`. This means:
- Unauthenticated users navigating to `/dashboard` see a confusing 404 instead of a sign-in prompt.
- Authenticated users with live Clerk sessions are unaffected.
- The route builds cleanly locally (`○ /dashboard` in Turbopack route table).

**Fix:**
1. In the Vercel project dashboard (Environment Variables), add:
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL` = `/sign-up`
   - `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` = `/dashboard`
   - `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` = `/dashboard`
2. Trigger a redeploy.
3. Verify: `curl -sI https://hswebappbuilder.space/dashboard` → `HTTP/2 307` + `location: /sign-in` (or similar).

---

### P2 — Build pipeline E2E unverifiable in cloud (audit coverage gap) [NEW]

The security fix (August 9) correctly disabled `Bearer dev-local-user` in production. **However, the audit runbook still uses this token for build engine tests** — so the most important product check (SSE `build_complete`) cannot be run in the cloud.

Worker route infrastructure is healthy:
- `/health` → 200 ✅
- `/api/spec.json` → 200 (openapi 3.1.0) ✅
- `/api/projects` anon → 401 (correct) ✅
- `/api/build/*` anon → 401 (correct, deployed) ✅

But the actual `POST /api/build` SSE stream was **not run**. This is a **coverage gap, not a confirmed outage**, but leaves the most important product function unverified.

**Fix (two options):**

**Option A — inject MCP_API_KEY into cloud env (recommended):**
```bash
# On a machine with Cloudflare credentials:
wrangler secret list --name lovable-clone-backend  # find MCP_API_KEY value
# Then add it to Claude Code remote environment as MCP_API_KEY
# Update audit runbook to use:
# -H "X-API-Key: $MCP_API_KEY" -H "X-User-Id: mcp-service-user"
```

**Option B — Clerk JWT (manual, from browser):**
Open `https://hswebappbuilder.space`, sign in, copy bearer token from `Authorization` header in DevTools, then `cd worker && node qa/audit/audit-probe.mjs --deep --token <jwt>`.

---

### P2 — GitHub import live test also blocked (same auth root cause) [NEW]

`POST /api/github/import` requires `isOwner: true` (owner-only route). `Bearer dev-local-user` now returns 401.
- Unit guards still pass: sandpack-alias 5/5 ✅, sandpack-assets 9/9 ✅
- Live import E2E unverifiable without MCP_API_KEY / Clerk JWT.
- Same fix as above (Option A or B).

---

### P3 — `middleware.ts → proxy.ts` rename [PERSISTS from June]

`npm run build` emits: `"middleware" file convention is deprecated. Rename to "proxy" to remove this warning.`

**Fix (repo edit — flag per policy):**
```bash
git mv middleware.ts proxy.ts
# update any internal references, then:
npm run build  # verify warning gone
git commit -m "fix: rename middleware.ts to proxy.ts (Next.js 16 convention)"
```

---

### P3 — 2 new Dependabot npm branches need review [NEW]

| Branch | Scope |
|---|---|
| `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | Root-level npm deps |
| `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` | `mcp-server/` sub-package deps |

These are unreviewed dependency updates. Review each via GitHub PRs and merge or close.

---

### P3 — 36 audit/report-* branches accumulating [NEW]

The audit has generated 36 branches (`audit/report-2026-06-10` through `audit/report-2026-10-04`). These will keep growing at ~10/month. Branch storage is not the right medium for audit history.

**Recommendation:** Delete all `audit/report-*` branches. The reports live in `qa/audit/reports/` on master and don't need their own branches. Running `git push origin --delete audit/report-XXXX-XX-XX` for each, or a bulk script.

---

## ✅ Verified WORKING this run

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401, `/api/build/*` anon → 401. Worker process healthy and responding. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Frontend build (local)** | 🟢 GREEN | `npm run build` clean in 12.8s; **TypeScript: 0 errors**; 6 routes built (Turbopack). |
| **Sign-in / auth flow** | 🟢 GREEN | `/sign-in` → 200; Clerk component renders correctly. DEV_BYPASS correctly off in prod. |
| **Import unit guards** | 🟢 GREEN | `test-sandpack-alias.ts` 5/5 ✅ · `test-sandpack-assets.ts` 9/9 ✅ |
| **Import route gated** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed, correctly gated). |
| **Security: dev-bypass-prod** | 🟢 GREEN (RESOLVED) | `Bearer dev-local-user` → 401 in prod. `wrangler.toml` now has `ENVIRONMENT="production"`, `DEV_BYPASS_AUTH` absent. Fixed 2026-08-09 (d511723). Auth.ts bypass code still present but `isOwner=false` and only triggers in dev. |
| **Security: .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`. Not tracked, not in history. |
| **Voice box wiring (code)** | 🟢 GREEN | `pet-concierge.tsx`: `data-backend="selfhosted"` + `/boxapi`. `next.config.ts`: `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*`. Wiring coherent — box just needs to be started. |
| **Dependabot advisories** | 🟢 GREEN (RESOLVED) | 44 advisories cleared in `5cef645`. 0 security advisories currently open on master. |

---

## 🔧 Auto-healed this run
**None.** The P0 (Voice Box down) is operationally auto-fixable per policy.md but requires `RUNPOD_API_KEY`, which is not present in the cloud environment.

---

## 🩹 Hygiene backlog (P3 — batched)

- **Pod billed 24/7** at ~$0.69/hr ≈ $500/mo with pod status unknown (no RUNPOD_API_KEY). If `active_sessions:0` continues, idle-shutdown + on-demand wake broker is still needed.
- **Telegram/SMS not configured** (`share/health` shows `telegram=undefined, sms=undefined`). In-app phone sharing is dark.
- **Audit probe coverage gap** — after the security hardening, `audit-probe.mjs` can no longer authenticate to create projects or run builds in production. The probe's `Bearer dev-local-user` approach is deprecated. Priority: inject `MCP_API_KEY` into cloud audit env before the next run so build SSE E2E can be tested.
- **claude/builder-buddy-rail** (PR branch) — still awaiting review. Was recommended BRING-IN for review since June. Age now ~4 months.
- **ESLint warnings** — 130+ `@typescript-eslint/no-explicit-any`, 80+ other warnings. Non-blocking but accumulating.
- **`GET /api/projects/<deleted-id>` returns HTTP 200 with error body** — should return 404. Cosmetic.
- **Bypass code still present in auth.ts** — while not exploitable (isOwner=false), it's a residual risk if ENVIRONMENT is misconfigured in future deploys. Remove once dev UI adopts Clerk sign-in.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD: `eb5ab74` (chat: cap AI output at 32k tokens).

New commits since June 7 audit (15 total):
- Security hardening (2 commits: dev-bypass disabled, owner-email remap)
- Auth improvements (owner-pin by Clerk subject, credit metering)
- Vercel custom domain routes (Phase B.1)
- Builder quality upgrade (Sonnet 5 default + design system)
- 44 Dependabot advisories cleared
- Phase 0: manual editor edits persisted

| Branch | Age | Recommendation | Reason |
|---|---|---|---|
| **`claude/builder-buddy-rail`** | ~4 months | **BRING IN (overdue)** | Feature branch for builder rail UI; still unreviewed. 4 months of drift from master increases conflict risk each day. |
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** | unknown | **REVIEW + MERGE** | Root npm dependency update. Review for breaking changes; merge or close. |
| **`dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11`** | unknown | **REVIEW + MERGE** | mcp-server sub-package deps. Same treatment. |
| **`audit/report-*` (36 branches)** | 2026-06-10 to 2026-10-04 | **ARCHIVE (delete all)** | Pure report snapshots; content is already in `qa/audit/reports/` on master. Growing ~10/month. |

**Open PRs:** Unknown (no GitHub API access this run). Last known: 0 open issues.

*Previously listed branches (`fix/sanitizer-icon-imports`, `archive/windows-side-2026-05-11`, `backup/pr13-pre-resolve-2026-05-12`) are gone — cleaned up. ✅*

---

## Δ vs previous report (2026-06-07)

| Item | Direction | Detail |
|---|---|---|
| **P1 dev-bypass-prod** | ✅ **RESOLVED** | `ENVIRONMENT=production` in wrangler.toml (d511723, 2026-08-09). Bearer dev-local-user → 401. |
| **44 Dependabot advisories** | ✅ **RESOLVED** | All cleared in 5cef645. |
| **fix/sanitizer-icon-imports branch** | ✅ **GONE** | Cleaned up since last run. |
| **archive/* + backup/* branches** | ✅ **GONE** | Cleaned up. |
| **Voice Box** | 🔴 **P0 REGRESSION** | Was GREEN (healthz ok, 18 tools) in June. Now fully down (404 on / and /healthz). Wiring still correct. |
| **Dashboard /dashboard** | 🔴 **P2 NEW** | Was 200 in June (DEV_BYPASS=true). Now 404 (Clerk protect-rewrite; NEXT_PUBLIC_CLERK_SIGN_IN_URL not set in Vercel env). |
| **Build pipeline** | ⚠️ **UNVERIFIABLE** | Was confirmed GREEN (22 files, build_complete) in June. Now auth-blocked (dev-local-user disabled by security fix). Need MCP_API_KEY in cloud env to re-verify. |
| **GitHub import live test** | ⚠️ **BLOCKED** | Was 201 + cleanup in June. Now owner-only route blocks dev-local-user. Unit guards still PASS. |
| **15 new master commits** | 🆕 | Security hardening, credits metering, Vercel custom domains, builder quality, manual version store. |
| **36 audit branches** | 🆕 NEW CONCERN | 0 in June report, now 36. Growing indefinitely — recommend deleting. |
| **2 new Dependabot branches** | 🆕 NEW | npm_and_yarn root + mcp-server. Need review. |
| **middleware.ts deprecation** | ⚠️ **PERSISTS** | Still emitting Next.js 16 deprecation warning. Not yet renamed. |
| **template-picker.tsx:80 hook bug** | ❓ **UNVERIFIED** | Reported in June. ESLint not run this cycle — carry forward. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **Build engine SSE E2E** | `dev-local-user` disabled; `MCP_API_KEY` not in cloud env | `curl -N -H "X-API-Key: $MCP_API_KEY" -H "X-User-Id: mario" ...` or use Clerk JWT |
| **GitHub import live test** | Same — ownerOnly route | Same fix |
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud | `vercel ls` or check Vercel dashboard — confirm `eb5ab74` deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email not in cloud | Not needed this run (worker is up). |
| **Telegram notification** | No Telegram token in cloud | `POST /api/share/phone` locally |
| **Voice Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | Test HMAC-gated broker locally |
| **ESLint** | Time budget | `npm run lint` locally (was 234 warnings in June) |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 5 parallel domain agents → synthesis.
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (2 RED / 9 YELLOW / 6 GREEN).
