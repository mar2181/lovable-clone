import { Hono } from "hono";
import { nanoid } from "nanoid";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Clone-and-Swap engine.  Two endpoints, one swap core:
//
//   POST /api/retarget/:id            — swap with a CALLER-SUPPLIED `target`.
//   POST /api/retarget/:id/from-url   — scrape a target firm's website, extract
//                                       the identity with an LLM, then swap.
//
// Re-targets a curated SOURCE design (e.g. the orlando-family personal-injury
// template — the pristine master `tuqnPHcLCa` or any fresh clone of it) to a NEW
// business in one shot: name, the split-logo JSX, person name(s), phone numbers
// + the tel: href, street address, city/state/zip, the embedded-concierge
// labels, and (optionally) brand colors and per-image swaps.
//
// Which source design we're swapping FROM is described by a RetargetManifest
// (see MANIFESTS below). The manifest carries the source's exact "from" strings,
// how to build the replacement list, the residual-scan needles, the asset
// markers that always need a client image, the required target fields, and the
// LLM extraction prompt. resolveManifest() picks one by detecting the source's
// content (or an explicit `manifestId`), defaulting to the orlando manifest.
// Adding a new curated design = add one manifest entry; the swap core is generic.
//
// Unlike /api/projects/:id/inline-edits (which rejects any value appearing more
// than once), this performs GLOBAL, multi-occurrence replacements in an ordered,
// longest-match-first sequence so identity is swapped everywhere without
// clobbering unrelated text. Saved as an append-only new version (rollback-safe).
//
// POST /:id body:
//   {
//     createCopy?: boolean,          // default true — clone first, keep master pristine
//     newProjectName?: string,       // name for the copy (createCopy only)
//     manifestId?: string,           // force a source manifest (else auto-detect)
//     target: {
//       firmFull: string,            // e.g. "Marrero Injury Law Firm"
//       logo?: { first, accent, suffix },   // logo word split; derived from firmFull if omitted
//       attorneyFull: string,        // e.g. "David Marrero"
//       attorneyLast?: string,       // derived from attorneyFull if omitted
//       phone: string,               // e.g. "(956) 800-1000"
//       addressLine: string,         // e.g. "4200 N 10th St, Suite 200"
//       city: string, state: string, zip: string,
//       embedToken?: string|null,    // concierge data-token; kept if null
//       colorMap?: Record<string,string>|null,   // { "#C9A84C": "#1d4ed8", ... }
//       images?: Record<string,string>           // { oldUrl: newUrl }
//     },
//     extraReplacements?: Array<{ old: string, new: string }>   // applied last
//   }
//
// POST /:id/from-url body:
//   {
//     sourceUrl: string,             // the target firm's website to scrape
//     dryRun?: boolean,              // default false — true returns the extracted
//                                    //   identity WITHOUT swapping (preview/confirm)
//     manifestId?: string,           // force a source manifest (else auto-detect)
//     createCopy?, newProjectName?,  // same as above
//     overrides?: Partial<target>,   // caller fields win over anything scraped
//     extraReplacements?: [...]
//   }
//
// Response (swap): { project, sourceId, manifestId, newVersion, createdCopy,
//             appliedTotal, byRule: {...}, residuals: {...}, imagesNeedingReplacement: [...] }
// Response (dryRun / missing fields): { extracted, target, missing, manifestId, sourceMeta }
// ─────────────────────────────────────────────────────────────────────────────

const retargetRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();
retargetRouter.use("*", authMiddleware);

interface Replacement { rule: string; from: string; to: string; }

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { count++; i += needle.length; }
  return count;
}

// ── Manifest: describes ONE curated source design we can swap FROM ───────────
interface RetargetManifest {
  id: string;                                  // stable key, e.g. "orlando-pi-law"
  label: string;                               // human label for the UI/logs
  vertical: string;                            // "legal" | "medical" | …
  requiredFields: readonly string[];           // target fields the swap can't run without
  assetMarkers: string[];                      // url fragments that always need a client image
  residualNeedles: Record<string, string>;     // label -> "from" string a complete swap removes
  // Detect whether a given source project's files belong to this manifest.
  detect(files: Record<string, string>): boolean;
  // Normalize a target identity in place (trim, derive last name, …).
  normalizeTarget(t: any): void;
  // Build the ordered, longest-match-first replacement list for this design.
  buildReplacements(target: any, extra: Array<{ old: string; new: string }>): Replacement[];
  // System prompt for the LLM identity extractor (/from-url).
  extractionSystem: string;
}

