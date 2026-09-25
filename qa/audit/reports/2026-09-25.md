# HS Web App Builder — Audit Report

**Date:** 2026-09-25T11:13Z · **Run:** #12 (scheduled, 3-day cadence) · **Mode:** auto-fix safe / flag risky
**Overall: 🔴 RED** — 94 Dependabot vulnerabilities on master (4 critical, 38 high). Voice box down 79+ days. Build engine untestable (audit credential gap). P1 dev-bypass resolved.

> Probe: 6 GREEN · 9 YELLOW · 2 RED (1 confirmed real, 1 probe misconfiguration) | Deep audit: 4 domains | Auto-healed: none

---

## 🚩 Needs Mario (ranked P0 → P3)

### P1 — 94 Dependabot vulnerabilities on master (4 CRITICAL, 38 HIGH) [NEW/ESCALATED]

Discovered at push time: GitHub reports **94 vulnerabilities** on the default branch (`master`) — a massive escalation from the 10 moderate advisories noted in the June 7 report.

```
GitHub found 94 vulnerabilities on mar2181/lovable-clone's default branch
  4 critical · 38 high · 47 moderate · 5 low
```

**Fix:**
1. Go to: `https://github.com/mar2181/lovable-clone/security/dependabot`
2. Review the critical and high advisories first. Accept Dependabot's PRs for safe lock-file-only upgrades.
3. Merge open Dependabot PRs #28 and #47 (see GitHub Reconciliation section) as first steps.
4. The full list likely includes transitive dependency vulnerabilities from the 3+ month backlog. Consider enabling Dependabot auto-merge for patch-level bumps.

---

### P0-AUDIT — Build engine untestable: audit credential (`Bearer dev-local-user`) disabled in prod [NEW — systemic gap since 2026-08-09]

The production worker's 2026-08-09 security hardening set `ENVIRONMENT=production` and removed `DEV_BYPASS_AUTH` from `[vars]`. As a result, `Bearer dev-local-user` now returns **401** on all endpoints. Every live audit check that relied on this credential — build E2E, GitHub import live test, web-search verification — **cannot be executed from the cloud audit**.

The build engine's operability is currently **UNKNOWN** from outside the worker. If `OPENROUTER_API_KEY` or the model (`moonshotai/kimi-k2.6` via OpenRouter) has degraded, every user build fails silently and this audit would not catch it.

**Fix (runbook update — flag, not auto-fix):**
1. Add `X-API-Key: <MCP_API_KEY>` to `qa/audit/audit-probe.mjs` and the build engine deep-test. This is the intended internal-testing path (`auth.ts` lines 44–55: `X-API-Key` grants `isOwner: true`).
2. The `MCP_API_KEY` value is a write-only worker secret. Add it to the cloud audit's env (Vault / GitHub Action secret) OR run the build E2E from the local audit where `.dev.vars` is available.
3. Do NOT re-enable `DEV_BYPASS_AUTH` in production — that reverses a valid security fix.

**Impact:** Until fixed, the audit's most important check (build engine P0) is dark every 3-day cycle.

---

### P2 — Voice Box down for 79+ days [PERSISTS — needs pod restart]

