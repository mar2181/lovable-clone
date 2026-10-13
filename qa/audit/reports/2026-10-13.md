# HS Web App Builder — Audit Report

**Date:** 2026-10-13T11:30Z · **Run:** #14 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky  
**Overall: 🔴 RED** — two P0 outages persisting 85+/110+ days, new P1 committed secret, build E2E unverifiable.

> Probe: 6 GREEN · 9 YELLOW · 2 RED | Deep audit: 6 domains | Auto-healed: none

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Dashboard /dashboard returns cached 404 (day ~110+) [PERSISTS + ROOT-CAUSED]

`/dashboard` → HTTP 404. This run **root-caused** the issue for the first time:

Clerk's `auth.protect()` in `middleware.ts` calls `createProtect()`. When a request does not carry `Sec-Fetch-Dest: document/iframe` or `text/html` in `Accept` (Vercel CDN pre-warm probes, RSC data-fetches, bot crawls), `isPageRequest()` returns `false`. The fallback calls `notFound()` → `NextjsNotFoundError` → `handleControlFlowErrors()` issues `NextResponse.rewrite('/clerk_<timestamp>')` with header `x-clerk-auth-reason: protect-rewrite`. Next.js/Vercel treated this as a 404 and **cached it**. The cached 404 is now 12+ days old (`age: 1052270s`, `Last-Modified: Thu, 01 Oct 2026`); all CDN edge nodes serve it without hitting the origin.

**Evidence:** Response headers: `x-clerk-auth-reason: protect-rewrite`, `x-matched-path: /404`, `x-vercel-cache: HIT`, `age: 1052270`.

**Fix (three steps, all required):**
1. **Fix middleware.ts** — replace `await auth.protect()` with an explicit redirect:
   ```ts
   const { userId } = await auth()
   if (!userId) {
     const signInUrl = new URL('/sign-in', request.url)
     signInUrl.searchParams.set('redirect_url', request.url.toString())
     return NextResponse.redirect(signInUrl)
   }
   ```
   (Or keep `auth.protect()` but pass `{ unauthenticatedUrl: '/sign-in' }` — same effect.)
2. **Set Vercel env vars** (not currently set): `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` in Vercel project settings. Without these, `createRedirect()` builds an invalid URL.
3. **Purge the Vercel CDN cache** — after deploying the fix, use Vercel dashboard "Purge Cache" or trigger a redeployment; the edge-cached 404 will keep serving until TTL expires or a purge is issued.

---

### P0 — Voice box pod DOWN — Space Mario/concierge broken (day ~85+) [PERSISTS]

All endpoints at `https://udcz4k7kse1zw6-7860.proxy.runpod.net` return HTTP 404: `/healthz`, `/`, `/dashboard/tools`. The RunPod proxy infrastructure responds (not connection-refused), but the pod process is not listening on port 7860.

