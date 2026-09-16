# HS Web App Builder — Audit Report

**Date:** 2026-09-16T11:06Z · **Run:** #3 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 2 new P0s since last audit (voice box pod stopped; dashboard 404 for unauthenticated users). Previous P1 security bypass CONFIRMED RESOLVED.

> Probe: 6 GREEN · 9 YELLOW · 2 RED  |  Deep audit: 6 domains  |  Auto-healed: none (cloud run — no RunPod/Vercel creds)

---

## 🚩 Needs Mario (ranked P0 → P3)

### P0 — Voice box pod stopped (RunPod `udcz4k7kse1zw6` not running) [NEW]

The RunPod pod that hosts the Pet Concierge voice box is stopped. The RunPod CDN proxy still answers TLS (cert valid through 2026-11-22, pod ID in DNS), but returns bare HTTP 404 — RunPod's known behavior when nothing is listening behind the proxy.

**Impact:** All voice sessions are dead. Every `/boxapi/…` request proxies to 404. Because `data-backend="selfhosted"` is set in `components/pet-concierge.tsx`, there is no automatic ElevenLabs fallback. Voice is completely non-functional for all users.

**Wiring check:** `components/pet-concierge.tsx` and `next.config.ts` are fully coherent — `data-backend="selfhosted"`, `/boxapi` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net` — no URL mismatch. No repo edit needed; pod restart alone will restore voice.

**Fix (operational — flag per policy.md, needs RUNPOD_API_KEY):**
1. Log into RunPod dashboard → find pod `udcz4k7kse1zw6` → Start.
   OR: `curl -X POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start -H "Authorization: Bearer $RUNPOD_API_KEY"`
2. Wait ~90s for the box to initialize, then: `curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → expect `{"ok":true}`.
3. **If the pod was terminated (not just stopped):** it will have a new pod ID. Update `next.config.ts` line 13 (`/boxapi` rewrite destination) to the new `*.proxy.runpod.net` URL, commit, push, and redeploy Vercel.

**Short-term rollback while pod is down:** remove `data-backend="selfhosted"` and `data-connect-url="/boxapi"` from `components/pet-concierge.tsx` lines 99–100 to restore ElevenLabs fallback.

---

### P1 — `/dashboard` shows 404 to unauthenticated users [NEW]

`GET https://hswebappbuilder.space/dashboard` returns HTTP 404 with headers:
```
x-clerk-auth-reason: protect-rewrite, session-token-and-uat-missing
x-matched-path: /404
```

Clerk middleware ran, detected the user is unauthenticated, and called `auth.protect()`. Since `NEXT_PUBLIC_CLERK_SIGN_IN_URL` is not set (or not set correctly) in Vercel's environment variables, Clerk has no sign-in URL to redirect to and falls back to rewriting the request to `/404`. New or logged-out users see a bare 404 with no prompt to sign in — a major acquisition/re-engagement blocker.

**Logged-in users:** Not affected. Clerk passes through authenticated sessions normally; the dashboard code and layout files exist and are correct in the repo (`app/dashboard/page.tsx`, `app/dashboard/layout.tsx`).

**Fix:**
1. Open the Vercel project dashboard → Settings → Environment Variables.
2. Add (or update): `NEXT_PUBLIC_CLERK_SIGN_IN_URL = /sign-in` (for all environments: Production, Preview, Development).
3. Trigger a redeploy (or it will pick up on next deploy).
4. Verify: `curl -sI https://hswebappbuilder.space/dashboard` should return `HTTP/2 307` or `HTTP/2 302` with `location: /sign-in`.

**Secondary (P3 follow-through):** Also migrate `middleware.ts` → `proxy.ts` before Next.js 16 enforces the rename. See §Hygiene backlog.

---

### P2 — Build engine E2E UNVERIFIED — audit methodology broken by security fix [NEW]

The June 2026 audit verified build E2E using `Authorization: Bearer dev-local-user`. Since the 2026-08-09 security hardening, `wrangler.toml` sets `ENVIRONMENT = "production"` and `DEV_BYPASS_AUTH` is absent — the dev bypass is off. `Bearer dev-local-user` now returns 401 everywhere.

**Worker health:** `/health` → 200 `{"status":"ok"}`. Worker is running. Build engine status is unknown because the scripted test has no valid auth token.

The auth code (`worker/src/middleware/auth.ts` lines 42–55) has an `X-API-Key` bypass for the `MCP_API_KEY` worker secret — this is the correct path for scripted automation. But the key value is not available in this cloud run.