// Generic in-place normalize: trim all string fields; derive `attorneyLast`.
function normalizeTargetGeneric(t: any): void {
  if (!t || typeof t !== "object") return;
  for (const k of Object.keys(t)) {
    if (typeof t[k] === "string") t[k] = t[k].trim();
  }
  if (!t.attorneyLast && typeof t.attorneyFull === "string" && t.attorneyFull) {
    t.attorneyLast = t.attorneyFull.split(/\s+/).pop() || "";
  }
}

// The orlando-family SOURCE identity (the "from" side of every orlando swap).
// Every clone of `tuqnPHcLCa` contains these exact strings until retargeted.
const ORLANDO = {
  firmFull: "Orlando Garcia Law Firm",
  firmFullLower: "orlando garcia law firm",
  attorneyAttorneyFull: "Attorney Orlando Garcia",
  attorneyFull: "Orlando Garcia",
  attorneyLast: "Garcia",
  // Exact split-logo JSX fragments (desktop header + mobile header share the
  // gold one; the footer uses the C9A84C one).
  logoFragments: [
    `Orlando <span className="text-[#FFD700]" style={{filter:'drop-shadow(0 0 6px #FFD70099)'}}>Garcia</span> Law`,
    `Orlando <span className="text-[#C9A84C]">Garcia</span> Law`,
  ],
  phones: ["(956) 123-4567", "(956) 305-2305"],
  telHref: "tel:(956)123-4567",
  addressLine: "1215 E University Dr",
  cityStateZip: "Edinburg, TX 78539",
  city: "Edinburg",
  embedToken: "orlando-tuqnphcl-vercel-app",
  // Orlando-specific asset markers (these images MUST be replaced per client).
  assetMarkers: ["alaniz-lawfirm", "orlandogarcia", "Website-Video"],
};

const ORLANDO_EXTRACTION_SYSTEM =
  "You extract a law firm's public business identity from the scraped markdown of THEIR OWN website. " +
  "Return ONLY a single JSON object — no prose, no markdown fences. Use this exact shape and put null for " +
  "anything you cannot find verbatim on the page (never guess or invent):\n" +
  `{"firmFull":string|null,"attorneyFull":string|null,"phone":string|null,"addressLine":string|null,` +
  `"city":string|null,"state":string|null,"zip":string|null,"logo":{"first":string,"accent":string,"suffix":string}|null}\n` +
  "Rules: firmFull = the full firm name as written (e.g. 'Smith & Jones Injury Law'). attorneyFull = the lead/named " +
  "attorney's full name (first + last only, no titles). phone = the primary phone formatted '(XXX) XXX-XXXX'. " +
  "addressLine = street + suite ONLY (no city/state/zip). state = 2-letter USPS code. logo = a 3-way split of the " +
  "firm name for the header wordmark: first = first word, accent = the highlighted middle word, suffix = the trailing " +
  "word (usually 'Law' / 'Law Firm'); omit (null) if the name doesn't split cleanly into 3 parts.";

