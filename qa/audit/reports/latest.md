# HS Web App Builder — Audit Report

**Date:** 2026-10-16T11:14Z · **Run:** #15 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky  
**Overall: 🔴 RED** — four P0/P1 items persist unresolved; MCP_API_KEY committed (day 3), 123 GitHub security vulns (6 critical), dashboard 404 day ~130, voice box day ~101.

> Probe: 6 GREEN · 9 YELLOW · 2 RED | Deep audit: 6 domains | Auto-healed: none (cloud run; RUNPOD_API_KEY unavailable)

---

## 🚩 Needs Mario (ranked P0 → P1 → P2 → P3)

### P1 🔑 — MCP_API_KEY hardcoded in `mcp-server/lovable.sh` [PERSISTS — day 3, unresolved since Oct 13]

**Confirmed live today.** `mcp-server/lovable.sh` line 6:
```bash
API_KEY="${MCP_API_KEY:-d821bb15d17bd44b19f41f0d68925eb917724a18b82521b1b3d3da809f9b1c73}"
```
This key is the `MCP_API_KEY` path in `worker/src/middleware/auth.ts` lines 46–55 — it grants `isOwner: true`, full operator privileges: arbitrary Supabase Management SQL, GitHub PAT pushes, Vercel prod deploys, Twilio SMS. The repo is public. **Anyone can extract this key from git history and impersonate the owner in production.**

**Fix (ROTATE IMMEDIATELY — confirm-first per policy.md):**
1. Generate a new random 64-char hex key — do NOT reuse the committed value.
2. `cd worker && wrangler secret put MCP_API_KEY` (new value).
3. Update `mcp-server/lovable.sh` line 6: remove the fallback default, use `${MCP_API_KEY:?MCP_API_KEY is required}` — fail loudly if unset.
4. The committed key is permanently in git history — also rotate Supabase PAT, GitHub PAT, and any credential that key could have been used to extract.
5. Purge from git history: `git filter-repo --path mcp-server/lovable.sh --invert-paths` then re-add with no secret, OR use BFG Repo Cleaner.

---

### P0 🌐 — Dashboard `/dashboard` returns cached 404 (day ~130) [PERSISTS — root-caused in Oct 13 report]

`/dashboard` → HTTP 404 with `x-vercel-cache: HIT`. Confirmed today:
```
HTTP/2 404
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-matched-path: /404
x-vercel-cache: HIT
```