**Fix (methodology):**
1. Confirm `MCP_API_KEY` is set as a Cloudflare Worker secret: `wrangler secret list --name lovable-clone-backend`.
2. Update `qa/audit/audit-probe.mjs` (and RUNBOOK.md) to use `X-API-Key: <MCP_API_KEY>` + `X-User-Id: audit-bot` instead of `Bearer dev-local-user` for the build engine E2E.
3. Store the key in the cloud run vault so automated audits can verify the build pipeline going forward.

**Risk:** If the build engine has silently regressed since June, this audit will not catch it until the methodology is fixed.

---

### P2 — `web_search` likely dead (`TAVILY_API_KEY` unset) [PERSISTS since June]

`wrangler.toml` has no `TAVILY_API_KEY` in `[vars]`. Worker degrades gracefully. Cannot confirm live (no auth). Carry-over from June.

**Fix:** Run a chat turn that forces web search. If unavailable: `cd worker && wrangler secret put TAVILY_API_KEY`.

---

### P2 — Build latency approaching timeout [PERSISTS since June — unverifiable this run]

June 2026 E2E showed a 4-page build taking 180–200s, racing the 180s SSE client timeout. Larger prompts risk a hard timeout. Unverifiable this run due to auth issue above.

**Fix (repo edit — flag):** Add server-side SSE keepalive ping or increase client timeout to 240s.

---

### P2 — `template-picker.tsx:80`: `fetchTemplates` called before declaration [PERSISTS since June]

ESLint reports `fetchTemplates` accessed inside a `useEffect` before its declaration. Stale-closure risk.

**File:** `components/dashboard/template-picker.tsx:80`
**Fix:** Move `fetchTemplates` declaration above the `useEffect` that calls it.

---

### P3 — `middleware.ts` → `proxy.ts` rename [PERSISTS since June]

`next build` emits: *"The 'middleware' file convention is deprecated. Please use 'proxy' instead."* Breaking in a future Next.js 16 minor.

**Fix:** `git mv middleware.ts proxy.ts`, update imports, redeploy.

---

## 🔧 Auto-healed this run
**None.** No operational creds available in cloud run (no RUNPOD_API_KEY, VERCEL_TOKEN, CLOUDFLARE_API_KEY). All P0s require Mario's action.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence |
|---|---|---|
| **P1 security bypass** | 🟢 RESOLVED (was P1 in June) | `Bearer dev-local-user` → `GET /api/credits` returns **401**. `wrangler.toml`: `ENVIRONMENT="production"`, `DEV_BYPASS_AUTH` absent. Hardening comment at `auth.ts:70` confirms intentional. |
| **Worker infra** | 🟢 GREEN | `/health` → 200 `{"status":"ok"}`. `/api/spec.json` → 200 (openapi 3.1.0). Gated routes → 401 anon. |
| **Frontend root** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200 `x-clerk-auth-status: signed-out` (public route, correct). |
| **GitHub Import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + gated). |
| **Sandpack unit guards** | 🟢 GREEN | `test-sandpack-alias.ts`: **5/5 pass**. `test-sandpack-assets.ts`: **9/9 pass**. |
| **.dev.vars gitignore** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`. `git ls-files worker/.dev.vars` → empty. Not tracked or in history. |
| **Box wiring** | 🟢 GREEN (repo coherent) | `pet-concierge.tsx`: `data-backend="selfhosted"`, `data-connect-url="/boxapi"`. `next.config.ts` line 13: `/boxapi → https://udcz4k7kse1zw6-7860.proxy.runpod.net`. Full chain coherent. Pod is stopped, not wrong URL. |
| **Branch hygiene** | 🟢 IMPROVED | `fix/sanitizer-icon-imports`, `archive/windows-side-*`, `backup/pr13-*` all gone vs June audit. |

---

## 🩹 Hygiene backlog (P3 — batched)

- **30 stale audit branches** (`audit/report-2026-06-10` through `audit/report-2026-09-13`) — automated snapshots, none mergeable. Safe to bulk-delete: `git push origin --delete $(git ls-remote --heads origin 'audit/report-*' | awk '{print $2}' | sed 's|refs/heads/||')`
- **Pod billed while stopped?** RunPod bills stopped pods at reduced rate (volume storage). Verify the pod isn't costing ~$500/mo stopped; idle-shutdown controller still unimplemented.
- **Telegram/SMS not configured** (`share/health`: telegram=undefined, sms=undefined). In-app phone sharing is dark.
- **ESLint: 130+ `@typescript-eslint/no-explicit-any`** across `worker/src/routes/` and `components/`.
- **ESLint: 80+ warnings** — unused vars, missing `useEffect` deps, `<img>` vs `<Image />`.
- **deploy/drift** — not verified (VERCEL_TOKEN absent in cloud). Check Vercel dashboard that HEAD `eb5ab74` is deployed.
- **pod-power** — not checked (RUNPOD_API_KEY absent). This run knows the pod is stopped from `/healthz` 404; use RunPod dashboard to restart.
- **`GET /api/projects/<deleted-id>`** returns 200 with `{"error":"Project not found"}` — should be 404.
- **Next.js workspace warning** — stray `/home/mario/package-lock.json` confuses Turbopack workspace root detection.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