Code wiring is **correct and unchanged**: `pet-concierge.tsx` sets `data-backend="selfhosted"` → `data-connect-url="/boxapi"` → `next.config.ts` `/boxapi/*` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net/*` (exact match, no URL drift). Last relevant commits: `faafaff` (next.config.ts cutover) and `66a79da` (pet-concierge.tsx) — no changes since.

**Fix:** Log into RunPod dashboard → restart pod `udcz4k7kse1zw6`. Confirm Chatterbox TTS / Whisper service is listening on port 7860 after restart. Verify: `GET /healthz` → `{"ok":true}`. Then check `tts.voices` includes `[will, jack]` and `tools.count` ≥ 18. (RUNPOD_API_KEY unavailable in cloud — cannot auto-fix per policy.md.)

---

### P1 — NEW: MCP_API_KEY committed in plaintext in `mcp-server/lovable.sh`

`mcp-server/lovable.sh` line 6 contains the MCP_API_KEY as a hardcoded default fallback. Per `worker/src/middleware/auth.ts` lines 46–55, the `MCP_API_KEY` path sets `isOwner: true` — full operator privilege: arbitrary Supabase Management SQL, GitHub PAT pushes, Vercel prod deploys, Twilio SMS. **Anyone with read access to this public repo or its git history can extract this key and impersonate the owner on the production worker.**

**Fix (ROTATE IMMEDIATELY — confirm-first per policy.md):**
1. Generate a new random 64-char hex key (do NOT reuse the committed value).
2. Set it as a Cloudflare Worker secret: `cd worker && wrangler secret put MCP_API_KEY` with the new value.
3. Update `mcp-server/lovable.sh` to remove the hardcoded default — use only `${MCP_API_KEY}` with no fallback, and ensure the script fails loudly if the var is unset.
4. The committed key is now permanently in git history — rotate your Supabase PAT, GitHub PAT, and any credential the MCP_API_KEY could have been used to retrieve.
5. Remove the key from git history with `git filter-repo` or BFG Repo Cleaner, or at minimum ensure the new committed version has no secret in it.

---

### P1 — security/dev-bypass-prod: FULLY RESOLVED ✅ (was #1 in last report)

`GET /api/credits` with `Bearer dev-local-user` → **401** (was: `{"tier":"unlimited","balance":9999}`).
`wrangler.toml` now has `ENVIRONMENT = "production"` (was `"development"`) and no `DEV_BYPASS_AUTH`. The two security commits (`d511723`, `e5fc9f5`, 2026-08-09) are live in prod.

> **P3 follow-up still pending:** Dead dev-bypass code block in `auth.ts` lines 63–84 has a comment explicitly calling out removal as a follow-up step. Harmless now, but a future wrangler.toml edit could re-enable it accidentally.

---

### P2 — Build E2E unverifiable in cloud (security fix side effect)

The dev-bypass auth token (`Bearer dev-local-user`) is now correctly rejected (401) in production. This prevents the cloud audit agent from creating projects or triggering builds. Worker `/health` returns 200 (process alive). Last successful E2E was 2026-06-07 (22 files, build_complete). Current build engine state is **unknown**.

**Fix (not an emergency — worker is alive):** For future cloud audits, provision a dedicated read-limited audit credential (a Clerk JWT or a scoped `AUDIT_API_KEY` with only project-create/build/delete permissions). This allows E2E verification without re-opening the public bypass. Until then, run the E2E locally: `POST /api/projects` with a real Clerk JWT.

---

### P2 — 28 npm audit vulnerabilities in frontend (2 critical)

`npm ci` reports 28 vulnerabilities: 9 moderate, 17 high, 2 critical. Master has been frozen since 2026-08-10 so no `npm audit fix` has run.

**Fix:** `npm audit` to see specifics; `npm audit fix` for lock-file-only safe upgrades. Check if any critical advisories have Dependabot PRs already open.

---

### P2 — web_search likely unavailable (TAVILY_API_KEY) [PERSISTS UNCONFIRMED]

`wrangler.toml` does not list `TAVILY_API_KEY` in its documented secrets. `.dev.vars.example` notes: "Without this, Ask mode still works but the model will return 'tool unavailable' if it tries to browse." Cannot confirm live (E2E blocked by auth).

**Fix:** After restoring the audit credential: run a chat turn forcing web search. If "unavailable": `cd worker && wrangler secret put TAVILY_API_KEY`.

---

### P3 — middleware.ts → proxy.ts rename required [PERSISTS]

Next.js 16 renamed the Middleware file convention. Build emits: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` TypeScript: 0 errors. Runtime behavior under the deprecated convention is unspecified on future Vercel runtime updates.

**Fix:** `npx @next/codemod@canary middleware-to-proxy .` (renames file + exported function; Clerk `clerkMiddleware` is compatible with the new convention). Then `wrangler deploy` / Vercel redeploy.

---

## 🔧 Auto-healed this run

**None.** Both P0s require credentials unavailable in cloud (RunPod pod restart, Vercel cache purge). Per policy.md, these are flagged, not auto-fixed.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` → 200; `/api/spec.json` → 200 (openapi 3.1.0); `/api/projects` anon → 401 (correct). |
| **Worker route-deployed** | 🟢 GREEN | `/api/projects` gated correctly; `/api/github/import` anon → 401. |
| **P1 dev-bypass FIXED** | 🟢 RESOLVED | `Bearer dev-local-user` → 401 in prod. `wrangler.toml` has `ENVIRONMENT="production"`, no `DEV_BYPASS_AUTH`. Fix is live since 2026-08-09. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200. |
| **Sandpack unit guards** | 🟢 GREEN | `test-sandpack-alias`: 5/5 pass; `test-sandpack-assets`: 9/9 pass. |
| **TypeScript** | 🟢 GREEN | `npm run build` → 0 TypeScript errors; build completes. |
| **Security — .dev.vars** | 🟢 GREEN | `git check-ignore worker/.dev.vars` confirms gitignored; `git ls-files worker/.dev.vars` → empty (not tracked). |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts` exact-match origin allowlist (not `*`). |
| **Voice box wiring** | 🟢 GREEN | Code is correct: `data-backend="selfhosted"` → `/boxapi` → `next.config.ts` → `udcz4k7kse1zw6-7860.proxy.runpod.net` (exact match, no URL drift, no recent commits changed either file). |

---

## 🩹 Hygiene backlog (P3 — batched)

- **Dead dev-bypass code block** — `auth.ts` lines 63–84 awaiting removal (comment at line 84 says so explicitly). Low risk now but maintenance trap.
- **NEXT_PUBLIC_CLERK_SIGN_IN_URL / SIGN_UP_URL not set** in Vercel project. Clerk redirect fallback will silently use empty string. Set in Vercel dashboard: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`.
- **236 lint problems** (157 errors / 79 warnings) — `@typescript-eslint/no-explicit-any` in `worker/src/services/` and templates, unused vars, missing `useEffect` deps.
- **`/projects` route does not exist** — no `app/projects/` directory. If this is a planned route, create `app/projects/page.tsx`.
- **Pod billed 24/7** — `$0.69/hr ≈ ~$500/mo` with `active_sessions:0` for 85+ days. Needs idle-shutdown + on-demand broker-wake flow.
- **Telegram/SMS not configured** — `telegram: false`, `sms: false`.
- **deploy/drift** — Vercel token absent in cloud; verify locally that `eb5ab744` is deployed.
- **pod-power** — RUNPOD_API_KEY absent; verify pod state locally via RunPod dashboard.
- **`GET /api/projects/<deleted-id>`** returns 200 with `{"error":"…"}` — should be 404.
- **master frozen 63 days** — no commits since `eb5ab744` (2026-08-10). Both P0 outages are resolvable with code changes (middleware fix + middleware→proxy rename) that could unblock progress.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

**Master HEAD:** `eb5ab744` (`chat: cap AI output at 32k tokens`, 2026-08-10) — **no new commits in 63 days**.

### Audit branches (38 total) — bulk archive recommended

38 `audit/report-*` branches have accumulated since 2026-06-10, most with open draft PRs that will never be merged. **Recommended action:** keep the last 5 (2026-09-25, 09-28, 10-01, 10-04, 10-07, 10-10, 10-13) and bulk-delete/close all older ones. This would remove ~31 branches and ~28 stale draft PRs. Command to bulk-close (run locally with gh auth):
```bash
for pr in 27 29 32 33 36 37 39 42 45 49 51 53 56 58 59 61 64 65 67 69 71 73 75 77 79; do
  gh pr close $pr --repo mar2181/lovable-clone --comment "Superseded by later audit reports"
done
```

### Feature / fix branches

| Branch | PR | Age | Recommendation | Reason |
|---|---|---|---|---|
| `claude/builder-buddy-rail` | #20 | 4+ months | **CLOSE AS SUPERSEDED** | Last updated 2026-06-04. Space Mario features landed directly on master via `faafaff`, `8cd0b87`, etc. Check if any unique code remains — if not, close and delete. |
| `fix/sanitizer-icon-imports` | #7 | 5+ months | **REBASE + CLOSE DECISION** | Real bug fix but 5 months behind master. Likely conflicts. Requires Mario's decision. |
| `archive/windows-side-2026-05-11` | none | 5+ months | **DELETE** | Self-documented parking spot, not for merge. |
| `backup/pr13-pre-resolve-2026-05-12` | none | 5+ months | **DELETE** | Superseded backup. |

### Dependabot PRs (2 open — both superseded)

| PR | Title | Recommendation |
|---|---|---|
| #28 | bump npm_and_yarn group across 3 dirs | **CLOSE** — superseded by master `5cef645e` (cleared all 44 dependabot alerts, npm audit = 0) |
| #47 | bump fast-uri 3.1.2→3.1.4 in mcp-server | **CLOSE** — same supersession by `5cef645e` |

---

## Δ vs 2026-06-07 (previous latest.md)

| Item | Direction | Detail |
|---|---|---|
| P1 dev-bypass-prod | ✅ RESOLVED | `ENVIRONMENT=production` deployed; `Bearer dev-local-user` → 401. |
| P0 dashboard 404 | 🔴 PERSISTS (root-caused) | Now understood: Clerk protect-rewrite cached by Vercel CDN. Day ~110+. Exact fix identified. |
| P0 voice box down | 🔴 PERSISTS | Pod `udcz4k7kse1zw6` returning 404. Wiring is correct. Day ~85+. Needs pod restart. |
| **P1 MCP_API_KEY committed** | 🆕 NEW CRITICAL | `mcp-server/lovable.sh` hardcodes full-owner-privilege key. Rotate immediately. |
| Build E2E | ⚠️ UNVERIFIABLE | Bypass correctly disabled — cloud audit can't authenticate. Worker/health=200, process alive. |
| Sandpack unit guards | ✅ VERIFIED | Still passing (5/5 alias, 9/9 assets). |
| middleware→proxy rename | ⚠️ PERSISTS | Still `middleware.ts`; build warning unchanged. |
| TAVILY/web_search | ⚠️ STILL UNCONFIRMED | Cannot test without auth credentials. |
| master branch | 🆕 FROZEN | No commits since 2026-08-10 (63 days). |
| npm audit | 🆕 NEW | 28 vulnerabilities (2 critical) in frontend deps. |
| Audit branch backlog | 🆕 HYGIENE | 38 branches / 30 open draft PRs — bulk archive recommended. |
| P2 build latency | ✅ MOOT | Can't verify — bypass disabled. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **Build engine E2E** | Dev-bypass disabled in prod; no Clerk JWT / audit key available | Provision a scoped audit credential; or run locally with a real Clerk JWT |
| **web_search / TAVILY** | E2E blocked | Run a chat turn forcing web search once auth is resolved |
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud | RunPod dashboard → check pod `udcz4k7kse1zw6` state |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud | `vercel ls` or Vercel dashboard — confirm `eb5ab744` deployed |
| **Vercel CDN cache purge** | Needs Vercel dashboard / token | After fixing middleware: Vercel dashboard → Project → Domains → Purge Cache |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY` not in cloud | Not needed this run (worker is up) |
| **Telegram notification** | No Telegram token in cloud | `POST /api/share/phone` locally, or `notify_mario()` |
| **Box POST /api/connect session test** | Broker token in `.dev.vars` | Test HMAC-gated broker locally |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 5 parallel domain agents (build engine, frontend, security/import, voice box, GitHub reconciliation) → this synthesis.
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (2 RED: dashboard 404, box /healthz 404; 9 YELLOW: cloud-cred limits + unverified; 6 GREEN).
