# HS Web App Builder — Audit Report

**Date:** 2026-06-07 · **Run:** first full audit (baseline) · **Mode:** auto-fix safe / flag risky
**Overall: 🟠 YELLOW** — infrastructure healthy and verified, but the **build engine is down in prod** (external billing, not code).

Surfaces: app `https://hswebappbuilder.space` · worker `https://lovable-clone-backend.hssolutions2181.workers.dev` · voice box `udcz4k7kse1zw6` · master `8cd0b87` (in sync everywhere).

---

## 🚩 Needs Mario (ranked)

### P0 — Build engine DOWN: OpenRouter account out of credits
Every codegen call in prod (build, chat/ask, research, retarget, cinematic, improve-prompt) returns
**`Insufficient credits. Add more using https://openrouter.ai/settings/credits`** and produces **zero files**.
The product's core function is non-operational. The `OPENROUTER_API_KEY` secret is correctly configured
(we get a real OpenRouter error, not a "key missing" 500) — the **account balance is the problem**, not the code.
Default build model: `moonshotai/kimi-k2.6`.
- **Evidence:** live build on a throwaway project streamed `build_start → batch_start → page_status×3 → {"type":"error","error":"Insufficient credits…"}`, 0 files. Worker's own credit gate is fine (`dev-local-user` = unlimited/9999).
- **Fix (your call — billing, not auto-fixable):**
  1. **Top up** the OpenRouter account tied to the worker's key — fastest, restores everything. OR
  2. **Swap** the worker secret to a funded key: `cd worker && wrangler secret put OPENROUTER_API_KEY` (vault has a verified-working secondary key, but confirm it has build-volume balance first).
- After the fix: re-run a build to confirm `build_complete`+files, **and** re-run a `web_search` chat turn to settle the TAVILY question below.

### P1 — Anyone can be owner in prod (`Bearer dev-local-user`)
`wrangler.toml [vars]` ships `ENVIRONMENT="development"` + `DEV_BYPASS_AUTH="1"` to prod, so the static token
`Bearer dev-local-user` grants full owner identity + unlimited credits with no Clerk JWT. Confirmed live
(`/api/credits` → `tier:"unlimited", balance:9999`). The exact gate (`worker/src/middleware/auth.ts`):
```ts
const devBypassEnabled = c.env.ENVIRONMENT === "development" || c.env.DEV_BYPASS_AUTH === "1";
if (devBypassEnabled && header === "Bearer dev-local-user") { /* → owner */ }
```
- **Fix (CONFIRM-FIRST — not auto-applied):** set `ENVIRONMENT="production"` + drop `DEV_BYPASS_AUTH` in `worker/wrangler.toml` (move dev-bypass to `.dev.vars`/`[env.dev]`), then `wrangler deploy`. **Risk:** if your 245 live projects are owned by `dev-local-user` rather than your Clerk sub, flipping this HIDES them. **Verify first:** log into hswebappbuilder.space (real Clerk) and confirm your projects still show, *then* flip.

### P2 — Unmerged security update: hono 4.12.18 → 4.12.23 (Dependabot PR #21)
Prod runs **hono 4.12.18**, missing the 4.12.21 fixes for **4 GHSA advisories** (Set-Cookie injection, JWT
auth-scheme bypass, IP-restriction bypass, `app.mount` path routing) — directly relevant to a worker doing
auth + cookies. PR #21 is **lock-file only, clean merge (no conflicts)**.
- **Fix (flag — repo change):** merge PR #21, then `cd worker && wrangler deploy`. Low risk, high value.

### P2 — `web_search` likely dead (TAVILY_API_KEY unset)
The worker's web tools degrade gracefully ("…unavailable: TAVILY_API_KEY is not configured"), and
`wrangler.toml` never references TAVILY/FIRECRAWL secrets. Could not be confirmed at runtime — the OpenRouter
outage (P0) kills the model turn before any tool fires.
- **Fix (flag):** after P0, run a `web_search` chat turn; if unavailable, `wrangler secret put TAVILY_API_KEY` (+ `FIRECRAWL_API_KEY` for `web_scrape`).

---

## 🔧 Auto-healed this run
**None needed.** No operationally-fixable RED was present (worker/app/box all up; the P0 is external billing, not an operational outage the harness can restart). The self-heal engine ran and correctly took no action, flagging the items above instead.

---

## ✅ Verified WORKING (so you know what's solid)