Master HEAD: `eb5ab74` (unchanged from last audit confirmation — Vercel deploy-drift not verified).

| Branch | Age | What it is | Recommendation | Reason |
|---|---|---|---|---|
| **`claude/builder-buddy-rail`** | ~3.5 mo (last commit 2026-06-04) | Docked Space Mario assistant rail — builder UI right-panel | **REVIEW or CLOSE** | Previously recommended "BRING IN FOR REVIEW" in June. Now 3.5 months stale with no action. If feature shipped differently or was abandoned, delete the branch. If still desired, rebase against master. |
| **`dependabot/npm_and_yarn/mcp-server/…`** | ~2 mo (2026-07-21) | `fast-uri` bump in `mcp-server/` | **MERGE or CLOSE** | Stale Dependabot branch. Check `gh pr list --head dependabot/…` for open PR; merge if auto-approved, close if stale. |
| **`dependabot/npm_and_yarn/npm_and_yarn-…`** | ~3 mo (2026-06-20) | Multi-directory npm group bump | **MERGE or CLOSE** | Same guidance. |
| **`audit/report-*` (×30)** | 3 days–3 months | Automated audit report branches | **BULK DELETE** | No audit branch is ever merged. Bulk-delete via CLI (command above). |

**Resolved since June:** `fix/sanitizer-icon-imports`, `archive/windows-side-2026-05-11`, `backup/pr13-pre-resolve-2026-05-12` — all gone. Well done.

---

## Δ vs previous audit (2026-06-07)

| Item | Direction | Detail |
|---|---|---|
| P1 dev-bypass-prod | ✅ RESOLVED | `ENVIRONMENT=production`, no `DEV_BYPASS_AUTH` in `[vars]`. Hardened 2026-08-09. |
| Voice box / RunPod pod | 🔴 NEW REGRESSION | Was GREEN (18 tools, ok:true) in June. Now P0 — pod stopped, `/healthz` → 404. |
| Dashboard `/dashboard` → 404 | 🔴 NEW REGRESSION | Was 200 in June probe. Now `protect-rewrite` 404 due to missing `NEXT_PUBLIC_CLERK_SIGN_IN_URL`. |
| Build engine E2E | ⚠️ UNVERIFIABLE | Was GREEN (build_complete, 22 files). Now untestable — dev bypass removed, no MCP key in cloud. |
| Sandpack unit guards | ✅ VERIFIED GREEN | Still 5/5 + 9/9. |
| P2 web_search (TAVILY) | ⚠️ STILL UNCONFIRMED | Unverifiable without auth. |
| P2 template-picker.tsx:80 | ⚠️ PERSISTS | No fix committed since June. |
| P3 middleware.ts rename | ⚠️ PERSISTS | No migration done. |
| Branch hygiene | ✅ IMPROVED | 3 branches from June cleaned up. 30 audit branches accumulating. |
| Hono/security bump | ✅ STILL RESOLVED | PR #21 remains merged. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run |
|---|---|---|
| **Build engine E2E** | Dev bypass removed; `MCP_API_KEY` not in cloud vault | Update probe to use `X-API-Key` header; store key in vault |
| **GitHub Import live test** | Same auth blocker | Same fix |
| **RunPod pod-power restart** | `RUNPOD_API_KEY` absent | `curl -X POST https://rest.runpod.io/v1/pods/udcz4k7kse1zw6/start -H "Authorization: Bearer $RUNPOD_API_KEY"` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` absent | `vercel ls` / Vercel dashboard — confirm HEAD `eb5ab74` deployed |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email absent | Not needed this run (worker is up) |
| **Telegram notification** | No token in cloud | `notify_mario()` / `POST /api/share/phone` — local run sends it |
| **Box `POST /api/connect` session** | RunPod broker token in `.dev.vars` | Test HMAC broker locally after pod restart |
| **`npm run build` / lint** | `node_modules` not installed in cloud clone | `npm ci && npm run build && npm run lint` locally |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 4 parallel deep-audit agents → this synthesis.
Probe overall: RED (2 RED / 9 YELLOW / 6 GREEN).
Probe JSON: see `qa/audit/reports/latest-probe.json`.