const orlandoManifest: RetargetManifest = {
  id: "orlando-pi-law",
  label: "Orlando Garcia PI Law (legal)",
  vertical: "legal",
  requiredFields: ["firmFull", "attorneyFull", "phone", "addressLine", "city", "state", "zip"],
  assetMarkers: ORLANDO.assetMarkers,
  residualNeedles: {
    "firm-name": ORLANDO.firmFull,
    "attorney": ORLANDO.attorneyFull,
    "phone-1": ORLANDO.phones[0],
    "phone-2": ORLANDO.phones[1],
    "address": ORLANDO.addressLine,
    "city": ORLANDO.city,
    "last-name": ORLANDO.attorneyLast,
  },
  detect(files) {
    for (const path of Object.keys(files)) {
      if (files[path].indexOf(ORLANDO.firmFull) !== -1) return true;
      if (files[path].indexOf(ORLANDO.logoFragments[0]) !== -1) return true;
    }
    return false;
  },
  normalizeTarget: normalizeTargetGeneric,
  buildReplacements(target, extra) {
    const reps: Replacement[] = [];
    const add = (rule: string, from: string, to: string) => {
      if (from && to !== undefined && from !== to) reps.push({ rule, from, to });
    };

    // Logo split — rebuild each fragment with the target's words, keeping the
    // ORIGINAL hex styling so an optional color pass can recolor uniformly later.
    const first = target?.logo?.first ?? (target.firmFull.split(" ")[0] || target.firmFull);
    const accent = target?.logo?.accent ?? (target.firmFull.split(" ")[1] || "");
    const suffix = target?.logo?.suffix ?? "Law";
    add("logo-gold",
      ORLANDO.logoFragments[0],
      `${first} <span className="text-[#FFD700]" style={{filter:'drop-shadow(0 0 6px #FFD70099)'}}>${accent}</span> ${suffix}`);
    add("logo-accent",
      ORLANDO.logoFragments[1],
      `${first} <span className="text-[#C9A84C]">${accent}</span> ${suffix}`);

    // Firm name (longest first), then concierge lowercase key.
    add("firm-full", ORLANDO.firmFull, target.firmFull);
    add("firm-full-lower", ORLANDO.firmFullLower, String(target.firmFull).toLowerCase());

    // Attorney (qualified before bare).
    const attorneyLast = target.attorneyLast ?? (String(target.attorneyFull).trim().split(" ").pop() || target.attorneyFull);
    add("attorney-qualified", ORLANDO.attorneyAttorneyFull, `Attorney ${target.attorneyFull}`);
    add("attorney-full", ORLANDO.attorneyFull, target.attorneyFull);
    add("attorney-last-qualified", `Attorney ${ORLANDO.attorneyLast}`, `Attorney ${attorneyLast}`);

    // Phone: tel: href first (no spaces), then both display numbers → one.
    add("tel-href", ORLANDO.telHref, "tel:" + String(target.phone).replace(/\s/g, ""));
    for (const p of ORLANDO.phones) add("phone", p, target.phone);

    // Address (city/state/zip as a unit first, then street, then bare city).
    add("city-state-zip", ORLANDO.cityStateZip, `${target.city}, ${target.state} ${target.zip}`);
    add("address-line", ORLANDO.addressLine, target.addressLine);
    add("city", ORLANDO.city, target.city);

    // Concierge data-token (optional).
    if (typeof target.embedToken === "string" && target.embedToken) {
      add("embed-token", ORLANDO.embedToken, target.embedToken);
    }

    // Optional brand color remap.
    if (target.colorMap && typeof target.colorMap === "object") {
      for (const [oldHex, newHex] of Object.entries(target.colorMap)) {
        if (typeof newHex === "string") add("color", oldHex, newHex);
      }
    }

    // Per-image swaps.
    if (target.images && typeof target.images === "object") {
      for (const [oldUrl, newUrl] of Object.entries(target.images)) {
        if (typeof newUrl === "string") add("image", oldUrl, newUrl);
      }
    }

    // Caller-supplied extras (applied last).
    for (const e of extra || []) {
      if (e && typeof e.old === "string" && typeof e.new === "string") add("extra", e.old, e.new);
    }
    return reps;
  },
  extractionSystem: ORLANDO_EXTRACTION_SYSTEM,
};

// Registry of curated source designs. Add a manifest here to make a new design
// retargetable; the swap core, the routes, the MCP tools, and the SDK all stay
// the same. resolveManifest() auto-detects from the source files, falling back
// to the orlando manifest so existing behavior is preserved.
const MANIFESTS: RetargetManifest[] = [orlandoManifest];

function resolveManifest(files: Record<string, string>, overrideId?: string): RetargetManifest {
  if (overrideId) {
    const m = MANIFESTS.find((x) => x.id === overrideId);
    if (m) return m;
  }
  return MANIFESTS.find((m) => m.detect(files)) || orlandoManifest;
}

function missingRequired(manifest: RetargetManifest, t: any): string[] {
  return manifest.requiredFields.filter((f) => typeof t?.[f] !== "string" || !t[f].trim());
}

// ── Source loader (shared by both endpoints) ─────────────────────────────────
interface LoadedSource { project: any; files: Record<string, string>; latestVersion: string; dependencies: any; }

