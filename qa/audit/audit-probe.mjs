#!/usr/bin/env node
/**
 * HS Web App Builder — Tier-1 deterministic audit probe.
 *
 * Hits every LIVE surface (prod app, worker prod, voice box, RunPod, Vercel API,
 * GitHub) + reads repo files, and emits machine-readable JSON the deep-audit
 * agents reason over. NO LLM, NO browser — pure HTTP + git so it is fast and
 * portable (runs on Mario's box or in a cloud agent that cloned the repo).
 *
 * Output: array of { domain, check, status: GREEN|YELLOW|RED, severity, detail,
 *                    autofixable, fix } written to qa/audit/reports/<ts>-probe.json
 * and (unless --json) a human summary to stdout.
 *
 * Secrets are read from ENV ONLY — never hardcode keys in this file (the whole
 * point of the audit is that secrets don't live in the repo). Pass at runtime:
 *   RUNPOD_API_KEY  VERCEL_TOKEN  [GITHUB_TOKEN]
 *
 * Flags:
 *   --json   print ONLY the JSON results array to stdout (for piping to agents)
 *   --deep   also run side-effecting checks (real build SSE, real box session)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const JSON_ONLY = process.argv.includes('--json');
const DEEP = process.argv.includes('--deep');

// ---- Config (public URLs are safe defaults; secrets come from env) ----------
const CFG = {
  ROOT: process.env.AUDIT_ROOT || '/home/mario/lovable-clone',
  FRONTEND: process.env.AUDIT_FRONTEND || 'https://hswebappbuilder.space',
  WORKER: process.env.AUDIT_WORKER || 'https://lovable-clone-backend.hssolutions2181.workers.dev',
  BOX: process.env.AUDIT_BOX || 'https://udcz4k7kse1zw6-7860.proxy.runpod.net',
  POD_ID: process.env.AUDIT_POD_ID || 'udcz4k7kse1zw6',
  VERCEL_PROJECT: process.env.AUDIT_VERCEL_PROJECT || 'prj_x2Io34Vf5X87EaWdcQQ5cvZJvUKJ',
  VERCEL_TEAM: process.env.AUDIT_VERCEL_TEAM || 'team_svzrJ92gcLJoU6bZXTJPw7EG',
  GH_REPO: process.env.AUDIT_GH_REPO || 'mar2181/lovable-clone',
  DEV_TOKEN: process.env.AUDIT_DEV_TOKEN || 'dev-local-user',
  RUNPOD_API_KEY: process.env.RUNPOD_API_KEY || '',
  VERCEL_TOKEN: process.env.VERCEL_TOKEN || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
};

const STD_BRANCHES = new Set(['master', 'main', 'HEAD']);
const results = [];
const started = new Date();

function add(domain, check, status, detail, opts = {}) {
  results.push({
    domain, check, status,
    severity: opts.severity || (status === 'RED' ? 'P2' : status === 'YELLOW' ? 'P3' : null),
    detail,
    autofixable: !!opts.autofixable,
    fix: opts.fix || null,
    data: opts.data || null,
  });
}

async function http(url, options = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) {
    return { ok: false, status: 0, text: '', json: null, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function git(args) {
  try {
    const { stdout } = await pexec('git', ['-C', CFG.ROOT, ...args], { timeout: 20000 });
    return stdout.trim();
  } catch (e) {
    return null;
  }
}

async function readRepo(rel) {
  try { return await fs.readFile(path.join(CFG.ROOT, rel), 'utf8'); }
  catch { return null; }
}

// ============================ WORKER ========================================
async function checkWorker() {
  const health = await http(`${CFG.WORKER}/health`);
  add('worker', 'health', health.json?.status === 'ok' ? 'GREEN' : 'RED',
    `/health → ${health.status}${health.error ? ' ' + health.error : ''}`,
    { severity: 'P0', autofixable: true, fix: 'wrangler deploy (worker down)' });

  const spec = await http(`${CFG.WORKER}/api/spec.json`);
  add('worker', 'spec', spec.json?.openapi ? 'GREEN' : 'YELLOW',
    `/api/spec.json → ${spec.status}${spec.json?.openapi ? ` (openapi ${spec.json.openapi})` : ''}`);

  // Forgotten-deploy detector: a gated route must be 401 (deployed+gated),
  // NOT 404 (route in repo but not deployed), NOT 200 (auth wide open).
  const gated = await http(`${CFG.WORKER}/api/projects`);
  if (gated.status === 401) {
    add('worker', 'route-deployed', 'GREEN', '/api/projects anon → 401 (deployed + gated, correct)');
  } else if (gated.status === 404) {
    add('worker', 'route-deployed', 'RED', '/api/projects anon → 404 (route NOT deployed — forgotten worker deploy)',
      { severity: 'P0', autofixable: true, fix: 'cd worker && wrangler deploy (current committed code)' });
  } else if (gated.status === 200) {
    add('worker', 'route-deployed', 'RED', '/api/projects anon → 200 (AUTH WIDE OPEN — no gate)',
      { severity: 'P1', autofixable: false, fix: 'auth middleware not enforcing — investigate' });
  } else {
    add('worker', 'route-deployed', 'YELLOW', `/api/projects anon → ${gated.status} (unexpected)`);
  }

  // Integration health surface (telegram/sms config presence via behavior)
  const share = await http(`${CFG.WORKER}/api/share/health`, {
    headers: { Authorization: `Bearer ${CFG.DEV_TOKEN}` },
  });
  if (share.json) {
    const tg = share.json.telegram, sms = share.json.sms;
    add('worker', 'integrations', (tg ? 'GREEN' : 'YELLOW'),
      `share/health telegram=${tg} sms=${sms}`,
      { severity: 'P3', data: share.json });
  }

  if (DEEP) await checkBuildPipeline();
  else add('worker', 'build-pipeline', 'YELLOW',
    'Build SSE E2E not run (use --deep). This is the core product function — verify in deep audit.',
    { severity: 'P2' });
}

async function checkBuildPipeline() {
  // SIDE-EFFECTING: creates a throwaway project, runs a tiny build, deletes it.
  const auth = { Authorization: `Bearer ${CFG.DEV_TOKEN}`, 'Content-Type': 'application/json' };
  let projectId = null;
  try {
    const created = await http(`${CFG.WORKER}/api/projects`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ name: 'AUDIT build probe', description: 'disposable audit build check' }),
    });
    projectId = created.json?.project?.id;
    if (!projectId) { add('worker', 'build-pipeline', 'RED', `could not create probe project: ${created.status}`, { severity: 'P0' }); return; }

    const res = await fetch(`${CFG.WORKER}/api/build/${projectId}`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ description: 'A single simple landing page with a hero and one button.' }),
    });
    const body = await res.text();
    const done = /build_complete/.test(body);
    const errored = /"type":"error"/.test(body) || /\berror\b/i.test(body) && !done;
    add('worker', 'build-pipeline', done ? 'GREEN' : 'RED',
      done ? 'Build SSE reached build_complete (codegen LIVE)' : `Build did not complete (status ${res.status})`,
      { severity: 'P0', data: { excerpt: body.slice(-400) } });
  } finally {
    if (projectId) {
      await http(`${CFG.WORKER}/api/projects/${projectId}`, { method: 'DELETE', headers: auth }).catch(() => {});
    }
  }
}

// ============================ FRONTEND ======================================
async function checkFrontend() {
  for (const [name, route] of [['root', '/'], ['dashboard', '/dashboard']]) {
    const r = await http(`${CFG.FRONTEND}${route}`);
    add('frontend', name, r.ok ? 'GREEN' : 'RED', `${route} → ${r.status}${r.error ? ' ' + r.error : ''}`,
      { severity: 'P0' });
  }
}

// ============================ DEPLOY DRIFT ==================================
async function checkDeployDrift() {
  const localHead = await git(['rev-parse', 'HEAD']);
  let remoteHead = null;
  const ls = await git(['ls-remote', 'origin', 'refs/heads/master']);
  if (ls) remoteHead = ls.split(/\s+/)[0];

  let vercelSha = null, vercelState = null;
  if (CFG.VERCEL_TOKEN) {
    const v = await http(
      `https://api.vercel.com/v6/deployments?projectId=${CFG.VERCEL_PROJECT}&teamId=${CFG.VERCEL_TEAM}&limit=1&target=production`,
      { headers: { Authorization: `Bearer ${CFG.VERCEL_TOKEN}` } });
    const dep = v.json?.deployments?.[0];
    vercelSha = dep?.meta?.githubCommitSha || null;
    vercelState = dep?.readyState || dep?.state || null;
  }

  const data = { localHead, remoteHead, vercelSha, vercelState };
  if (!localHead && !vercelSha) {
    add('deploy', 'drift', 'YELLOW', 'Could not determine commits (no local git + no Vercel token)', { data });
    return;
  }
  if (localHead && remoteHead && localHead !== remoteHead) {
    add('deploy', 'drift', 'YELLOW',
      `Local HEAD (${localHead.slice(0,7)}) ≠ origin/master (${remoteHead.slice(0,7)}) — unpushed work`,
      { severity: 'P3', data, fix: 'review + git push (flag, no auto-push)' });
  } else if (remoteHead && vercelSha && remoteHead !== vercelSha) {
    add('deploy', 'drift', 'RED',
      `origin/master (${remoteHead.slice(0,7)}) ≠ Vercel deployed (${vercelSha.slice(0,7)}) — pushed but not deployed`,
      { severity: 'P2', autofixable: true, fix: 'retrigger Vercel deploy of latest commit', data });
  } else if (vercelState && vercelState !== 'READY') {
    add('deploy', 'drift', 'YELLOW', `Vercel latest prod state = ${vercelState}`, { data });
  } else {
    add('deploy', 'drift', 'GREEN',
      `In sync (HEAD/origin/Vercel = ${(vercelSha || localHead || '').slice(0,7)}, state ${vercelState || 'n/a'})`,
      { data });
  }
}

// ============================ CONCIERGE / BOX ===============================
async function checkConcierge() {
  // RunPod pod power state
  if (CFG.RUNPOD_API_KEY) {
    const pod = await http(`https://rest.runpod.io/v1/pods/${CFG.POD_ID}`,
      { headers: { Authorization: `Bearer ${CFG.RUNPOD_API_KEY}` } });
    const status = pod.json?.desiredStatus;
    if (status === 'RUNNING') {
      add('concierge', 'pod-power', 'GREEN', `RunPod ${CFG.POD_ID} desiredStatus=RUNNING ($${pod.json.costPerHr}/hr)`,
        { data: { costPerHr: pod.json.costPerHr } });
    } else if (status) {
      add('concierge', 'pod-power', 'RED', `RunPod ${CFG.POD_ID} desiredStatus=${status} (box down)`,
        { severity: 'P0', autofixable: true, fix: `POST /v1/pods/${CFG.POD_ID}/start` });
    } else {
      add('concierge', 'pod-power', 'YELLOW', `RunPod status unknown (${pod.status})`);
    }
  } else {
    add('concierge', 'pod-power', 'YELLOW', 'RUNPOD_API_KEY not set — pod power state not checked');
  }

  // Box health (mute-trap aware: healthy must mean ok:true with a sane build)
  const hz = await http(`${CFG.BOX}/healthz`);
  if (hz.json?.ok === true) {
    const j = hz.json;
    add('concierge', 'box-health', 'GREEN',
      `box ok build=${j.build} tools=${j.tools?.count} tts=${(j.tts?.voices||[]).join('/')} sessions=${j.active_sessions}/${j.max_sessions}`,
      { data: j });
    // Cost / wake-sleep note: RUNNING + long idle = burning money
    if (typeof j.idle_seconds === 'number' && j.idle_seconds > 1200) {
      add('concierge', 'box-cost', 'YELLOW',
        `box idle ${Math.round(j.idle_seconds/60)}m but pod still RUNNING — wake/sleep not reclaiming it (~$/day burn)`,
        { severity: 'P3', fix: 'confirm wake_sleep controller is active or stop pod when idle' });
    }
  } else {
    add('concierge', 'box-health', 'RED', `/healthz → ${hz.status} (box unreachable or unhealthy)`,
      { severity: 'P0', autofixable: true, fix: 'restart pod / agent (POST /dashboard/agent/restart or pod restart)' });
  }

  if (DEEP) {
    // SIDE-EFFECTING: actually mint a session (creates a Daily room)
    const conn = await http(`${CFG.BOX}/api/connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: 'audit-probe' }),
    });
    add('concierge', 'box-session', conn.json?.connectUrl || conn.json?.url ? 'GREEN' : 'RED',
      `/api/connect → ${conn.status}${conn.json?.connectUrl ? ' (got connectUrl)' : ''}`,
      { severity: 'P1', data: conn.json });
  }

  // Wiring integrity (repo files)
  const pc = await readRepo('components/pet-concierge.tsx');
  if (pc == null) {
    add('concierge', 'wiring', 'YELLOW', 'pet-concierge.tsx not readable (repo not local)');
  } else {
    const selfhosted = /data-backend["']?\s*[,=]\s*["']selfhosted["']|"selfhosted"/.test(pc) || /setAttribute\(\s*["']data-backend["']\s*,\s*["']selfhosted["']/.test(pc);
    const boxproxy = /\/boxapi/.test(pc);
    add('concierge', 'wiring', (selfhosted && boxproxy) ? 'GREEN' : 'RED',
      `pet-concierge.tsx backend=selfhosted:${selfhosted} connect=/boxapi:${boxproxy}`,
      { severity: 'P2', fix: 'restore data-backend=selfhosted + data-connect-url=/boxapi (flag — repo change)' });
  }

  // Proxy target must match the LIVE pod URL; trailingSlash must not break /boxapi
  const nc = await readRepo('next.config.ts');
  if (nc == null) {
    add('concierge', 'proxy-target', 'YELLOW', 'next.config.ts not readable (repo not local)');
  } else {
    const m = nc.match(/boxapi[\s\S]{0,200}?destination:\s*["']([^"']+)["']/);
    const target = m ? m[1] : null;
    const podInConfig = target && target.includes(CFG.POD_ID);
    const trailing = /trailingSlash\s*:\s*true/.test(nc);
    if (!target) {
      add('concierge', 'proxy-target', 'RED', 'no /boxapi rewrite found in next.config.ts (voice proxy missing)',
        { severity: 'P1', fix: 'add /boxapi rewrite (flag — repo change)' });
    } else if (!podInConfig) {
      add('concierge', 'proxy-target', 'RED',
        `/boxapi target (${target}) does NOT match live pod ${CFG.POD_ID} — STALE URL = voice outage`,
        { severity: 'P0', fix: `update next.config.ts /boxapi destination to current pod URL (flag — repo change + redeploy)` });
    } else if (trailing) {
      add('concierge', 'proxy-target', 'RED', 'trailingSlash:true present — breaks /boxapi proxy (308→307 loop)',
        { severity: 'P1', fix: 'remove trailingSlash:true or add strip-slash /boxapi rewrite (flag)' });
    } else {
      add('concierge', 'proxy-target', 'GREEN', `/boxapi → ${target} (matches live pod, no trailingSlash trap)`);
    }
  }
}

// ============================ IMPORT FEATURE ================================
async function checkImport() {
  const r = await http(`${CFG.WORKER}/api/github/import`, { method: 'POST' });
  if (r.status === 401) add('import', 'route', 'GREEN', '/api/github/import anon → 401 (deployed + gated)');
  else if (r.status === 404) add('import', 'route', 'RED', '/api/github/import → 404 (not deployed)',
    { severity: 'P2', autofixable: true, fix: 'wrangler deploy' });
  else add('import', 'route', 'YELLOW', `/api/github/import anon → ${r.status}`);
  add('import', 'unit-guards', 'YELLOW',
    'Sandpack alias/asset unit tests not run by probe — deep audit runs qa/test-sandpack-*.ts',
    { severity: 'P3' });
}

// ============================ GITHUB RECONCILE ==============================
async function checkGithub() {
  const ls = await git(['ls-remote', '--heads', 'origin']);
  if (!ls) {
    add('github', 'branches', 'YELLOW', 'git ls-remote unavailable (no local repo) — deep audit enumerates via gh');
    return;
  }
  const branches = ls.split('\n').map(l => l.split('\t')[1]?.replace('refs/heads/', '')).filter(Boolean);
  const nonStd = branches.filter(b => !STD_BRANCHES.has(b));
  add('github', 'branches', nonStd.length ? 'YELLOW' : 'GREEN',
    nonStd.length ? `${nonStd.length} non-master branches to review: ${nonStd.join(', ')}` : 'only master',
    { severity: 'P3', data: { branches } });
}

// ============================ SECURITY ======================================
async function checkSecurity() {
  // The smoking gun: dev-bypass live in prod → anyone is owner
  const creds = await http(`${CFG.WORKER}/api/credits`, { headers: { Authorization: `Bearer ${CFG.DEV_TOKEN}` } });
  if (creds.json?.credits?.tier === 'unlimited' || creds.json?.credits?.balance >= 9999) {
    add('security', 'dev-bypass-prod', 'RED',
      `Bearer ${CFG.DEV_TOKEN} → prod owner (tier=${creds.json.credits.tier}, balance=${creds.json.credits.balance}). Anyone can impersonate owner.`,
      { severity: 'P1', autofixable: false,
        fix: 'CONFIRM-FIRST flip: set ENVIRONMENT=production + drop DEV_BYPASS_AUTH in worker/wrangler.toml, then wrangler deploy. Risk: may hide projects owned by dev-local-user — verify ownership first.' });
  } else {
    add('security', 'dev-bypass-prod', 'GREEN', `Bearer ${CFG.DEV_TOKEN} not privileged in prod (${creds.status})`);
  }

  // .dev.vars must NOT be tracked by git
  const tracked = await git(['ls-files', 'worker/.dev.vars']);
  const ignored = await git(['check-ignore', 'worker/.dev.vars']);
  if (tracked) {
    add('security', 'devvars-in-git', 'RED', 'worker/.dev.vars IS tracked by git — live secrets committed',
      { severity: 'P0', autofixable: false, fix: 'git rm --cached worker/.dev.vars + gitignore + ROTATE all keys it held' });
  } else if (ignored) {
    add('security', 'devvars-in-git', 'GREEN', 'worker/.dev.vars present but gitignored (not committed)');
  } else {
    add('security', 'devvars-in-git', 'YELLOW', 'worker/.dev.vars not tracked and not explicitly gitignored — confirm');
  }
}

// ============================ HYGIENE =======================================
async function checkHygiene() {
  const wpkg = await readRepo('worker/package.json');
  if (wpkg) {
    const j = JSON.parse(wpkg);
    const hasTc = !!j.scripts?.typecheck;
    const hasTest = j.scripts?.test && !/no test specified/.test(j.scripts.test);
    add('hygiene', 'worker-scripts', (hasTc && hasTest) ? 'GREEN' : 'YELLOW',
      `worker package.json typecheck:${hasTc} test:${!!hasTest}`,
      { severity: 'P3', fix: 'add "typecheck":"tsc --noEmit" (flag — repo change)' });
  }
}

// ============================ RUN ===========================================
async function main() {
  await fs.mkdir(path.join(CFG.ROOT, 'qa', 'audit', 'reports'), { recursive: true }).catch(() => {});
  const runners = [
    ['worker', checkWorker], ['frontend', checkFrontend], ['deploy', checkDeployDrift],
    ['concierge', checkConcierge], ['import', checkImport], ['github', checkGithub],
    ['security', checkSecurity], ['hygiene', checkHygiene],
  ];
  for (const [name, fn] of runners) {
    try { await fn(); }
    catch (e) { add(name, 'probe-error', 'RED', `probe crashed: ${e.message}`, { severity: 'P2' }); }
  }

  const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  const overall = (counts.RED ? 'RED' : counts.YELLOW ? 'YELLOW' : 'GREEN');
  const out = {
    tool: 'hs-builder-audit-probe', version: 1,
    startedAt: started.toISOString(),
    deep: DEEP,
    overall, counts,
    config: { FRONTEND: CFG.FRONTEND, WORKER: CFG.WORKER, BOX: CFG.BOX, POD_ID: CFG.POD_ID, ROOT: CFG.ROOT },
    results,
  };

  // Persist (skip if ROOT not writable)
  try {
    const slug = started.toISOString().replace(/[:.]/g, '-');
    const p = path.join(CFG.ROOT, 'qa', 'audit', 'reports', `${slug}-probe.json`);
    await fs.writeFile(p, JSON.stringify(out, null, 2));
    await fs.writeFile(path.join(CFG.ROOT, 'qa', 'audit', 'reports', 'latest-probe.json'), JSON.stringify(out, null, 2));
    if (!JSON_ONLY) console.error(`probe json: ${p}`);
  } catch (e) { if (!JSON_ONLY) console.error(`(could not persist probe json: ${e.message})`); }

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(out));
  } else {
    console.log(`\n=== HS Builder Audit Probe — ${overall} ===`);
    console.log(`GREEN ${counts.GREEN||0} | YELLOW ${counts.YELLOW||0} | RED ${counts.RED||0}\n`);
    for (const r of results) {
      const icon = r.status === 'GREEN' ? '✅' : r.status === 'YELLOW' ? '⚠️ ' : '❌';
      console.log(`${icon} [${r.domain}/${r.check}]${r.severity ? ' ' + r.severity : ''} ${r.detail}`);
      if (r.fix && r.status !== 'GREEN') console.log(`     ↳ fix: ${r.fix}${r.autofixable ? ' (AUTO)' : ' (FLAG)'}`);
    }
  }
  if (overall === 'RED') process.exitCode = 2;
}

main();
