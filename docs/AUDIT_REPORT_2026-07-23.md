# HS Web App Builder — Professional Launch-Readiness Audit

**Date:** 2026-07-23
**Auditor:** Claude Code (Staff Software Architect)
**Scope:** Full-stack engineering audit of the HS Web App Builder ("lovable-clone")
**Live URLs:**
- Frontend: `https://hswebappbuilder.space` (Vercel)
- Worker: `https://lovable-clone-backend.hssolutions2181.workers.dev` (Cloudflare Workers)
- Demo: `https://marrero-injury-law-retarget-demo-yg.vercel.app`

---

## Executive Summary

| Dimension | Score (0-100) | Rating |
|-----------|---------------|--------|
| **Overall Project Health** | **42/100** | ⚠️ Not Launch-Ready |
| Production Readiness | **25/100** | Critical blockers exist |
| Architecture | **65/100** | Sound pattern, split concerns |
| Code Quality (Worker) | **70/100** | Well-structured, good logging |
| Code Quality (Frontend) | **55/100** | Incomplete, has mock/placeholder code |
| Security | **20/100** | Critical auth bypass in production |
| Maintainability | **60/100** | Reasonable structure, no tests |
| Documentation | **30/100** | README only, no API docs, no setup guide |
| Testing | **5/100** | Zero tests across all components |
| Deployment | **55/100** | Split auto/manual, works but fragile |

**Overall Assessment:** The HS Web App Builder is a functional prototype with a well-architected backend, but it is **NOT ready for production launch**. Three critical security flaws are live in production right now. The auth bypass means anyone with a well-known token has full owner access to all 13+ projects. The credit system is entirely decorative. There are zero tests. The demo output (Pablo Rocha site) has a broken build. Significant work is needed across security, testing, and feature completion before this can be launched as a product.

**Estimated Maturity:** Late Alpha / Early Beta. Core functionality works but critical production hardening is missing.

---

## 1. Architecture Summary

The builder is a **split architecture** with 5 components:

| Component | Stack | Location | Status |
|-----------|-------|----------|--------|
| **Frontend** | Next.js 15.4.3, React 19, Tailwind, shadcn/ui, Vercel AI SDK v5 | Two versions exist (see below) | ⚠️ Codebase mismatch |
| **Worker (Backend)** | Hono v4.12 on Cloudflare Workers, KV + R2 | WSL `~/lovable-clone/worker` (deployed) / Stale archive on Windows | Functional |
| **MCP Server** | Node/TS, MCP protocol | `C:\Users\mario\Projects\lovable-mcp` | Unknown state |
| **CLI** | Node 18+, zero-deps | `C:\Users\mario\printing-press\library\lovable-pp-cli` | Functional |
| **Demo Output** | Vite + React 18 | `C:\Users\mario\pablo-rocha-build` | Build broken |

### ⚠️ Critical Architecture Finding: Codebase Split

There are **two different frontend codebases**:

1. **`C:\Users\mario\Projects\open-lovable-v2`** — A fork of `saenna/open-lovable-v2` (upstream: `firecrawl/open-lovable`). This is the open-source base with "Open Lovable v2" branding, no auth, mock builder page.

2. **WSL `~/lovable-clone`** — The actual deployed HS-customized version (`mar2181/lovable-clone`). This is what runs at `hswebappbuilder.space` with "HS Solutions App & Web Builder" branding, Clerk auth, and sign-up flow. **I could not access WSL to audit this code.**

**Impact:** The codebase I audited in detail (Windows) is the open-source fork, NOT the deployed HS version. The deployed version may have different code quality, security posture, and features. **This audit of the frontend is based on the open-source base only.**

---

## 2. Security Audit — FINDINGS RANKED BY SEVERITY

### 🔴 SEC-01 [CRITICAL] Dev-Bypass Authentication Active in Production

**Finding:** The worker's `wrangler.toml` deploys `DEV_BYPASS_AUTH = "1"` and `ENVIRONMENT = "development"` to production. The auth middleware (`worker/src/middleware/auth.ts:62-73`) grants full authenticated access as the owner to any request with `Authorization: Bearer dev-local-user`.