async function loadSource(
  env: Bindings, userId: string, sourceId: string,
): Promise<{ ok: true; data: LoadedSource } | { ok: false; status: 404 | 422; error: string }> {
  const kv = env.KV_METADATA;
  const r2 = env.R2_PROJECTS;
  const sourceStr = await kv.get(`user:${userId}:project:${sourceId}`);
  if (!sourceStr) return { ok: false, status: 404, error: "Project not found" };
  const project = JSON.parse(sourceStr);
  const latestVersion = await kv.get(`project:${sourceId}:latest_version`);
  if (!latestVersion) return { ok: false, status: 422, error: "Project has no versions" };
  const srcObj = await r2.get(`${sourceId}/v${latestVersion}.json`);
  if (!srcObj) return { ok: false, status: 422, error: "Source version data missing" };
  const srcVersion = JSON.parse(await srcObj.text());
  const files: Record<string, string> = { ...(srcVersion?.files || {}) };
  const dependencies = srcVersion?.dependencies || {};
  if (Object.keys(files).length === 0) return { ok: false, status: 422, error: "Source has no files" };
  return { ok: true, data: { project, files, latestVersion, dependencies } };
}

// ── Swap core (shared by both endpoints) ─────────────────────────────────────
// Applies the manifest's identity swap to a preloaded source, persists (new copy
// or append-only new version), and returns { status, body } for the route.
async function performRetarget(
  env: Bindings,
  userId: string,
  sourceId: string,
  loaded: LoadedSource,
  manifest: RetargetManifest,
  t: any,
  opts: { createCopy: boolean; newProjectName?: string; extraReplacements?: Array<{ old: string; new: string }> },
): Promise<{ status: 201; body: any }> {
  const kv = env.KV_METADATA;
  const r2 = env.R2_PROJECTS;
  const { project: source, latestVersion, dependencies } = loaded;
  const files: Record<string, string> = { ...loaded.files };

  // Apply replacements globally, longest-match-first.
  const reps = manifest.buildReplacements(t, opts.extraReplacements || []);
  const byRule: Record<string, number> = {};
  let appliedTotal = 0;
  for (const { rule, from, to } of reps) {
    let hits = 0;
    for (const path of Object.keys(files)) {
      const n = countOccurrences(files[path], from);
      if (n > 0) {
        files[path] = files[path].split(from).join(to);
        hits += n;
      }
    }
    byRule[rule] = (byRule[rule] || 0) + hits;
    appliedTotal += hits;
  }

  // Residual scan — any old identity still present is a swap gap.
  const residuals: Record<string, { count: number; files: string[] }> = {};
  for (const [label, needle] of Object.entries(manifest.residualNeedles)) {
    let count = 0; const where: string[] = [];
    for (const path of Object.keys(files)) {
      const n = countOccurrences(files[path], needle);
      if (n > 0) { count += n; where.push(path.split("/").pop() as string); }
    }
    if (count > 0) residuals[label] = { count, files: where };
  }

  // Source-specific images that were NOT overridden → need the client's asset.
  const imagesNeedingReplacement: string[] = [];
  for (const path of Object.keys(files)) {
    for (const marker of manifest.assetMarkers) {
      const idx = files[path].indexOf(marker);
      if (idx !== -1) {
        // capture the surrounding URL token
        const start = files[path].lastIndexOf("http", idx);
        const end = Math.min(
          ...["\"", "'", ")", " ", "\n"].map((ch) => {
            const p = files[path].indexOf(ch, idx);
            return p === -1 ? Number.MAX_SAFE_INTEGER : p;
          }),
        );
        const url = start !== -1 && end !== Number.MAX_SAFE_INTEGER ? files[path].slice(start, end) : marker;
        imagesNeedingReplacement.push(`${path.split("/").pop()} → ${url}`);
      }
    }
  }

  // Persist: new project (createCopy) or append-only new version in place.
  const now = new Date().toISOString();
  let targetProjectId = sourceId;
  let newVersionNum: number;
  let project: any;

  if (opts.createCopy) {
    targetProjectId = nanoid(10);
    newVersionNum = 1;
    project = {
      id: targetProjectId,
      userId,
      name: (typeof opts.newProjectName === "string" && opts.newProjectName.trim())
        ? opts.newProjectName.trim()
        : t.firmFull,
      description: `Retargeted from ${source.name}`,
      createdAt: now,
      updatedAt: now,
    };
    const versionData: Record<string, unknown> = {
      version: 1, createdAt: now,
      prompt: `Retargeted from ${source.name} → ${t.firmFull}`,
      files,
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    };
    await r2.put(`${targetProjectId}/v1.json`, JSON.stringify(versionData));
    await kv.put(`project:${targetProjectId}:latest_version`, "1");
    await kv.put(`user:${userId}:project:${targetProjectId}`, JSON.stringify(project));
  } else {
    newVersionNum = parseInt(latestVersion) + 1;
    const versionData: Record<string, unknown> = {
      version: newVersionNum, createdAt: now,
      prompt: `Retarget → ${t.firmFull} (${appliedTotal} replacements)`,
      files,
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    };
    await r2.put(`${sourceId}/v${newVersionNum}.json`, JSON.stringify(versionData));
    await kv.put(`project:${sourceId}:latest_version`, newVersionNum.toString());
    project = { ...source, updatedAt: now };
    await kv.put(`user:${userId}:project:${sourceId}`, JSON.stringify(project));
  }

  console.log(`[Retarget] user=${userId} manifest=${manifest.id} ${sourceId}→${targetProjectId} v${newVersionNum} firm="${t.firmFull}" applied=${appliedTotal} residualKeys=${Object.keys(residuals).length}`);

  return {
    status: 201,
    body: {
      project,
      sourceId,
      manifestId: manifest.id,
      newVersion: newVersionNum,
      createdCopy: opts.createCopy,
      appliedTotal,
      byRule,
      residuals,
      imagesNeedingReplacement,
    },
  };
}

