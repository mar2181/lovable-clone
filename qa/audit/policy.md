# HS Builder Audit — Self-Heal Policy Matrix

> Single source of truth for what the audit fixes on its own vs. what it flags for Mario.
> Cited by `selfheal.mjs` and by every deep-audit agent. Decision locked with Mario
> 2026-06-07: **auto-fix safe (operational), flag risky.**

## The one hard rule

**Auto-fix = operational recovery only. It NEVER runs `git`/commit/push.**
Anything that changes a file in a repo — even a one-character URL fix — is **FLAGGED**
with a ready-to-apply diff + the standard "push to GitHub / Vercel / VPS?" question.
This honors Mario's global no-auto-commit rule.

## AUTO-FIX (safe, reversible, no repo change)

| Trigger (probe finding) | Action | Verify after |
|---|---|---|
| `concierge/pod-power` = RED (pod EXITED/stopped) | `POST https://rest.runpod.io/v1/pods/<id>/start` | re-GET pod → RUNNING, then `/healthz` ok |
| `concierge/box-health` = RED (pod RUNNING but box unreachable/mute) | `POST <box>/dashboard/agent/restart`; if still dead, pod stop→start | `/healthz` → `ok:true` |
| `worker/route-deployed` = RED **404** (route in repo, missing in prod = forgotten deploy) | `cd worker && wrangler deploy` (CF Global API Key+email from vault) — deploys the **already-committed** code, no new code | gated route → 401 |
| `import/route` = RED 404 | same worker redeploy | `/api/github/import` anon → 401 |
| `deploy/drift` = RED (origin/master ≠ Vercel, deploy failed/missing) | retrigger Vercel deploy of the **existing** commit via API | new deployment READY, sha matches origin |
| box CORS origin missing for a fleet domain | add origin to box `agent.env` `PETBUDDY_CORS_ORIGINS` + bounce `agent.py` | origin no longer `400 Disallowed CORS` |
| expired operational token (e.g. box TTS token) | refresh into its secret store (env/secret), not the repo | dependent call succeeds |

Every auto-action is appended to the run's `actions[]` log with before/after evidence and
reported to Mario (it healed, but he still sees what happened).

## FLAG (needs Mario — never done autonomously)

| Finding | Why flagged | What the report hands Mario |
|---|---|---|
| `security/dev-bypass-prod` = RED | Flipping `ENVIRONMENT=production` / dropping `DEV_BYPASS_AUTH` MAY hide projects owned by `dev-local-user`. Confirm-first. | exact wrangler.toml diff + a "log in, confirm your projects show, then deploy" check |
| `security/devvars-in-git` = RED (tracked) | Rotating live keys is high blast-radius | `git rm --cached` + gitignore steps + the full rotate-these-keys list |
| Any `*/wiring`, `*/proxy-target`, `hygiene/*` RED/YELLOW that needs a repo edit | Touches repo files → no auto-push | the diff + push question |
| Raising GitHub-import caps (200 files / 256KB / 6MB) | Product decision | the change + tradeoff |
| `github/branches` reconciliation | Mario chose surface-for-review | per-branch bring-in / ignore / archive recommendation |
| Build-pipeline / chat producing wrong output (not just down) | Quality judgement | examples + proposed prompt/code fix |

## Severity → urgency

- **P0** outage (app/worker/box down, stale proxy URL = total voice outage) → auto-fix if operational, else page Mario immediately in the Telegram summary.
- **P1** security (dev-bypass prod, committed secrets, auth wide open) → always flag, top of report.
- **P2** broken feature (import render fails, a route 404s) → auto-fix if it's a forgotten deploy, else flag.
- **P3** hygiene (missing typecheck script, idle-pod cost, branch housekeeping) → flag, batched.

## Telegram summary contract (every run)

```
HS Builder Audit <DATE> — <GREEN|YELLOW|RED>
✅ healthy: <n>   ⚠️ <n>   ❌ <n>
🔧 auto-healed: <list or "none">
🚩 needs you: <P1/P0 flags, one line each + fix>
Δ vs last: <resolved / new / regressed>
report: qa/audit/reports/<date>.md
```
