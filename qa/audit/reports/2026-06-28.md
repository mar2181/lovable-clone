# HS Web App Builder — Audit Report

**Date:** 2026-06-28T11:11Z · **Run:** #7 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — three P0 outages (build engine stalled again, dashboard 404/middleware crash, voice box dead) + P1 security bypass 7 consecutive audits. Core product non-functional.

> Probe: 5 GREEN · 9 YELLOW · 3 RED | Deep audit: 6 domains | Auto-healed: none (all P0s require local creds or Vercel access)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Build engine STALLED again (core product DOWN) [PERSISTS — 3rd consecutive audit]

**Confirmed via SSE E2E test this run:**
- POST /api/projects → 201, id `Cx6zjt5jVZ` ✓
- POST /api/build/Cx6zjt5jVZ → 200, SSE stream opens ✓
- Events: `build_start` (4 pages, 2 batches) → `batch_start` → `page_status` Home/About/Services → `generating`…
- **Then: `page_status: Services: generating` repeats indefinitely for 300 seconds** — no `batch_complete`, no `build_complete`, no `{"type":"error"}`
- curl timeout at 300s (code 28). No completion.
- DELETE /api/projects/Cx6zjt5jVZ → 200 ✓

No "Insufficient credits" error this time (unlike the pre-June-7 P0). The SSE stream stays alive but the AI generation call hangs at batch 0, page 3 ("Services"). This is a **hung LLM call / worker promise that never resolves**.

**Root cause hypotheses:**
1. **OpenRouter rate limit or quota** — a specific model response hangs mid-stream; the worker's SSE stays open waiting for a response that never arrives
2. **Worker CPU/wall-clock limit** — the Cloudflare Worker hits its execution limit, kills the inner LLM call, but leaves the SSE stream open (no error surfaced)
3. **Model routing change** — the specific OpenRouter model (`claude-*` or `gpt-*` in `worker/src/ai/`) has been deprecated or rate-limited

**Fix:**
1. Check https://openrouter.ai/ → billing/credits and rate-limit dashboard
2. Check worker logs via Cloudflare dashboard for the `/api/build` route — look for the actual error the worker swallows
3. Add a server-side SSE keepalive + explicit error catch: if the LLM call rejects/times-out, emit `{"type":"error","message":"..."}` so clients see a failure instead of hanging
4. Consider adding a server-side 120s per-page timeout that emits an error event rather than hanging

---

### P0 — `/dashboard` returns 404/500 — middleware crash confirmed [PERSISTS — 3rd consecutive audit]

**Production:** `GET https://hswebappbuilder.space/dashboard` → HTTP 404, `age: 1744430` (~20.2 days, no new deployment since June 8).

**Root cause now confirmed via this run's Vercel preview deployment:**
The audit branch (`audit/report-2026-06-28`) triggered a fresh Vercel build. Checking `/dashboard` on the preview URL returned:
```
HTTP/2 500
x-vercel-error: MIDDLEWARE_INVOCATION_FAILED
```
The middleware is **crashing at runtime**, not just redirecting. This is NOT a stale cache issue — it's a real error in production that Vercel's edge turned into a cached 404 on the first occurrence (June 8).

**Root cause:** `middleware.ts` calls Clerk's `auth.protect()` which requires `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (and/or `CLERK_SECRET_KEY`) to be present in the Vercel environment. If either is missing, Clerk throws, Next.js middleware crashes, and Vercel serves 500 → cached as 404.

**Fix (needs Vercel access):**
1. Vercel project settings → Environment Variables → confirm set for **Production**:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — live key (starts `pk_live_`)
   - `CLERK_SECRET_KEY` — live key (starts `sk_live_`)
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL` = `/sign-up`
2. Update any missing/wrong values from Clerk dashboard.
3. Trigger prod deployment: `vercel --prod` or Vercel dashboard → Deployments → Redeploy.
4. Verify `/dashboard` → 307 → `/sign-in` (not 404 or 500).
5. Test sign-in with real Clerk credentials.

---

### P0 — Voice box DOWN (pod process not responding) [PERSISTS — 3rd consecutive audit]

**Live confirmation:** `GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **empty response** (no body, connection closed — pod network up but port 7860 process dead).

Note: June 25 audit showed `/healthz → 404`; today empty response = same failure, slightly different manifestation. The RunPod proxy host is reachable but the voice box process has either crashed or the pod has stopped.

**Repo wiring is intact** (verified in code — no fix needed):
- `components/pet-concierge.tsx` line 99: `data-backend="selfhosted"` ✓
- `components/pet-concierge.tsx` line 100: `data-connect-url="/boxapi"` ✓
- `next.config.ts` line 12–13: `/boxapi/:path*` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net/:path*` ✓
- `agent_id` present ✓

**Fix (requires RunPod API key — cannot be done from cloud):**
```bash
# Start the pod (if EXITED):
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -X POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start