// ── Scrape + LLM identity extraction (powers /from-url) ──────────────────────
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const EXTRACT_MARKDOWN_CAP = 40 * 1024; // sites are small; contact is in header/footer

async function scrapeMarkdown(env: Bindings, url: string): Promise<{ markdown: string; title?: string; statusCode?: number }> {
  if (!env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is not configured on the worker");
  const resp = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Firecrawl scrape failed: ${resp.status} ${resp.statusText} ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  const markdown = (data?.data?.markdown || "").trim();
  if (!markdown) throw new Error(`No content scraped from ${url}`);
  return {
    markdown,
    title: data?.data?.metadata?.title,
    statusCode: data?.data?.metadata?.statusCode,
  };
}

// Send the page head + tail (contact info usually lives in the footer) so the
// model sees the name and the address without us shipping the whole page.
function clampForExtraction(md: string): string {
  if (md.length <= EXTRACT_MARKDOWN_CAP) return md;
  const head = md.slice(0, Math.floor(EXTRACT_MARKDOWN_CAP * 0.65));
  const tail = md.slice(-Math.floor(EXTRACT_MARKDOWN_CAP * 0.35));
  return `${head}\n\n…[middle elided]…\n\n${tail}`;
}

function stripJson(text: string): string {
  let s = (text || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Grab the outermost { … } in case the model adds stray text.
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) s = s.slice(a, b + 1);
  return s;
}

async function extractIdentity(env: Bindings, markdown: string, pageUrl: string, title: string | undefined, system: string): Promise<any> {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured on the worker");
  const openrouter = createOpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
  const result = await generateText({
    model: openrouter("moonshotai/kimi-k2"),
    system,
    temperature: 0,
    messages: [{
      role: "user",
      content: `Page URL: ${pageUrl}\nPage title: ${title || "(none)"}\n\n--- SCRAPED MARKDOWN ---\n${clampForExtraction(markdown)}`,
    }],
  });
  let parsed: any;
  try {
    parsed = JSON.parse(stripJson(result.text || ""));
  } catch {
    throw new Error("LLM did not return parseable JSON for the firm identity");
  }
  // Drop null/empty fields so overrides + required-check see only real values.
  const clean: any = {};
  for (const [k, v] of Object.entries(parsed || {})) {
    if (v === null || v === undefined) continue;
    if (k === "logo" && typeof v === "object") {
      const lg = v as any;
      if (lg.first && lg.accent) clean.logo = { first: lg.first, accent: lg.accent, suffix: lg.suffix || "Law" };
      continue;
    }
    if (typeof v === "string" && v.trim()) clean[k] = v.trim();
  }
  return clean;
}

// ── POST /:id — swap with a caller-supplied target ───────────────────────────
retargetRouter.post("/:id", async (c) => {
  const userId = c.get("userId");
  const sourceId = c.req.param("id");
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || !body.target || typeof body.target !== "object") {
      return c.json({ error: "Body must include a `target` identity object" }, 400);
    }
    const loaded = await loadSource(c.env, userId, sourceId);
    if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status);

    const manifest = resolveManifest(loaded.data.files, body.manifestId);
    const t = body.target;
    manifest.normalizeTarget(t);
    const missing = missingRequired(manifest, t);
    if (missing.length) {
      return c.json({ error: `Missing required target fields: ${missing.join(", ")}`, missing, manifestId: manifest.id }, 400);
    }
    const result = await performRetarget(c.env, userId, sourceId, loaded.data, manifest, t, {
      createCopy: body.createCopy !== false,
      newProjectName: body.newProjectName,
      extraReplacements: body.extraReplacements,
    });
    return c.json(result.body, result.status);
  } catch (error) {
    console.error("Retarget error:", error);
    return c.json({ error: "Failed to retarget project" }, 500);
  }
});