`GET https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → **HTTP 404**. The RunPod pod is either stopped, cycled to a new URL, or the agent process has crashed.

- Concierge wiring in code is **correct**: `pet-concierge.tsx` → `data-backend="selfhosted"`, `data-connect-url="/boxapi"` → `next.config.ts /boxapi` → `https://udcz4k7kse1zw6-7860.proxy.runpod.net` (exact match). The code is fine; the pod is the problem.
- The outage dates to at least 2026-07-07 (audit PR #39 notes "voice box day 0 of outage"). That is 79+ days of Pet Concierge being non-functional.
- Pod power state cannot be checked from cloud (`RUNPOD_API_KEY` absent).

**Fix:**
1. Log into RunPod console: `https://www.runpod.io/console/pods`
2. Find pod `udcz4k7kse1zw6`. If EXITED → Start it. If running but the box URL changed → update `next.config.ts` `/boxapi` destination and redeploy.
3. Confirm: `curl https://udcz4k7kse1zw6-7860.proxy.runpod.net/healthz` → `{"ok":true}`

**Autofixable by policy:** pod restart is an auto-fix action per `policy.md` — but it requires `RUNPOD_API_KEY`, which is absent in the cloud audit. Flagged for Mario.

---

### P3 — Probe misconfiguration: `/dashboard` falsely RED for 107+ days [PERSISTS — probe bug]

The audit probe (`audit-probe.mjs`) marks `/dashboard` as RED/404. Deep audit confirms `/dashboard` returns **HTTP 307** → `https://accounts.hswebappbuilder.space/sign-in?redirect_url=…` — a correct Clerk auth redirect, not a 404. The route exists, builds cleanly, and behaves correctly for unauthenticated requests. The probe is not following or handling 3xx for auth-gated routes.

**Fix:** Edit `audit-probe.mjs` — for the `/dashboard` check, treat 3xx (redirect) as GREEN (route deployed + Clerk-protected = correct behavior). Or probe a public sub-path. This false RED has inflated the overall "RED" count in every audit since it was introduced.

---

### P3 — `middleware.ts` → `proxy.ts` rename needed [PERSISTS since 2026-06-07]

`npm run build` emits: `"The 'middleware' file convention is deprecated. Please use 'proxy' instead."` File: `/home/user/lovable-clone/middleware.ts`. This was first flagged on 2026-06-07 and remains unaddressed after ~110 days.

**Fix:** `git mv middleware.ts proxy.ts` (update any imports), test worker proxy routes, then redeploy to Vercel.

---

### P3 — Dependabot PRs stale: #28 (97 days) and #47 (66 days) [PERSISTS]

| PR | Age | Change | Recommendation |
|---|---|---|---|
| #28 | 97 days | 2 package bumps across 3 directories (root npm_and_yarn group) | MERGE — comment `@dependabot rebase` first if conflict |
| #47 | 66 days | `fast-uri` 3.1.2→3.1.4 in /mcp-server (patch bump) | MERGE — low-risk patch |

Both have been open since before the June 7 report and remain unmerged.

---

### P3 — `TAVILY_API_KEY` / web_search status unconfirmed [PERSISTS since 2026-06-07]

The audit cannot verify web_search operability: `Bearer dev-local-user` is disabled in prod, blocking the `/api/chat` test that would fire the `web_search` tool. Static analysis confirms the code degrades gracefully (tool returns `"web_search is unavailable: TAVILY_API_KEY is not configured"`). If `TAVILY_API_KEY` is unset, users get no web search in AI chat turns.

**Fix:** Run a live chat turn forcing web search. If unavailable: `cd worker && wrangler secret put TAVILY_API_KEY`.

---

## 🔧 Auto-healed this run

**None needed.** The two operationally-autofixable REDs (voice box restart, pod start) both require `RUNPOD_API_KEY`, which is absent in the cloud environment. Flagged for Mario per policy.md.

---

## ✅ Verified WORKING

| Domain | Verdict | Evidence this run |
|---|---|---|
| **Worker infra** | 🟢 GREEN | `/health` → 200, `/api/spec.json` → 200 (openapi 3.1.0), `/api/projects` anon → 401 (correct). |
| **GitHub import route** | 🟢 GREEN | `/api/github/import` anon → 401 (deployed + auth-gated). |
| **Frontend HTTP** | 🟢 GREEN | `https://hswebappbuilder.space/` → 200; `/dashboard` → 307 Clerk redirect (correct, probe was wrong). |
| **Frontend build** | 🟢 GREEN | `next build` (Next.js 16.2.6 Turbopack) clean; **TypeScript: 0 errors**. 6 routes compiled. |
| **Sandpack unit guards** | 🟢 GREEN | `test-sandpack-alias.ts` 5/5 PASS; `test-sandpack-assets.ts` 9/9 PASS. |
| **Security — dev-bypass-prod** | 🟢 GREEN (RESOLVED) | `Bearer dev-local-user` → 401 in prod. `wrangler.toml` now has `ENVIRONMENT=production`, no `DEV_BYPASS_AUTH`. **Was P1 in June 7 report — now fixed.** |
| **Security — .dev.vars** | 🟢 GREEN | `.gitignore:53` covers `worker/.dev.vars`; `git ls-files worker/.dev.vars` → empty. |
| **Security — CORS** | 🟢 GREEN | `worker/src/index.ts`: exact-match origin allowlist via `buildOriginList`. No wildcard `*`. |
| **Security — auth.ts** | 🟢 GREEN | Dev-bypass gated on `devBypassEnabled` (false in prod); even local-dev bypass sets `isOwner:false` blocking privileged routes. |
| **Concierge wiring (code)** | 🟢 GREEN | `data-backend="selfhosted"` → `/boxapi` → `next.config.ts` rewrite → pod URL: chain intact in code. Pod itself is down (see P2 above). |

---

## 🩹 Hygiene backlog (P3 — batched, carry-forward)

- **27+ audit report PRs open** — all from past audit cycles, never meant to be merged. Creating noise in the PR queue. Batch-close with comment "audit log — closing PR, keeping branch."
- **middleware.ts → proxy.ts** (see Needs-Mario above, promoted for visibility)
- **`MODULE_TYPELESS_PACKAGE_JSON` warning** — `package.json` missing `"type":"module"`. Cosmetic, affects `--experimental-strip-types` runs.
- **Pod billed when idle** — unknown current billing state (pod appears stopped/404). If restarted, re-evaluate idle-shutdown strategy (~$0.69/hr × 24 hr = ~$500/mo when always-on).
- **Telegram/SMS not configured** — `POST /api/share/health` → telegram=false, sms=false. In-app phone sharing dark.
- **ESLint warnings** — 80+ warnings (`@typescript-eslint/no-explicit-any`, missing deps, `<img>` vs `<Image />`). Tech debt.
- **`GET /api/projects/<deleted-id>`** returns 200 `{"error":"Project not found"}` — should be 404.

---

## 🗂 GitHub Reconciliation (surface only — nothing merged)

| Branch | Age | Status | Recommendation |
|---|---|---|---|
| **`claude/builder-buddy-rail`** (PR #20) | 114 days | Open; last commit 2026-06-04. 114 days of drift from master (security hardening, Sonnet 5, Vercel domain, 32k token cap all landed since). | **REBASE THEN REVIEW** — real feature, but significant conflict risk. Must verify security/auth compat before merge. |
| **`dependabot/npm_and_yarn/…-5984bbb696`** (PR #28) | 97 days | Open; 2 package bumps across 3 dirs. | **MERGE** — comment `@dependabot rebase` first if conflict shown. |
| **`dependabot/npm_and_yarn/mcp-server/…-04db377a11`** (PR #47) | 66 days | Open; `fast-uri` 3.1.2→3.1.4 in /mcp-server. | **MERGE** — low-risk patch bump. |
| **`audit/report-*`** (32 branches) | Various | All audit log branches. 27+ open PRs. | **BATCH CLOSE PRs** (keep branches) to reduce PR queue noise. |
| `fix/sanitizer-icon-imports` | Gone | Not present on remote. | **No action needed** — merged or deleted since June 7. |
| `archive/windows-side-*` | Gone | Not present. | **Done** — prior ARCHIVE recommendation followed. |
| `backup/pr13-*` | Gone | Not present. | **Done** — prior ARCHIVE recommendation followed. |

---

## Δ vs 2026-09-22 (latest.md / PR #79)

| Item | Direction | Detail |
|---|---|---|
| P1 dev-bypass-prod | ✅ CONFIRMED RESOLVED | `Bearer dev-local-user` → 401; wrangler.toml has `ENVIRONMENT=production`. Was first flagged June 7; PR #79 title already noted "P1 RESOLVED". |
| Voice box down | ↔️ STILL DOWN | 79+ days. /healthz → 404. No change. |
| Dashboard probe RED | ↔️ STILL MISCONFIGURED | Actually a 307/Clerk redirect — 107+ days of false RED from probe. |
| Audit credential invalidated | 🆕 NEWLY DOCUMENTED | The 2026-08-09 security hardening invalidated `Bearer dev-local-user` for all audit live-tests. This is the root cause of "build engine: untested" in every cycle since. Formally documented this run. |
| Sandpack unit guards | ✅ GREEN | PASS (5/5 alias, 9/9 asset). Consistent with prior runs. |
| Frontend build | ✅ GREEN | 0 TypeScript errors. |
| Dependabot PRs | ↔️ STILL OPEN | PRs #28 and #47 unchanged. |
| fix/sanitizer-icon-imports | ✅ GONE | Merged or deleted since June 7 report. |
| archive/windows-side-* | ✅ GONE | Archived per recommendation. |
| backup/pr13-* | ✅ GONE | Archived per recommendation. |

---

## ⛔ Checks skipped for lack of cloud creds

| Check | Reason skipped | What to run locally |
|---|---|---|
| **Build engine E2E** | `Bearer dev-local-user` → 401 in prod; `MCP_API_KEY` not in cloud env | Update `audit-probe.mjs` to use `X-API-Key: <MCP_API_KEY>` OR run `--deep` locally with worker secrets available |
| **GitHub import live test** | Same auth reason | Same fix as above |
| **web_search / TAVILY** | Auth blocks the `/api/chat` test | Run live chat turn forcing web_search; if "unavailable": `wrangler secret put TAVILY_API_KEY` |
| **RunPod pod-power** | `RUNPOD_API_KEY` absent in cloud | `curl -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/udcz4k7kse1zw6` |
| **Vercel deploy-drift** | `VERCEL_TOKEN` absent in cloud | `vercel ls` / check Vercel dashboard |
| **Worker auto-redeploy self-heal** | `CLOUDFLARE_API_KEY`+email absent | Would run `selfheal.mjs` — worker is up, not needed this run |
| **Telegram notification** | No Telegram token in cloud | `notify_mario()` / `POST /api/share/phone` — local run only |
| **Box `POST /api/connect` session test** | RunPod broker token in `.dev.vars` | Test HMAC broker locally; confirm `connectUrl`+token returned |

---

## How this was produced

Tier-1 probe (`qa/audit/audit-probe.mjs --json`) → 4 parallel domain agents (build engine, frontend/import, security/wiring, GitHub reconciliation) → synthesis.
Probe JSON: `qa/audit/reports/latest-probe.json`.
Probe overall: RED (probe miscounts — 1 confirmed RED = voice box; 1 RED = probe bug; 9 YELLOW = cloud-cred limits or not-deep; 6 GREEN).