| Domain | Verdict | Proven live this run |
|---|---|---|
| **Frontend / Projects** | 🟢 GREEN | `/`, `/dashboard`, `/editor/[id]` load; `next build` clean; **tsc 0 errors**; **eslint 0 warnings**; daily-QA all green; full create→version→asset-upload→serve lifecycle; dev-auth two-halves matched (200 w/ token, 401 without). |
| **GitHub Import** | 🟢 GREEN | Both Sandpack unit guards pass; real `dan5py/react-vite-shadcn-ui` import (22 files, 0 failed) **renders correctly, zero module errors**; images inline + render; caps sane (200 files/256KB/6MB; img 512KB/3MB). Unaffected by the codegen outage (pure file copy). |
| **Pet Concierge / Box** | 🟢 GREEN | Box RUNNING, `/healthz ok:true`, build `2026-06-06-hsreels-tts`, **18 tools (not stripped)**, voices `[will,jack]`, live sessions succeeding; broker `/api/connect` correctly HMAC-gated (401 without broker token); wiring intact (`agent_4101…`, `selfhosted`, `/boxapi` → live pod, no trailingSlash trap). |
| **Worker infra** | 🟢 GREEN | `/health`, `/api/spec.json`, project CRUD, **github import 201**, **export ZIP** (valid archive), supabase connect-status (PAT set), credits ledger — all 200, no 5xx. |
| **Deploy** | 🟢 GREEN | HEAD = origin/master = Vercel deployed = `8cd0b87`. No drift. |

---

## 🩹 Hygiene backlog (P3 — batched, none urgent)

- **Voice box has no auto-fallback** if it dies (builder voice goes hard-down). *Note:* the old fallback target (ElevenLabs) is itself quota-dead, so the real fix is box uptime/HA, not re-wiring EL. Repo edit → flag.
- **No wake/sleep controller** → pod billed **24/7 at $0.69/hr ≈ ~$500/mo** even at `active_sessions:0`. Needs an idle-watcher (stop on idle, broker wakes on demand).
- **Worker `package.json`** has no `typecheck`/`test` scripts. Add `"typecheck":"tsc --noEmit"`.
- **Prod worker Telegram/SMS not configured** (`share/health` → telegram=false, sms=false) — the in-app "share project" channel is off (the audit's own Telegram uses the local notify path, unaffected).
- **Projects GET after DELETE** returns HTTP 200 with `{"error":"Project not found"}` (should be 404) — cosmetic.
- **Next 16 warnings:** stray `/home/mario/package-lock.json` makes Turbopack infer the wrong workspace root; `middleware.ts` should become `proxy.ts` before a future Next major drops the shim.
- **Editor console noise** from external Sandpack/CodeSandbox CDN (third-party, not our code).

---

## 🗂 GitHub reconciliation (surface only — nothing merged)

| Branch / repo | What it is | Recommendation | Reason |
|---|---|---|---|
| **dependabot/…hono** (PR #21) | hono security bump, lock-only | **BRING IN** | clean merge; fixes 4 advisories (see P2) |
| **fix/sanitizer-icon-imports** (PR #7) | old "Home is not defined" fix | **ARCHIVE / close** | already superseded in master; 86 commits behind, conflicts |
| **claude/builder-buddy-rail** (PR #20) | docked Space Mario rail + 3778-line pc-embed.js | **IGNORE / hold** | defaults to dead ElevenLabs backend, conflicts with voice cutover; UI salvageable only after EL-stripping rebase |
| **archive/windows-side-2026-05-11** | merged historical snapshot | **ARCHIVE (delete)** | 0 ahead of master |
| **backup/pr13-pre-resolve-2026-05-12** | merged backup snapshot | **ARCHIVE (delete)** | 0 ahead of master |
| `OneDrive/…/HS-APP-BUILDER` | old GPT-5 scaffold (Sep 2025) | **ARCHIVE** | separate 8-mo-stale lineage; nothing unique to import |
| `OneDrive/…/hs lovable app` | self-labeled `_RETIRED_…_DELETE_ME` | **ARCHIVE/DELETE** | only loose client `*_profile.md` briefs worth keeping |
| `Projects/lovable-clone` | stale Windows dup | n/a | already deleted |
| `Projects/lovable-startup` (watchdog) · `Projects/lovable-mcp` (companion MCP) | active infra / dormant sibling | **KEEP** | healthy, intentional |

**The "old Lovable attempts that never worked" contain no unique unfinished work to bring into the live app.**

---

## Δ vs last run
Baseline — first audit. Next run (2026-06-10) diffs against this.

## How this was produced
Tier-1 deterministic probe (`qa/audit/audit-probe.mjs`) → self-heal (`qa/audit/selfheal.mjs`) → 6 parallel
domain agents (`qa/audit/RUNBOOK.md`) → this synthesis. Probe JSON: `qa/audit/reports/latest-probe.json`.