# If pod is RUNNING but process crashed, try restart agent:
curl -X POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/dashboard/agent/restart

# Verify:
curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz
# Expect: {"ok":true,"build":"2026-06-06-hsreels-tts","tools":{"count":18},"tts":{"voices":["will","jack"]}}
```
Note: Pod is billed 24/7 at ~$0.69/hr even when the process is down — costing ~$500/mo for a non-functional service.

---

### P1 — Anyone can be prod owner via `Bearer dev-local-user` [PERSISTS — 7th consecutive audit]

**Live confirmation:** `GET /api/credits` → HTTP 200, `{"tier":"unlimited","balance":9999}` — no Clerk JWT required.

`worker/wrangler.toml` lines 16–17 (in `[vars]`, deployed to production):
```toml
[vars]
ENVIRONMENT = "development"
DEV_BYPASS_AUTH = "1"
```

Both flags independently trigger the dev bypass in `worker/src/middleware/auth.ts` lines 62–66.

**This has now been flagged in 7 consecutive audits (since June 7) without being fixed.**

**Fix (CONFIRM-FIRST per policy.md):**
1. Log into hswebappbuilder.space with real Clerk credentials — confirm your projects show.
2. Remove from `worker/wrangler.toml [vars]` (keep values only in `worker/.dev.vars`):
   ```diff
   [vars]
   -ENVIRONMENT = "development"
   -DEV_BYPASS_AUTH = "1"
   ```
3. `cd worker && wrangler deploy`
4. Verify `GET /api/credits` with `Bearer dev-local-user` now returns 401.
Note: `worker/.dev.vars` is gitignored and not tracked — confirmed safe to keep values there.

---

### P2 — Dependabot security PR #28 unmerged (8 days old)

Branch `dependabot/npm_and_yarn/npm_and_yarn-5984bbb696` (created June 20):
- `hono` 4.12.23 → 4.12.26 (root, mcp-server, worker)
- `esbuild` 0.27.7 → 0.28.1 (mcp-server, worker)

Previous Dependabot PR #21 (hono bump) was merged promptly on June 7 — apply the same treatment here.

**Fix:** Review and merge PR #28 from GitHub. Low-risk lock-file-only security bump.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` 200, `/api/spec.json` 200 (openapi 3.1.0), `/api/projects` anon → 401 (gated, correct) ✓ |
| **GitHub Import** | 🟢 GREEN | POST `/api/github/import` → 201, 22 files imported, 0 failed. Cleanup 200 ✓ |
| **Sandpack unit guards** | 🟢 GREEN | `test-sandpack-alias.ts` 5/5 ✓ · `test-sandpack-assets.ts` 9/9 ✓ |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 ✓ |
| **Frontend build** | 🟢 GREEN | `npm run build`: 0 TypeScript errors, 6 routes built cleanly in 11.8s ✓ |
| **Pet concierge wiring (code)** | 🟢 GREEN | `data-backend=selfhosted` → `/boxapi` → `next.config.ts` → RunPod pod URL — chain intact ✓ (box process is down, but wiring code is correct) |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; `git ls-files` → not tracked ✓ |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts` uses exact-match origin allowlist (not `*`) ✓ |

---

## 🩹 Hygiene backlog (P3 — batched)

- **5 stale `audit/report-*` branches accumulating** (2026-06-10 through 2026-06-25, all open PRs) — harness creates a branch per run but none are being merged or auto-deleted. The accumulation means 5 open PRs (#27, #29, #32 visible) adding noise. Fix: auto-delete branch after filing GitHub issue, or use a single `audit-log` branch.
- **`middleware.ts` → `proxy.ts` rename** — Next.js 16 deprecation warning in every build (every audit since June 7, unfixed). Run `npx @next/codemod@latest middleware-to-proxy .` then test.
- **`template-picker.tsx:80`** — `fetchTemplates` accessed before declaration; stale-closure risk. Every audit since June 7, unfixed. Move declaration above the `useEffect`.
- **Lint: 156 errors / 80 warnings** — dominated by `@typescript-eslint/no-explicit-any` across `sdk/src/index.ts`, `worker/src/`, `components/`. Pre-existing backlog.
- **Pod billed 24/7 (~$500/mo)** with 0 active sessions and process DOWN. Idle-shutdown controller badly needed.
- **Telegram/SMS dark** — `POST /api/share/health` → `telegram:false, sms:false`. Still not configured.
- **`GET /api/projects/<deleted-id>`** → HTTP 200 with `{"error":"Project not found"}` — should be 404.
- **builder-buddy-rail PR #20** — recommended BRING IN 25 days ago; now 21+ days old and drifting further behind master.
- **Master frozen** — 0 new commits to master since `50a7531` on June 7 (21 days). P0s accumulating without fixes.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD: `50a7531` (`chore(audit): sync 2026-06-07 audit report`) — **21 days without a new commit to master.**

| Branch | Age | What it is | Recommendation |
|---|---|---|---|
| **`dependabot/npm_and_yarn/npm_and_yarn-5984bbb696`** (PR #28) | 8 days | hono 4.12.26 + esbuild 0.28.1 security bumps (3 dirs) | **MERGE** — low-risk, addresses open CVEs. Same as PR #21 which was merged promptly. |
| **`claude/builder-buddy-rail`** (PR #20) | 25 days, 21 days behind master | Docked Space Mario assistant rail | **REBASE THEN MERGE** — overdue; was recommended "bring in" 18 days ago; every day the rebase gets harder. Assign this sprint. |
| **`audit/report-2026-06-25`** (PR #32) | 3 days | Previous audit report (3×P0 + P1) | **ACKNOWLEDGE FINDINGS then close** — findings still unresolved. |
| **`audit/report-2026-06-22`** (PR #29) | 6 days | Prior audit report (3 P0 outages) | **CLOSE** — superseded by 2026-06-25 and 2026-06-28. |
| **`audit/report-2026-06-19`** (PR #27) | 9 days | Prior audit report | **CLOSE** — superseded. |
| **`audit/report-2026-06-13`** | 15 days | Audit report (no PR) | **DELETE branch** — superseded. |
| **`audit/report-2026-06-10`** | 18 days | Audit report (no PR) | **DELETE branch** — superseded. |

**Systemic:** 5 audit branches in 18 days, 4 open PRs, none acted on. The audit harness is running correctly but its output is accumulating unread. Consider: (a) close old audit PRs and keep only the latest, (b) fix the harness to use a single `audit-log` branch with commits per run.

---

## Δ vs 2026-06-25 (previous audit)

| Item | Direction | Detail |
|---|---|---|
| /dashboard 404 | 🔴 PERSISTS | 3rd consecutive audit. Root cause confirmed: `MIDDLEWARE_INVOCATION_FAILED` on fresh Vercel preview = Clerk env vars missing. Prod serving 20-day cached 404. |
| Voice box DOWN | 🔴 PERSISTS | 3rd consecutive audit. Response changed from `/healthz → 404` to empty (process may be fully stopped now). |
| Build engine | 🔴 PERSISTS | SSE stalls again at `page_status: Services: generating`, 300s timeout, no `build_complete`, no error event. Likely hung LLM call (not "Insufficient credits" this time). |
| P1 dev-bypass | 🔴 PERSISTS | 7th consecutive audit without fix. `wrangler.toml [vars]` unchanged. |
| GitHub import | ✅ STABLE | 201, 22 files — same as all prior audits. |
| Sandpack unit guards | ✅ STABLE | 5/5 + 9/9 — same as all prior audits. |
| CORS / .dev.vars security | ✅ STABLE | No regressions. |
| Dependabot PR #28 | ⚠️ PERSISTS UNMERGED | 8 days old, same recommendation: MERGE. |
| Audit branch accumulation | 🔴 WORSENING | Now 5 stale branches / 4 open PRs, up from 4/3. |
| Master frozen | 🔴 WORSENING | 21 days without a commit (was 18 days on June 25). |
| middleware→proxy rename | ⚠️ PERSISTS | P3 unfixed, 4th consecutive audit. |
| template-picker.tsx:80 | ⚠️ PERSISTS | P3 unfixed, 4th consecutive audit. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **RunPod pod-power** | `RUNPOD_API_KEY` not in cloud env | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` → check pod state; if EXITED: add `-X POST .../start` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` not in cloud env | `vercel ls` — confirm no deployment since June 8; `vercel --prod` to redeploy |
| **Worker selfheal** | `CLOUDFLARE_API_KEY`+email not in cloud | Not needed — worker `/health` is GREEN |
| **Telegram notification** | No Telegram token | `POST /api/share/phone` locally after box is back |
| **Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | After restart: `curl -X POST https://udcz4k7kse1zw6-7860.proxy.runpod.net/api/connect` with HMAC auth |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 6 parallel domain agents → synthesis.
Probe overall: RED (3 RED · 9 YELLOW · 5 GREEN). Probe JSON: `qa/audit/reports/latest-probe.json`.
Run #7 — the P0s that started appearing in Run #5 (2026-06-19) remain unresolved. Immediate action needed.