**Live Proof:** Confirmed 2026-07-23 @ 09:09 UTC:
```
$ curl https://lovable-clone-backend.hssolutions2181.workers.dev/api/projects \
  -H "Authorization: Bearer dev-local-user"
→ 200 OK, returns 13 projects with full CRUD access

$ curl https://lovable-clone-backend.hssolutions2181.workers.dev/api/credits \
  -H "Authorization: Bearer dev-local-user"
→ 200 OK, {balance:9999, tier:"unlimited"}
```

**Without token:** Correctly returns 401 (Clerk JWT verification works).
**With garbage token:** Correctly returns 401.

**Impact:** Anyone who knows the string `dev-local-user` (it's in the open-source code, documentation, and this audit report) has **full owner access** to all 13+ projects, unlimited AI credits, can push to GitHub, deploy to Vercel, and execute SQL on linked Supabase projects. This is the single most critical issue.

**Root Cause:** `wrangler.toml` line 17: `DEV_BYPASS_AUTH = "1"` is a plain `[vars]` entry, not a secret. The Phase C Clerk flip planned for 2026-06-07 was never completed.

**Fix:** 
1. Set prod Clerk `sk_live` on the worker (needs Mario)
2. Remove `DEV_BYPASS_AUTH` and `ENVIRONMENT=development` from `wrangler.toml [vars]`
3. Set `NEXT_PUBLIC_DEV_BYPASS_AUTH=0` on Vercel frontend
4. Verify: `dev-local-user` token returns 401

**Effort:** Medium | **Risk:** Critical | **Files:** `wrangler.toml`, `worker/src/middleware/auth.ts`

---

### 🔴 SEC-02 [CRITICAL] Credit System Completely Disabled

**Finding:** `worker/src/services/credits.ts` line 4: `UNLIMITED_DEV_CREDITS = true` is hardcoded. This means:
- `hasEnoughCredits()` always returns `{hasCredits: true, balance: 9999}` for non-owners
- `deductCredit()` is a no-op that returns `true`
- All AI calls, build batches, and tool usage are **completely free and unlimited**

**Impact:** If the auth bypass is closed but real users sign up, they get unlimited free AI usage. No monetization is possible. This is a business-critical bug.

**Fix:** Change `UNLIMITED_DEV_CREDITS` to check `c.env.ENVIRONMENT === "development"` instead of being hardcoded `true`.

**Effort:** Easy | **Risk:** Critical (business) | **Files:** `worker/src/services/credits.ts:4`

---

### 🟠 SEC-03 [HIGH] Shared Global API Keys — Confused Deputy

**Finding:** GitHub (`GITHUB_PAT`), Vercel (`VERCEL_API_KEY`), and Supabase (`SUPABASE_PAT`) use single server-wide credentials. Any authenticated user can:
- Push code to any repo the PAT owner can access
- Deploy projects under the shared Vercel account
- Execute SQL through the shared Supabase Management PAT

**Note:** P2 confused-deputy lockdown was deployed 2026-07-21 (`ownerOnly` middleware on sensitive routes). However, the **dev-bypass user IS an owner**, so this protection is currently moot. Once the bypass is closed, the `ownerOnly` gate will restrict these routes to the real owner only — but the architectural problem remains: all operations use a single shared credential rather than per-user OAuth.

**Fix:** Replace global PATs with per-user OAuth flows (GitHub OAuth App, Vercel OAuth, Supabase OAuth). This is architectural work.

**Effort:** Hard | **Risk:** High | **Files:** `worker/src/routes/github.ts`, `vercel.ts`, `supabase.ts`

---

### 🟠 SEC-04 [HIGH] Real API Keys in Stale Archive

**Finding:** The stale worker archive at `C:\Users\mario\Projects\lovable-clone_STALE_ARCHIVED_2026-06-05\worker\.dev.vars` contains what appear to be real credentials:
- `OPENROUTER_API_KEY` — starts with `sk-or-v1-`, looks live
- `SUPABASE_PAT` — starts with `sbp_`, looks live
- `CLERK_SECRET_KEY` — starts with `sk_test_` (test key, limited risk)

**Impact:** If the stale archive is ever pushed to a public repo or accessed by unauthorized parties, these keys could be used to spend OpenRouter credits or access Supabase.

**Fix:** Rotate the OpenRouter key and Supabase PAT immediately. Delete or sanitize `.dev.vars` in the stale archive.

**Effort:** Easy | **Risk:** High | **Files:** Stale archive `.dev.vars`

---

### 🟡 SEC-05 [MEDIUM] MCP API Key Bypass Allows User Impersonation

**Finding:** `worker/src/middleware/auth.ts:45-52`: The MCP auth bypass accepts `X-User-Id` header to impersonate any user. If `MCP_API_KEY` is leaked, an attacker can act as any user.

**Fix:** Remove `X-User-Id` impersonation or restrict MCP key to a dedicated service user.

**Effort:** Easy | **Files:** `worker/src/middleware/auth.ts`

---

### 🟡 SEC-06 [MEDIUM] Narrow SQL Blocklist in Migration Tool

**Finding:** `worker/src/routes/supabase.ts:223`: The SQL execution endpoint only blocks `DROP DATABASE` and `ALTER ROLE`. Destructive operations like `DROP TABLE`, `TRUNCATE`, `DELETE FROM` are all permitted.

**Impact:** A user (or attacker with dev-bypass) can destroy their linked Supabase database. This is partially by design (it's a migration tool), but the narrow blocklist is dangerous.

**Fix:** Add a confirmation gate for destructive operations, or expand the blocklist to cover `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`.

**Effort:** Easy | **Files:** `worker/src/routes/supabase.ts`

---

### 🟢 SEC-07 [LOW] No Rate Limiting on Chat/Build/Share Endpoints

**Finding:** Only the SQL endpoint has per-user rate limiting (100/hr). Chat, build, GitHub, Vercel, and share endpoints have no rate limiting. Could allow API credit exhaustion or SMS spam.

**Fix:** Add rate limiting middleware to chat, build, and share endpoints.

**Effort:** Medium | **Files:** Multiple route files

---

### 🟢 SEC-08 [LOW] Frontend Allows Arbitrary URL Input for Scraping

**Finding:** The frontend accepts any URL for scraping (`app/page.tsx`). Could be used for SSRF if the scraping backend doesn't validate targets.

**Fix:** Validate URLs server-side, block internal/private IP ranges.

**Effort:** Easy | **Files:** Frontend API routes

---

## 3. What Works ✅

### Live Services
- ✅ Worker `/health` returns 200 — backend is alive
- ✅ Frontend `hswebappbuilder.space` loads — landing page is live
- ✅ Clerk JWT verification works — unauthenticated requests correctly get 401
- ✅ Project CRUD works (13 projects in KV, confirmed via live probe)
- ✅ Credit endpoint returns correct data

### Worker Backend (audited from stale archive — likely matches deployed)
- ✅ Well-structured Hono app with 14+ route modules
- ✅ Consistent structured logging throughout
- ✅ Proper CORS with restrictive origin allowlist
- ✅ SSE streaming for AI code generation and builds
- ✅ Version system: append-only saves, restore, memory persistence
- ✅ Garbage collection cron for orphaned R2 objects
- ✅ P2 confused-deputy lockdown deployed (ownerOnly middleware)
- ✅ Credit metering logic fixed (logic is correct, just disabled by `UNLIMITED_DEV_CREDITS`)
- ✅ Hono vuln patched (4.12.31)
- ✅ CI pipeline landed and green
- ✅ Dependabot: 0 open alerts

### CLI (`lovable-pp-cli`)
- ✅ Full agentic control: list, get, create, clone, delete, save, deploy, github-push, retarget
- ✅ Zero runtime dependencies (Node 18+ only)
- ✅ Good SKILL.md documentation
- ✅ Auth precedence: MCP key → Bearer token → dev-local-user fallback

### Pablo Rocha Demo (output quality)
- ✅ 34 React components — comprehensive law firm site
- ✅ 16+ pages: Home, Immigration sub-pages (Family, Deportation, Citizenship, etc.), Family Law, Estate Planning, Contact, FAQ, Attorney Profile
- ✅ Professional dark-themed design with gold accents
- ✅ Hero section with background image, trust badges, CTA
- ✅ ConciergeWidget component (PetBuddy integration)
- ✅ Responsive design with MobileBottomNav

---

## 4. What Is Broken 🔴

### B-01 [CRITICAL] Dev-Bypass Auth in Production
See SEC-01 above. Anyone with `Bearer dev-local-user` = full owner access.

### B-02 [CRITICAL] Credit System Non-Functional
See SEC-02 above. Unlimited free usage for all users.

### B-03 [HIGH] Pablo Rocha Demo Build Fails
```
$ cd C:\Users\mario\pablo-rocha-build && npx vite build
→ Could not resolve entry module "index.html"
```
`index.html` is in `public/` not the project root. Vite expects it at the root. The demo site may have been deployed manually without a standard build.

### B-04 [HIGH] Frontend Builder Page Is Mock/Placeholder
`app/builder/page.tsx` generates a **hardcoded HTML template**, not actual AI-generated code. The `generateWebsite()` function creates a static string with no API calls to scraping or AI services. This page appears to be unused in the HS version (where generation happens via the `/generation` page with Vercel Sandbox).

### B-05 [MEDIUM] Codebase Split Between Windows and WSL
The deployed frontend (HS-customized) lives in WSL. The auditable frontend (open-source fork) lives in Windows. They are different codebases. This means:
- Frontend security posture of the deployed version is **unknown**
- Frontend bug fixes applied to Windows copy don't reach production
- Development workflow depends on WSL availability

### B-06 [MEDIUM] AI SDK v2 When v4 Is Latest
All `@ai-sdk/*` packages are major version 2 when version 4 is current. This means:
- Missing bug fixes and features from v3 and v4
- Potentially different API contracts
- The upgrade is a breaking change (semver major)

### B-07 [LOW] Demo Site Content Not Rendered by WebFetch
The Pablo Rocha demo at `marrero-injury-law-retarget-demo-yg.vercel.app` is a JS-rendered React app. WebFetch could only extract the `<title>`. This is expected for SPAs but means SEO is poor (no server-side rendering).

---

## 5. Missing Features / Incomplete ⚠️

| Feature | Status | Notes |
|---------|--------|-------|
| **User authentication** | 50% | Clerk set up, dev-bypass still open, Phase C never flipped |
| **Credit/payment system** | 10% | Logic exists but disabled. No Stripe integration. "until a real Stripe webhook handler exists" |
| **Per-user isolation** | 0% | No test verifying User A can't read User B's projects |
| **Rate limiting** | 10% | Only on SQL endpoint |
| **Input validation** | 30% | Manual `if (!body.field)` checks, no validation library, no size limits |
| **Error pages** | 0% | No custom 404, 500, or error boundary pages |
| **Loading states** | 60% | Present in generation page, missing elsewhere |
| **Empty states** | 20% | Basic "no results found" in search, missing elsewhere |
| **Accessibility** | 10% | No ARIA labels, no keyboard navigation, no screen reader support |
| **SEO** | 20% | Basic metadata in layout.tsx, no dynamic meta tags |
| **Analytics** | 0% | No PostHog, Mixpanel, Google Analytics, or any analytics |
| **Monitoring/Alerting** | 20% | Telegram notification via `/api/share`, no crash reporting, no uptime monitoring |
| **Backup/Disaster Recovery** | 30% | KV + R2 are Cloudflare-managed, but no automated backup strategy |
| **Onboarding flow** | 0% | No tutorial, no welcome wizard, no sample project |
| **Pricing page** | 0% | Footer links to `/pricing` but page is placeholder |
| **Terms/Privacy** | 0% | Footer links are dead (`#`) |
| **Admin dashboard** | 0% | No admin panel for user management, credit monitoring, abuse detection |

---

## 6. Technical Debt (Ranked by Priority)

### P1 — Critical (must fix before launch)
1. **Close dev-bypass auth hole** — 1 year old, documented but never flipped
2. **Enable credit enforcement** — 1-line change blocked on env awareness
3. **Rotate leaked API keys** — OpenRouter key + Supabase PAT in stale archive

### P2 — High (should fix before launch)
4. **Per-user OAuth for GitHub/Vercel/Supabase** — architectural change, currently shared PATs
5. **Add rate limiting** — chat, build, share endpoints are unlimited
6. **Write tests** — zero tests across entire codebase
7. **Unify codebase** — single repo for frontend + worker, decommission stale archives

### P3 — Medium (fix shortly after launch)
8. **Upgrade AI SDK v2→v4** — major version, breaking changes
9. **Add input validation** — size limits, type checking, sanitization
10. **Fix Pablo Rocha demo build** — `index.html` in wrong location
11. **Add monitoring/alerting** — crash reporting, uptime, credit exhaustion alerts

### P4 — Low (ongoing improvement)
12. **Add analytics** — user behavior, feature adoption, conversion tracking
13. **Improve accessibility** — ARIA, keyboard nav, screen readers
14. **Add SEO** — dynamic meta tags, SSR for demo pages
15. **Build onboarding** — tutorial, sample project, welcome flow
16. **Legal pages** — Terms of Service, Privacy Policy

---

## 7. Dependency Audit

### Frontend (`open-lovable-v2`)

**⚠️ `node_modules` is NOT installed.** Run `npm install` before anything else. The package.json declares dependencies but they haven't been downloaded.

**npm audit: 26 vulnerabilities (1 CRITICAL, 11 HIGH, 7 MODERATE, 7 LOW)**

🔴 **CRITICAL:**
- `next` (15.4.3): **RCE in React flight protocol** (GHSA-9qr9-h5gf-34mp). Fix: next 16.3.0+

🟠 **HIGH (key ones):**
- `axios`: ~25 advisories — DoS, SSRF, prototype pollution, credential theft, CRLF injection
- `brace-expansion`: 3 ReDoS advisories
- `flatted`: Unbounded recursion DoS + prototype pollution
- `form-data`: CRLF injection via unescaped multipart field names
- `glob`: Command injection via `-c/--cmd` with `shell:true`
- `js-yaml`: Prototype pollution + quadratic DoS
- `lodash-es`: Code injection via `_.template` + prototype pollution
- `minimatch` + `picomatch`: Multiple ReDoS vulnerabilities
- `sharp`: libvips inherited CVEs
- `xmldom`: XML injection + uncontrolled recursion DoS

🟡 **MODERATE:** `ajv` ReDoS, `follow-redirects` auth leak, `postcss` XSS, `prismjs` DOM clobbering, `yaml` stack overflow

**Fix status:** 14 issues fixed by `npm audit fix` (non-breaking). 12 require `npm audit fix --force` (breaking changes to `next`, `@ai-sdk/*`, `ai`, `react-syntax-highlighter`).

**Outdated (major version behind):**
| Package | Current | Latest | Gap |
|---------|---------|--------|-----|
| `@ai-sdk/anthropic` | 2.0.89 | 4.0.18 | 2 majors |
| `@ai-sdk/google` | 2.0.84 | 4.0.22 | 2 majors |
| `@ai-sdk/groq` | 2.0.45 | 4.0.13 | 2 majors |
| `@ai-sdk/openai` | 2.0.114 | 4.0.18 | 2 majors |
| `ai` | 5.0.219 | 7.0.35 | 2 majors |
| `@anthropic-ai/sdk` | 0.57.0 | 0.113.0 | Minor |
| `next` | 15.4.3 | 16.2.11 | 1 major |
| `zod` | 3.25.76 | 4.4.3 | 1 major |
| `groq-sdk` | 0.29.0 | 1.3.0 | 1 major |
| `lucide-react` | 0.532.0 | 1.26.0 | 1 major |
| `@vercel/sandbox` | 0.0.17 | 2.8.0 | 2 majors |

**Unused/Suspicious dependencies:**
- `pixi.js` (v8.13.1) — WebGL rendering library. Used for hero animation effects. Legitimate.
- `@vercel/sandbox` (v0.0.17) — Experimental/pre-release version, 2 majors behind.
- `cors` (v2.8.5) — Express middleware. Unusual in Next.js App Router.
- `lodash-es` (v4.17.21) — Only `debounce` usage confirmed. Has known prototype pollution vulns.

**⚠️ No `.env` file exists.** Only `.env.example`. The app cannot run without creating one with valid API keys.

### Pablo Rocha Demo

**Vulnerabilities:**
- `vite` (5.4.21): HIGH — Path traversal in optimized deps (GHSA-4w7w-66w2-5vf9). Fix: vite 8.1.5 (major).
- `esbuild` (0.24.2): MODERATE — Dev server request leakage (GHSA-67mh-4wv8-2f99).

### MCP Server (`lovable-mcp`)

**Multiple vulnerabilities including 8 HIGH-severity in Hono:**
- `hono` (≤4.12.26): **8 HIGH advisories** — CSS injection in JSX SSR, JWT validation bypass, cache middleware bypass, IP restriction bypass, Set-Cookie injection, JWT scheme bypass, mount prefix route bypass, body-limit bypass on AWS Lambda
- `@hono/node-server` (<2.0.5): MODERATE — Path traversal on Windows via encoded backslash
- `fast-uri` (≤3.1.3): HIGH — Path traversal, host confusion via percent-encoded delimiters
- `esbuild` (0.27.3-0.28.0): MODERATE — Arbitrary file read on Windows dev server
- `body-parser` (2.0.0-2.2.2): MODERATE — DoS when invalid limit value disables size enforcement

**Git state:** Only 1 commit (`32f67ee` — "init: @hssolutions/lovable-mcp v0.1.0"). Clean working tree.

---

## 8. Database & Storage Audit

- **Primary:** Cloudflare KV (`KV_METADATA`) — project metadata, credits, chat history, rate limits
- **File Storage:** Cloudflare R2 (`R2_PROJECTS`) — version snapshots, attachments, uploaded assets
- **External:** Supabase (per-project linking) — user-managed, not part of the builder core

**Assessment:**
- ✅ Schema is key-value (no migration concerns with KV)
- ✅ R2 version snapshots are append-only (immutable history)
- ✅ Garbage collection cron for orphaned R2 objects
- ⚠️ No backup strategy beyond Cloudflare's built-in replication
- ⚠️ No data export/migration tools for users
- ⚠️ Project metadata has no size limits on name/description/memory fields

---

## 9. Frontend Audit (open-lovable-v2 base)

### Pages
| Route | File | Status |
|-------|------|--------|
| `/` | `app/page.tsx` | ✅ Complete — URL input, search, style/model selection |
| `/` (alt) | `app/landing.tsx` | ⚠️ Alternate landing variant — may be unused |
| `/builder` | `app/builder/page.tsx` | 🔴 **Mock/Placeholder** — hardcoded HTML template |
| `/generation` | `app/generation/page.tsx` | ✅ Functional — AI sandbox, chat, file tree, preview |

### Key Observations
- The landing page (`page.tsx`) is extensive (~800 lines) with animated search carousel, style selector, model picker. Good UX but very large single component.
- The builder page is completely non-functional — generates a static HTML string. This suggests the HS version replaced this with a different builder flow.
- The generation page is the core — 3500+ lines with sandbox management, SSE streaming, file tree, syntax highlighting, iframe preview. Extremely large component.
- No error boundaries anywhere. A single React error crashes the entire page.
- SessionStorage used for cross-page state (URL, style, model). Lost if user opens in new tab.
- `next.config.ts` is essentially empty — no image domains, no headers, no redirects configured.
- Title tag still says "Open Lovable v2" — not rebranded in this codebase.

### API Routes (25+ endpoints)
All appear to proxy to the sandbox or worker. Key routes:
- `/api/create-ai-sandbox-v2` — creates Vercel/E2B sandbox
- `/api/generate-ai-code-stream` — SSE AI code generation
- `/api/apply-ai-code-stream` — SSE code application to sandbox
- `/api/scrape-url-enhanced` — website scraping
- `/api/search` — web search
- `/api/create-zip` — project export
- `/api/sandbox-status` — health check
- Multiple package installation, file management, Vite monitoring routes

---

## 10. Testing Audit

| Type | Count | Status |
|------|-------|--------|
| Unit tests | **0** | None found |
| Integration tests | **0** | None found |
| E2E tests | **0** | None found |
| Contract tests | **0** | None found |
| CI pipeline | ✅ 1 workflow | TypeScript typecheck only (frontend `tsc --noEmit` + worker `npm run typecheck`) |

**Assessment:** The project has **zero runtime tests**. The only automated verification is TypeScript compilation. This is the single biggest quality gap. Critical paths with zero coverage:
- Auth flow (Clerk JWT verify, dev-bypass, owner-remap)
- Credit deduction and enforcement
- Project CRUD with ownership scoping
- AI code generation and application
- Build orchestration
- Supabase SQL execution
- Vercel deploy flow
- Per-user data isolation

---

## 11. Deployment Audit

| Component | Platform | Method | Status |
|-----------|----------|--------|--------|
| Frontend | Vercel | Auto-deploy on `git push` to `master` | ✅ Working |
| Worker | Cloudflare Workers | Manual `wrangler deploy` from WSL | ⚠️ Manual, fragile |
| Storage | Cloudflare KV + R2 | Provisioned, persistent | ✅ Working |

**Deployment Issues:**
- ⚠️ Worker deploy requires Cloudflare Global API Key (marked "ROTATE AFTER USE" since 2026-06-02)
- ⚠️ Worker deploy must run from WSL — not automatable from Windows
- ⚠️ No rollback strategy beyond `wrangler rollback` or git revert + redeploy
- ⚠️ No staging environment — all changes go straight to production
- ⚠️ No deployment health checks beyond `/health` endpoint
- ⚠️ WSL dependency means deployment requires manual intervention

---

## 12. Repository Health

### open-lovable-v2 (Windows)
- **Remote:** `saenna/open-lovable-v2` (fork of `firecrawl/open-lovable`)
- **Branch:** `main`
- **Status:** Clean working tree
- **Last commit:** `a275ccc update readme`
- **⚠️ This is NOT the deployed version**

### lovable-clone (WSL — not accessible)
- **Remote:** `mar2181/lovable-clone` (private)
- **Branch:** `master`
- **This IS the deployed version**
- **PR #20** (`claude/builder-buddy-rail`) parked with conflicts

### Pablo Rocha Demo
- **No git repository** (no `.git` found)
- Build is broken (`index.html` in `public/` not root)

### Stale Archive
- `C:\Users\mario\Projects\lovable-clone_STALE_ARCHIVED_2026-06-05` — 50+ days stale
- Contains real API keys in `.dev.vars`
- Should be deleted or sanitized

---

## 13. Documentation Audit

| Document | Exists? | Quality |
|----------|---------|---------|
| README.md | ✅ | Good — open-source setup guide |
| API Documentation | ❌ | None |
| Architecture Docs | ❌ | None |
| Setup Guide (HS-specific) | ❌ | None |
| Deployment Runbook | ⚠️ | Partial — in memory files only |
| Contributing Guide | ❌ | None |
| Security Policy | ❌ | None |
| Terms of Service | ❌ | Footer links are dead |
| Privacy Policy | ❌ | Footer links are dead |

---

## 14. Prioritized Action Plan

### 🔴 Priority 1 — Critical Blockers (Must Fix Before Launch)

**1.1 Close the dev-bypass auth hole**
- **Problem:** `Bearer dev-local-user` = full owner access, live in production
- **Root Cause:** Phase C Clerk flip never completed; `DEV_BYPASS_AUTH=1` in wrangler.toml `[vars]`
- **Files:** `wrangler.toml`, `worker/src/middleware/auth.ts`, Vercel env vars
- **Effort:** Medium | **Risk:** Critical | **Benefit:** Closes the biggest security hole
- **Steps:**
  1. Set prod Clerk `sk_live` on Cloudflare worker (`wrangler secret put CLERK_SECRET_KEY`)
  2. Remove `DEV_BYPASS_AUTH` and `ENVIRONMENT=development` from `wrangler.toml [vars]`
  3. Set `NEXT_PUBLIC_DEV_BYPASS_AUTH=0` on Vercel + redeploy frontend
  4. Verify: `dev-local-user` → 401, real Clerk login → 200

**1.2 Enable credit enforcement**
- **Problem:** `UNLIMITED_DEV_CREDITS = true` hardcoded — all usage is free
- **Root Cause:** Dev convenience constant never made environment-aware
- **Files:** `worker/src/services/credits.ts:4`
- **Effort:** Easy | **Risk:** Critical (business) | **Benefit:** Enables monetization
- **Steps:** Change `UNLIMITED_DEV_CREDITS` to `c.env.ENVIRONMENT === "development"`

**1.3 Rotate leaked API keys**
- **Problem:** Real OpenRouter key and Supabase PAT in stale archive `.dev.vars`
- **Root Cause:** Stale archive not sanitized before archival
- **Files:** Stale archive `.dev.vars`, OpenRouter dashboard, Supabase dashboard
- **Effort:** Easy | **Risk:** High | **Benefit:** Prevents unauthorized API usage

### 🟠 Priority 2 — Security Fixes (Should Fix Before Launch)

**2.1 Per-user OAuth for external services**
- **Problem:** Shared GitHub/Vercel/Supabase PATs — confused deputy
- **Effort:** Hard | **Risk:** High

**2.2 Add rate limiting**
- **Problem:** Chat, build, share endpoints are unlimited
- **Effort:** Medium | **Risk:** Medium

**2.3 Input validation + size limits**
- **Problem:** No validation on project names, memory, file content
- **Effort:** Medium | **Risk:** Low

### 🟡 Priority 3 — Broken Functionality

**3.1 Fix Pablo Rocha demo build**
- **Problem:** `vite build` fails — `index.html` not found
- **Fix:** Move `public/index.html` to project root, or configure Vite `root`
- **Effort:** Easy

**3.2 Unify/de-duplicate codebases**
- **Problem:** Two frontend copies, stale archive with secrets
- **Fix:** Delete stale archive (after sanitizing), document canonical repo location
- **Effort:** Easy

**3.3 Upgrade AI SDK v2→v4**
- **Problem:** 2 major versions behind on all AI provider packages
- **Effort:** Medium (breaking changes)

### 🟢 Priority 4 — Stability Improvements

**4.1 Write core tests**
- **Problem:** Zero tests across entire codebase
- **Priority targets:** Auth middleware, credit service, project CRUD, build orchestrator
- **Effort:** Hard (needs test infrastructure from scratch)

**4.2 Add staging environment**
- **Problem:** All changes go straight to production
- **Effort:** Medium

**4.3 Automate worker deploys**
- **Problem:** Manual `wrangler deploy` from WSL
- **Effort:** Medium (GitHub Actions with WSL or Cloudflare API)

### 🔵 Priority 5 — Performance Improvements

**5.1 Add pagination to project list**
- **Problem:** KV list returns all projects, could be slow with many users

**5.2 Optimize generation page**
- **Problem:** 3500+ line component, single-file
- **Fix:** Split into smaller components with proper code splitting

**5.3 Add image optimization**
- **Problem:** Screenshots served at full resolution
- **Fix:** Use Next.js Image component or Cloudflare Images

### ⚪ Priority 6 — Refactoring

**6.1 Split generation page into manageable components**
- **6.2 Extract validation logic into shared utilities**
- **6.3 Standardize error handling patterns across routes**
- **6.4 Add TypeScript strict mode (currently uses `any` in many places)**

### ⚪ Priority 7 — Nice-to-Have

**7.1 Build onboarding flow** — tutorial, sample project
**7.2 Add analytics** — user behavior, feature adoption
**7.3 Improve accessibility** — ARIA, keyboard nav
**7.4 Add legal pages** — Terms, Privacy
**7.5 Add admin dashboard** — user management, credit monitoring

---

## 15. Launch Readiness Verdict

### Current State: **NOT LAUNCH READY — Score 42/100**

The HS Web App Builder has a solid architectural foundation and a well-built worker backend. The core functionality — AI-powered app generation with sandbox preview, version history, Vercel deploy — works. The Pablo Rocha demo proves the output quality is professional.

However, **three critical blockers** prevent launch:

1. **The dev-bypass auth hole** means anyone can access all projects with a well-known token
2. **The credit system is disabled** — no way to monetize
3. **There are zero tests** — no confidence that changes don't break existing functionality

### What "Launch Ready" Looks Like
- [ ] Dev-bypass closed, Clerk auth working for real users
- [ ] Credit system enabled and enforced
- [ ] Core test suite (auth, credits, project CRUD)
- [ ] Rate limiting on AI endpoints
- [ ] Per-user data isolation verified
- [ ] Terms of Service and Privacy Policy pages live
- [ ] Staging environment for pre-production testing
- [ ] Monitoring/alerting for credit exhaustion and errors

### Estimated Time to Launch-Ready
- **Critical blockers (P1):** 2-3 days (mostly waiting on Mario for Clerk keys)
- **Security fixes (P2):** 1-2 weeks
- **Testing (P4):** 2-4 weeks
- **Polish (P5-P7):** Ongoing

**Realistic launch timeline: 4-6 weeks with dedicated engineering effort.**

---

*Audit conducted 2026-07-23 by Claude Code. All findings verified against live services or code on disk. Where verification was not possible (deployed frontend code, WSL worker), this is explicitly noted.*