**Root cause (from Run #14):** Clerk's `auth.protect()` in `middleware.ts` uses a `protect-rewrite` path for non-browser requests (missing `Sec-Fetch-Dest: document` / `text/html` Accept). Vercel's edge CDN cached the resulting 404 response. Age: 1,052,270s+ on Oct 13; the edge-cached 404 continues to serve for all visitors.

**Fix (three steps, all required):**
1. **Patch `middleware.ts`** — replace `await auth.protect()` with an explicit redirect to avoid the rewrite edge case:
   ```ts
   const { userId } = await auth()
   if (!userId) {
     const signInUrl = new URL('/sign-in', request.url)
     signInUrl.searchParams.set('redirect_url', request.url.toString())
     return NextResponse.redirect(signInUrl)
   }
   ```
   Alternatively: `await auth.protect({ unauthenticatedUrl: '/sign-in' })` — same effect.
2. **Set Vercel env vars** (currently missing): add `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` in Vercel project settings. Without these, Clerk `createRedirect()` builds an invalid URL → falls through to the cached rewrite.
3. **Purge Vercel CDN cache** — after deploying the fix, use Vercel dashboard "Purge Cache" or trigger a full redeploy; the edge-cached 404 will otherwise continue to serve until TTL expires.

The `/sign-in` page itself works correctly (200, `x-matched-path: /sign-in/[[...sign-in]]`). The app route `app/dashboard/page.tsx` exists in the repo. This is purely a routing/cache fix.

---

### P0 🎙️ — Voice box pod DOWN (day ~101) [PERSISTS]

`https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → HTTP 404. The RunPod proxy responds (not connection-refused) but the process on port 7860 is not running. All voice/concierge features are non-functional.

**Wiring is correct and unchanged** (verified today):
- `components/pet-concierge.tsx` line 99: `data-backend="selfhosted"` ✅
- `components/pet-concierge.tsx` line 100: `data-connect-url="/boxapi"` ✅
- `next.config.ts` line 13: `/boxapi/:path*` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` ✅

**Fix:** Log into RunPod dashboard → restart pod `udcz4k7kse1zw6`. After restart, verify:
- `GET /healthz` → `{"ok":true}`
- `tools.count` ≥ 18
- `tts.voices` includes `[will, jack]`

RUNPOD_API_KEY is absent in cloud — auto-restart not attempted per policy.md.

---

### P2 🔧 — Build engine E2E unverifiable from cloud (side effect of P1 security fix) [PERSISTS — run 7+ blocked]

The auth hardening (`ENVIRONMENT=production`, no `DEV_BYPASS_AUTH`, per `wrangler.toml` SECURITY comment dated 2026-08-09) correctly rejects `Bearer dev-local-user` in prod (401). Cloud audit cannot create projects or trigger builds without the `MCP_API_KEY` or a Clerk JWT.

Worker `/health` → 200 ✅ (process alive). Last confirmed successful E2E: 2026-06-07 (22 files, `build_complete`). Build engine state has been unknown for ~131 days.

**Fix:** Provision a scoped `AUDIT_API_KEY` worker secret with only project-create/build/delete permissions for cloud audit use. Until then, run locally: `POST /api/projects` + `POST /api/build/<id>` with a real Clerk JWT or a temporary `wrangler secret put DEV_BYPASS_AUTH` (re-enabling bypass only for the test window, then remove it).

---

### P1 📦 — 123 GitHub security vulnerabilities on master (6 critical) [ESCALATED from P2]

**Confirmed at push.** GitHub Advisory Database (GHSA) reports at push time:
> "GitHub found 123 vulnerabilities on mar2181/lovable-clone's default branch (6 critical, 45 high, 62 moderate, 10 low)."

Local `npm audit` (lock file only) reports 56 total / 28 critical+high+moderate (2 critical, 17 high, 9 moderate). The higher GitHub count includes transitive deps not surfaced by npm's advisory registry. **6 critical is an escalation from 2 critical in Oct 13.** Details at: https://github.com/mar2181/lovable-clone/security/dependabot

Two Dependabot PRs have been open since June/July (PRs #28 and #47 — see GitHub reconciliation section). **Merging these will reduce the count.**

**Fix:** Review `https://github.com/mar2181/lovable-clone/security/dependabot` to see all 123 advisories. Accept Dependabot PRs #28 and #47 immediately (safe lock-file bumps). For remaining critical vulns, run `npm audit fix` locally, check for breaking changes, then `npm ci && npm run build` before pushing.

---

### P3 — Dead dev-bypass code block in `auth.ts` [from Oct 13 follow-up]

`worker/src/middleware/auth.ts` lines 63–84 contain the commented dead code path for dev-bypass. With `ENVIRONMENT=production`, the code never runs but a future wrangler.toml edit could accidentally re-enable it. The Oct 13 comment explicitly marks it for removal.

**Fix (repo edit — flag):** Remove the dead block once the P1 MCP_API_KEY rotation is confirmed stable (same deploy window).

---

## 🔧 Auto-healed this run

**None.** No operationally-fixable RED was reachable: RUNPOD_API_KEY absent (box restart blocked). All P0/P1 fixes require Mario action per policy.md.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (gated correct) |
| **Auth hardening** | 🟢 GREEN (RESOLVED) | `Bearer dev-local-user` + `GET /api/credits` → 401 `{"error":"Unauthorized"}`. P1 fully resolved since 2026-08-09. |
| **GitHub import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated) |
| **Sandpack unit guards** | 🟢 GREEN | All 14 checks passed: 5 alias (A–D + robustness) + 9 asset (A–H + robustness) |
| **Pet-concierge wiring** | 🟢 GREEN | `data-backend=selfhosted`, `data-connect-url=/boxapi`, next.config.ts → RunPod URL all intact |
| **Security: `.dev.vars`** | 🟢 GREEN | Root `.gitignore` line 52 covers `worker/.dev.vars`. `git check-ignore` exits 0. File not present in checkout. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 |
| **Sign-in page** | 🟢 GREEN | `/sign-in` → 200, `x-matched-path: /sign-in/[[...sign-in]]` |

---

## 🗂 GitHub Reconciliation

### Dependabot PRs (2 open, both stale)

| PR | Branch | Age | Summary | Recommendation |
|---|---|---|---|---|
| **#28** | `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` | ~4 months (Jun 19) | Bump 2 packages across 3 dirs | **BRING IN** — lock-file-only, safe upgrades; addresses some of the 56 vuln count |
| **#47** | `dependabot/npm_and_yarn/mcp-server/npm_and_yarn-04db377a11` | ~3 months (Jul 21) | fast-uri 3.1.2 → 3.1.4 in /mcp-server | **BRING IN** — minor security patch, no API changes |

### Feature / work-in-progress branches

| Branch | PR | Recommendation |
|---|---|---|
| `claude/builder-buddy-rail` | — | **REVIEW** — previous reports flip-flopped IGNORE↔BRING IN as pod URL changed. Re-assess: does it still track current pod URL? |

### Old audit report branches (39 branches, `audit/report-2026-*`)

All pushed by this automated audit, never merged to master (by design). No action needed operationally. **ARCHIVE (optional):** if the branch list is cluttering the UI, `git push origin --delete audit/report-2026-06-*` etc. in batches (reports exist on branch + in PRs, safe to delete remote branches). PRs will remain open for record-keeping.

---

## Δ vs Run #14 (2026-10-13)

| Item | Oct 13 | Oct 16 | Change |
|---|---|---|---|
| P1 MCP_API_KEY committed | 🔴 NEW (day 0) | 🔴 PERSISTS (day 3) | **No fix** |
| P0 Dashboard 404 | 🔴 Day ~127 | 🔴 Day ~130 | **No fix** |
| P0 Voice box down | 🔴 Day ~98 | 🔴 Day ~101 | **No fix** |
| P1 dev-bypass-prod | ✅ RESOLVED | ✅ RESOLVED | Stable |
| P2 Build E2E cloud | 🟡 Blocked run 4+ | 🟡 Blocked run 7+ | No change |
| GitHub vulns | 28 critical/high/mod (local) | 123 total / 6 critical (GitHub GHSA) | **ESCALATED — 6 critical (was 2)** |
| Unit guards | 🟢 14/14 | 🟢 14/14 | Stable |
| Worker infra | 🟢 GREEN | 🟢 GREEN | Stable |

**New this run:** Nothing new. All findings are carries from Run #14.

---

## 🔕 Checks SKIPPED (cloud creds absent — run locally to cover)

| Check | Why skipped | Local command |
|---|---|---|
| RunPod pod power state | No `RUNPOD_API_KEY` | `curl -s -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| Voice box restart / self-heal | No `RUNPOD_API_KEY` | RunPod dashboard → pod udcz4k7kse1zw6 → Restart |
| Vercel deploy drift | No `VERCEL_TOKEN` | Vercel dashboard or `vercel ls` |
| Worker auto-redeploy self-heal | No `CLOUDFLARE_API_KEY` | `cd worker && wrangler deploy` |
| Build engine E2E | No cloud auth token | `POST /api/build/<id>` with real Clerk JWT locally |
| `npm run build` (tsc/lint) | `node_modules` not installed in cloud | `npm ci && npm run build && npm run lint` locally |
| Telegram notification | Telegram keys absent in cloud | n/a (this report is the substitute) |
| Vercel CDN cache purge assessment | No `VERCEL_TOKEN` | Vercel dashboard → Settings → Purge Cache |
