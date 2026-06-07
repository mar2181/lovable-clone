#!/usr/bin/env node
/**
 * HS Web App Builder — operational self-heal.
 *
 * Reads a probe JSON (qa/audit/reports/latest-probe.json by default, or --input,
 * or piped on stdin) and applies ONLY operational remediations for findings that
 * the probe marked `autofixable` — per qa/audit/policy.md.
 *
 *   ⛔ NEVER runs git / commit / push. Repo changes are flagged, not applied.
 *   ⛔ Only acts on status===RED && autofixable===true.
 *
 * Usage:
 *   node qa/audit/selfheal.mjs --dry-run        # show intended actions, change nothing
 *   node qa/audit/selfheal.mjs                  # apply operational fixes
 *   node qa/audit/selfheal.mjs --input foo.json
 *
 * Secrets via ENV (never hardcoded): RUNPOD_API_KEY, VERCEL_TOKEN,
 *   CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL [+ CLOUDFLARE_ACCOUNT_ID], BOX_DASH_TOKEN
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const DRY = process.argv.includes('--dry-run');
const ROOT = process.env.AUDIT_ROOT || '/home/mario/lovable-clone';
const POD_ID = process.env.AUDIT_POD_ID || 'udcz4k7kse1zw6';
const BOX = process.env.AUDIT_BOX || 'https://udcz4k7kse1zw6-7860.proxy.runpod.net';
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '9ea42a6592d3f5b42981ae95ae262728';
const actions = [];

function logAction(a) {
  actions.push(a);
  const icon = a.ok === true ? '✅' : a.ok === false ? '❌' : '○';
  console.log(`${icon} ${a.action}: ${a.detail || ''}`);
}

async function http(url, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, text, json };
  } catch (e) { return { ok: false, status: 0, error: e.message }; }
  finally { clearTimeout(t); }
}

// ---------------------------- handlers --------------------------------------
const HANDLERS = {
  'concierge/pod-power': async (f) => {
    if (!process.env.RUNPOD_API_KEY) return { ok: false, detail: 'RUNPOD_API_KEY not set' };
    if (DRY) return { ok: null, detail: `would POST /v1/pods/${POD_ID}/start` };
    const r = await http(`https://rest.runpod.io/v1/pods/${POD_ID}/start`,
      { method: 'POST', headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` } });
    // poll healthz briefly
    let healthy = false;
    for (let i = 0; i < 6 && !healthy; i++) {
      await new Promise(s => setTimeout(s, 10000));
      const hz = await http(`${BOX}/healthz`);
      healthy = hz.json?.ok === true;
    }
    return { ok: healthy, before: 'pod stopped', after: healthy ? 'pod RUNNING + box ok' : `start status ${r.status}, box not yet healthy` };
  },

  'concierge/box-health': async (f) => {
    if (DRY) return { ok: null, detail: 'would POST <box>/dashboard/agent/restart, then fall back to pod restart' };
    // 1) try in-box agent restart (cheapest)
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.BOX_DASH_TOKEN) headers['-auth'] = process.env.BOX_DASH_TOKEN;
    let r = await http(`${BOX}/dashboard/agent/restart`, { method: 'POST', headers });
    await new Promise(s => setTimeout(s, 8000));
    let hz = await http(`${BOX}/healthz`);
    if (hz.json?.ok === true) return { ok: true, after: 'box recovered via agent restart' };
    // 2) escalate to pod stop+start
    if (process.env.RUNPOD_API_KEY) {
      await http(`https://rest.runpod.io/v1/pods/${POD_ID}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` } });
      await new Promise(s => setTimeout(s, 5000));
      await http(`https://rest.runpod.io/v1/pods/${POD_ID}/start`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` } });
      for (let i = 0; i < 8; i++) { await new Promise(s => setTimeout(s, 10000)); hz = await http(`${BOX}/healthz`); if (hz.json?.ok === true) break; }
      return { ok: hz.json?.ok === true, after: hz.json?.ok ? 'box recovered via pod restart' : 'box still down after pod restart — escalate' };
    }
    return { ok: false, detail: `agent restart status ${r.status}, no RUNPOD_API_KEY to escalate` };
  },

  'worker/route-deployed': () => deployWorker(),
  'import/route': () => deployWorker(),

  'deploy/drift': async (f) => {
    if (!process.env.VERCEL_TOKEN) return { ok: false, detail: 'VERCEL_TOKEN not set' };
    const sha = f.data?.remoteHead;
    if (DRY) return { ok: null, detail: `would redeploy Vercel to origin/master ${sha?.slice(0,7)}` };
    // Create a fresh deployment from the connected git commit.
    const r = await http(`https://api.vercel.com/v13/deployments?teamId=${process.env.AUDIT_VERCEL_TEAM || 'team_svzrJ92gcLJoU6bZXTJPw7EG'}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'lovable-clone', target: 'production',
        gitSource: { type: 'github', repoId: undefined, ref: 'master' },
        project: process.env.AUDIT_VERCEL_PROJECT || 'prj_x2Io34Vf5X87EaWdcQQ5cvZJvUKJ',
      }),
    });
    return { ok: r.ok, after: r.ok ? 'Vercel redeploy triggered' : `redeploy failed ${r.status}: ${r.text?.slice(0,200)}` };
  },
};

async function deployWorker() {
  if (DRY) return { ok: null, detail: 'would run `wrangler deploy` in worker/ (redeploys committed code)' };
  if (!process.env.CLOUDFLARE_API_KEY || !process.env.CLOUDFLARE_EMAIL)
    return { ok: false, detail: 'CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL not set' };
  try {
    const { stdout, stderr } = await pexec('npx', ['wrangler', 'deploy'], {
      cwd: path.join(ROOT, 'worker'),
      timeout: 180000,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT },
    });
    const out = (stdout + stderr);
    return { ok: /Deployed|Uploaded|Published|Current Version/i.test(out), after: out.slice(-300) };
  } catch (e) { return { ok: false, detail: `wrangler failed: ${(e.stderr || e.message || '').slice(-300)}` }; }
}

// ---------------------------- main ------------------------------------------
async function loadProbe() {
  const idx = process.argv.indexOf('--input');
  if (idx >= 0 && process.argv[idx + 1]) return JSON.parse(await fs.readFile(process.argv[idx + 1], 'utf8'));
  // stdin?
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const s = Buffer.concat(chunks).toString('utf8').trim();
    if (s) return JSON.parse(s);
  }
  return JSON.parse(await fs.readFile(path.join(ROOT, 'qa', 'audit', 'reports', 'latest-probe.json'), 'utf8'));
}

async function main() {
  const probe = await loadProbe();
  const targets = (probe.results || []).filter(r => r.status === 'RED' && r.autofixable);
  console.log(`self-heal ${DRY ? '(DRY-RUN) ' : ''}— ${targets.length} auto-fixable RED finding(s)\n`);

  if (!targets.length) {
    console.log('Nothing to auto-heal. (RED findings that need Mario are FLAGGED in the report, not touched here.)');
  }

  for (const f of targets) {
    const key = `${f.domain}/${f.check}`;
    const handler = HANDLERS[key];
    if (!handler) { logAction({ action: key, ok: false, detail: 'no operational handler — flagged instead', finding: f.detail }); continue; }
    try {
      const res = await handler(f);
      logAction({ action: key, ...res, finding: f.detail, dry: DRY });
    } catch (e) {
      logAction({ action: key, ok: false, detail: e.message, finding: f.detail });
    }
  }

  // also surface the flagged (non-autofixable) REDs so the log is complete
  const flagged = (probe.results || []).filter(r => r.status === 'RED' && !r.autofixable);
  if (flagged.length) {
    console.log(`\n🚩 ${flagged.length} RED finding(s) FLAGGED for Mario (not auto-fixed):`);
    for (const f of flagged) console.log(`   - [${f.domain}/${f.check}] ${f.severity || ''} ${f.detail}\n     fix: ${f.fix}`);
  }

  const out = { tool: 'hs-builder-selfheal', dry: DRY, at: new Date().toISOString(), actions, flagged };
  try {
    const slug = out.at.replace(/[:.]/g, '-');
    await fs.mkdir(path.join(ROOT, 'qa', 'audit', 'reports'), { recursive: true });
    await fs.writeFile(path.join(ROOT, 'qa', 'audit', 'reports', `${slug}-selfheal.json`), JSON.stringify(out, null, 2));
  } catch {}
  const failed = actions.filter(a => a.ok === false).length;
  if (failed) process.exitCode = 1;
}

main();
