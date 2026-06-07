# HS Web App Builder — Audit Runbook

The repeatable, self-healing audit. Runs **every 3 days** from a cloud scheduled agent
(and on demand). Tool-agnostic: the orchestrator fans out 6 domain agents (via the Agent
tool or a Workflow), each consuming the deterministic probe, each returning structured
findings. Decisions locked 2026-06-07: **auto-fix safe / flag risky · every 3 days +
Telegram · surface GitHub work for review · cloud run.**

## Inputs every agent gets
- The Tier-1 probe JSON: `node qa/audit/audit-probe.mjs --json` (ground truth — do not
  re-derive health, build on it). Persisted at `qa/audit/reports/latest-probe.json`.
- The policy matrix: `qa/audit/policy.md` (auto-fix vs flag).
- Repo at `AUDIT_ROOT` (default `/home/mario/lovable-clone`; cloud run `git clone` first).

## Orchestration (the scheduled agent does this)
1. **Probe** — run `audit-probe.mjs --json` with env `RUNPOD_API_KEY`, `VERCEL_TOKEN`
   (from vault). Capture JSON.
2. **Self-heal** — `node qa/audit/selfheal.mjs` (operational fixes only; needs
   `CLOUDFLARE_API_KEY`+`CLOUDFLARE_EMAIL` to redeploy worker, `RUNPOD_API_KEY` to wake box).
   Re-run the probe after, to confirm heals took.
3. **Deep agents** — fan out the 6 missions below IN PARALLEL, each returns
   `{findings:[{severity,title,detail,autofixable,fix,evidence}], summary}`.
4. **Synthesize** — dedupe vs probe, rank P0→P3, diff vs previous `reports/latest.md`,
   write `reports/<YYYY-MM-DD>.md` + `latest.md`.
5. **Telegram** — send the summary (contract in policy.md) via the worker
   `POST /api/share/phone` OR `notify_mario()` snippet.

## The 6 deep missions

### 1 — Pet Concierge / Voice Box
- Confirm probe's box-health + pod-power. Deep: `POST <box>/api/connect` once → expect a
  Daily `connectUrl`+token (real session can start), then stop. Read `<box>/dashboard/tools`
  / `/healthz` `tools.count` — the agent row must NOT be stripped to generic nav-only
  (cutover bug). Check `tts.voices` includes the intended clone (will/jack).
- Read `components/pet-concierge.tsx` + `public/space-mario-buddy.js`: wiring intact, agent_id
  present, no auto-fallback gap (hardening flag).
- Flag any repo edit (wiring/proxy). Auto-fix only pod/box recovery.

### 2 — Worker (build engine)
- Deep build E2E: `audit-probe.mjs --deep` OR create project → `POST /api/build` → assert SSE
  `build_complete` with files → delete. This is the product's core; P0 if it fails.
- Test web tools: run a `/api/chat` turn that forces `web_search` — if "unavailable",
  `TAVILY_API_KEY` is unset (flag `wrangler secret put`).
- Read `worker/src/middleware/auth.ts`: confirm the exact dev-bypass condition the probe flagged.
- Smoke: github import (octocat/Spoon-Knife → 201 → delete), vercel deploy path, supabase
  connect-status, export ZIP. Note any 5xx.

### 3 — App / Projects (frontend)
- Run `node qa/lovable-daily-qa.mjs` against prod (`LOVABLE_FRONTEND_URL=https://hswebappbuilder.space`
  `LOVABLE_WORKER_URL=<worker prod>`). Parse its report: list/create/open project, editor
  preview renders, zero real console errors, destructive buttons absent.
- Build/typecheck/lint in WSL: `npm run build` (includes tsc), `npm run lint`. Report failures.
- dev-auth two-halves still matched.

### 4 — App / GitHub Import feature
- Unit guards: `node --experimental-strip-types qa/test-sandpack-alias.ts` and
  `qa/test-sandpack-assets.ts` (must pass — #1 import breakage).
- Live render: `node qa/verify-import-render.mjs <id>` + `qa/verify-image-render.mjs <id>`
  against prod (import a fresh small repo first if needed).
- Confirm import caps + image-capture-at-import gotcha noted.

### 5 — GitHub reconciliation (surface only)
- `gh` is authed in WSL as mar2181. For each non-master branch (probe lists them — currently:
  `dependabot/npm_and_yarn/*`, `fix/sanitizer-icon-imports`, `claude/builder-buddy-rail`,
  `archive/windows-side-*`, `backup/pr13-*`): age, what it changes (`gh pr list`,
  `git log master..<branch> --oneline`, `git diff --stat master...<branch>`), conflict status,
  and a **bring-in / ignore / archive** recommendation. Also the stale Windows/OneDrive
  checkouts. NEVER merge.

### 6 — Security + Synthesis
- Aggregate all findings + probe. Confirm: dev-bypass-prod (P1), `.dev.vars` git status,
  CORS allowlist, PAT exposure. Rank, dedupe, diff vs last report. Emit report + Telegram payload.

## Severity ladder
P0 outage · P1 security · P2 broken feature · P3 hygiene. (See policy.md.)
