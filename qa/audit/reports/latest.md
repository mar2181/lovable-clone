# HS Web App Builder — Audit Report

**Date:** 2026-10-25T11:20Z · **Run:** #18 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky  
**Overall: 🔴 RED** — P1 committed MCP key persists (day 12, unresolved). 2 P0 outages persist (dashboard day ~139, voice box day ~110). Prior P1 dev-bypass RESOLVED.

> Probe: 6 GREEN · 9 YELLOW · 2 RED | Deep audit: all 6 domains complete | Auto-healed: none (cloud run; RUNPOD_API_KEY unavailable)

---

## 🚩 Needs Mario (ranked P1 → P0 → P0)

### P1 🔑 — MCP_API_KEY hardcoded in public repo `mcp-server/lovable.sh` [PERSISTS — day 12, unresolved since Oct 13]

**Confirmed live today.** `mcp-server/lovable.sh` line 6 contains a hardcoded fallback API key value (redacted here — see the file directly).  
This key matches the `MCP_API_KEY` auth path in `worker/src/middleware/auth.ts` — grants `isOwner: true`, full operator privileges: arbitrary Supabase Management SQL, GitHub PAT pushes, Vercel prod deploys, Twilio SMS. **The repo is public. Anyone can extract this key from git history and impersonate the owner in production.**

Key has been live since commit `5ec5e08` ("feat(dashboard): add Duplicate/Clone project action"), visible in the public repo for 12 days.

**Fix (ROTATE IMMEDIATELY — confirm-first per policy.md):**
1. Generate a new random 64-char hex key — **do NOT reuse** the committed value.
2. `cd worker && wrangler secret put MCP_API_KEY` (new value).
3. Patch `mcp-server/lovable.sh` line 6: replace the hardcoded fallback with `${MCP_API_KEY:?MCP_API_KEY is required}` — fail loudly if unset, never fall through to a default.
4. Rotate any credentials the key could have been used to extract (Supabase PAT, GitHub PAT, Vercel token) — key has been live 12 days in a public repo.
5. Purge from git history: `git filter-repo --path mcp-server/lovable.sh --invert-paths` (add cleaned version back), or BFG Repo Cleaner. Force-push to purge remote history.

---

### P0 🌐 — Dashboard `/dashboard` returns 404 (day ~139) [PERSISTS]

`/dashboard` → HTTP 404. Vercel serves a `_not-found` response. Local build today proves the route builds correctly (`○ /dashboard` static). Root cause (confirmed run #14, still unresolved):

- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is missing from Vercel environment variables.
- Clerk's `auth.protect()` in `middleware.ts` calls `createRedirect()` for unauthenticated users; without the env var, it produces an invalid redirect URL and rewrites to `/404` instead.
- Vercel's edge CDN caches the 404 response indefinitely.

**Fix (three steps, all required):**
1. **Add Vercel env vars** (confirmed missing):
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
2. **Optionally patch `middleware.ts`** to use an explicit redirect instead of `auth.protect()`.
3. **Purge Vercel edge cache** after deploy.

---

### P0 🎙️ — Voice box pod DOWN (day ~110) [PERSISTS]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **HTTP 404**. Pod is stopped.

**Fix:** `curl -X POST "https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start" -H "Authorization: Bearer $RUNPOD_API_KEY"` — needs RUNPOD_API_KEY locally.

Pod billed ~$0.69/hr even while stopped. ~$1,820 accumulated over ~110 days.

---

## 🔧 Auto-healed: None

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **P1 dev-bypass-prod** | 🟢 RESOLVED | `Bearer dev-local-user` → 401 on all endpoints. `ENVIRONMENT="production"` in wrangler.toml. |
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200, `/api/projects` anon 401. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 |
| **Frontend build** | 🟢 GREEN | `next build` exits 0, TypeScript 0 errors, `/dashboard` static route builds. |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 |
| **GitHub Import unit guards** | 🟢 PASS | `test-sandpack-alias.ts` 5/5, `test-sandpack-assets.ts` 9/9 |
| **Pet Concierge wiring** | 🟢 INTACT | `data-backend="selfhosted"`, `/boxapi` proxy target correct. |
| **Security — .dev.vars** | 🟢 GREEN | Gitignored + not tracked. |

---

## 🩹 Hygiene backlog

- `middleware.ts` → `proxy.ts` rename needed (Next.js 16 deprecation warning in build)
- ESLint 157 errors / 236 problems accumulated
- Dependabot PR #47 (`fast-uri` bump) — **MERGE** (3 months old, safe)
- 42 audit/report branches accumulating — recommend mass-delete of >60-day-old ones
- Pod storage ~$1,820 accumulated; no idle-shutdown controller

---

## 🗂 GitHub Reconciliation

| Branch | Recommendation |
|---|---|
| `claude/builder-buddy-rail` | **BRING IN** — open fresh PR (prior PR #20 closed) |
| Dependabot PR #47 | **MERGE** |
| `dependabot/npm_and_yarn-5984bbb696` | EVALUATE |
| 42× `audit/report-*` | MASS-DELETE >60 days old |

---

## Δ vs 2026-10-22

- P1 MCP key: day 9→12, still live
- Dashboard 404: day 136→139
- Voice box: day 107→110
- P1 dev-bypass: continues RESOLVED
- No master commits (75 days since last)

---

## ⛔ Skipped (no cloud creds)

RunPod pod-power, Vercel deploy-drift, Build engine E2E, TAVILY web_search, Telegram delivery, Box connect session test.