// ── POST /:id/from-url — scrape a firm's site, extract identity, then swap ────
retargetRouter.post("/:id/from-url", async (c) => {
  const userId = c.get("userId");
  const sourceId = c.req.param("id");
  try {
    const body = await c.req.json().catch(() => null);
    const sourceUrl = (body?.sourceUrl || "").toString().trim();
    if (!/^https?:\/\//i.test(sourceUrl)) {
      return c.json({ error: "Body must include a `sourceUrl` starting with http:// or https://" }, 400);
    }

    // 0) Load the source so we can pick the right manifest for extraction + swap.
    const loaded = await loadSource(c.env, userId, sourceId);
    if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status);
    const manifest = resolveManifest(loaded.data.files, body?.manifestId);

    // 1) Scrape the target firm's site.
    let scraped: { markdown: string; title?: string; statusCode?: number };
    try {
      scraped = await scrapeMarkdown(c.env, sourceUrl);
    } catch (e: any) {
      return c.json({ error: `Scrape failed: ${e?.message || String(e)}` }, 502);
    }

    // 2) Extract the firm identity with the LLM (manifest-specific prompt).
    let extracted: any;
    try {
      extracted = await extractIdentity(c.env, scraped.markdown, sourceUrl, scraped.title, manifest.extractionSystem);
    } catch (e: any) {
      return c.json({ error: `Identity extraction failed: ${e?.message || String(e)}`, sourceMeta: { title: scraped.title } }, 502);
    }

    // 3) Caller overrides win over anything scraped.
    const overrides = (body?.overrides && typeof body.overrides === "object") ? body.overrides : {};
    const target: any = { ...extracted, ...overrides };
    manifest.normalizeTarget(target);

    const sourceMeta = { url: sourceUrl, title: scraped.title, statusCode: scraped.statusCode, markdownChars: scraped.markdown.length };
    const missing = missingRequired(manifest, target);

    // Preview mode, or not enough data → return what we found, don't swap.
    if (body?.dryRun === true || missing.length) {
      return c.json({
        dryRun: body?.dryRun === true,
        extracted,
        target,
        missing,
        manifestId: manifest.id,
        sourceMeta,
        ...(missing.length ? { error: `Could not extract: ${missing.join(", ")} — supply via overrides or fix the source URL.` } : {}),
      }, missing.length ? 422 : 200);
    }

    // 4) Swap.
    const result = await performRetarget(c.env, userId, sourceId, loaded.data, manifest, target, {
      createCopy: body.createCopy !== false,
      newProjectName: body.newProjectName,
      extraReplacements: body.extraReplacements,
    });
    return c.json({ ...result.body, extracted, target, sourceMeta }, result.status);
  } catch (error) {
    console.error("Retarget from-url error:", error);
    return c.json({ error: "Failed to retarget project from URL" }, 500);
  }
});

export default retargetRouter;
