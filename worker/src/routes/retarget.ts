import { Hono } from "hono";
import { nanoid } from "nanoid";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/retarget/:id — Clone-and-Swap engine.
//
// Re-targets an "orlando-family" personal-injury template (the pristine master
// `tuqnPHcLCa` or any fresh clone of it) to a NEW law firm in one shot: firm
// name, the split-logo JSX, attorney name(s), BOTH phone numbers + the tel:
// href, street address, city/state/zip, the embedded-concierge labels, and
// (optionally) brand colors and per-image swaps.
//
// Unlike /api/projects/:id/inline-edits (which rejects any value appearing more
// than once), this performs GLOBAL, multi-occurrence replacements in an ordered,
// longest-match-first sequence so identity is swapped everywhere without
// clobbering unrelated text. Saved as an append-only new version (rollback-safe).
//
// Body:
//   {
//     createCopy?: boolean,          // default true — clone first, keep master pristine
//     newProjectName?: string,       // name for the copy (createCopy only)
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
// Response: { project, sourceId, newVersion, createdCopy, appliedTotal,
//             byRule: {...}, residuals: {...}, imagesNeedingReplacement: [...] }
// ─────────────────────────────────────────────────────────────────────────────

const retargetRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();
retargetRouter.use("*", authMiddleware);

// The orlando-family SOURCE identity (the "from" side of every swap). Every
// clone of `tuqnPHcLCa` contains these exact strings until retargeted, so this
// map re-targets any pristine master or fresh clone. (Track B will generalize
// this to a per-template manifest + a scrape-driven extractor.)
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

interface Replacement { rule: string; from: string; to: string; }

function buildReplacements(target: any, extra: Array<{ old: string; new: string }>): Replacement[] {
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
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { count++; i += needle.length; }
  return count;
}

retargetRouter.post("/:id", async (c) => {
  const userId = c.get("userId");
  const sourceId = c.req.param("id");
  const kv = c.env.KV_METADATA;
  const r2 = c.env.R2_PROJECTS;

  try {
    const body = await c.req.json().catch(() => null);
    if (!body || !body.target || typeof body.target !== "object") {
      return c.json({ error: "Body must include a `target` identity object" }, 400);
    }
    const t = body.target;
    for (const req of ["firmFull", "attorneyFull", "phone", "addressLine", "city", "state", "zip"]) {
      if (typeof t[req] !== "string" || !t[req].trim()) {
        return c.json({ error: `target.${req} is required` }, 400);
      }
    }
    const createCopy = body.createCopy !== false; // default true

    // Ownership + load latest version files.
    const sourceStr = await kv.get(`user:${userId}:project:${sourceId}`);
    if (!sourceStr) return c.json({ error: "Project not found" }, 404);
    const source = JSON.parse(sourceStr);
    const latestVersionStr = await kv.get(`project:${sourceId}:latest_version`);
    if (!latestVersionStr) return c.json({ error: "Project has no versions" }, 422);
    const srcObj = await r2.get(`${sourceId}/v${latestVersionStr}.json`);
    if (!srcObj) return c.json({ error: "Source version data missing" }, 422);
    const srcVersion = JSON.parse(await srcObj.text());
    const files: Record<string, string> = { ...(srcVersion?.files || {}) };
    const dependencies = srcVersion?.dependencies || {};
    if (Object.keys(files).length === 0) {
      return c.json({ error: "Source has no files" }, 422);
    }

    // Apply replacements globally, longest-match-first.
    const reps = buildReplacements(t, body.extraReplacements);
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
    const residualNeedles: Record<string, string> = {
      "firm-name": ORLANDO.firmFull,
      "attorney": ORLANDO.attorneyFull,
      "phone-1": ORLANDO.phones[0],
      "phone-2": ORLANDO.phones[1],
      "address": ORLANDO.addressLine,
      "city": ORLANDO.city,
      "last-name": ORLANDO.attorneyLast,
    };
    const residuals: Record<string, { count: number; files: string[] }> = {};
    for (const [label, needle] of Object.entries(residualNeedles)) {
      let count = 0; const where: string[] = [];
      for (const path of Object.keys(files)) {
        const n = countOccurrences(files[path], needle);
        if (n > 0) { count += n; where.push(path.split("/").pop() as string); }
      }
      if (count > 0) residuals[label] = { count, files: where };
    }

    // Orlando-specific images that were NOT overridden → need the client's asset.
    const imagesNeedingReplacement: string[] = [];
    for (const path of Object.keys(files)) {
      for (const marker of ORLANDO.assetMarkers) {
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

    if (createCopy) {
      targetProjectId = nanoid(10);
      newVersionNum = 1;
      project = {
        id: targetProjectId,
        userId,
        name: (typeof body.newProjectName === "string" && body.newProjectName.trim())
          ? body.newProjectName.trim()
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
      newVersionNum = parseInt(latestVersionStr) + 1;
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

    console.log(`[Retarget] user=${userId} ${sourceId}→${targetProjectId} v${newVersionNum} firm="${t.firmFull}" applied=${appliedTotal} residualKeys=${Object.keys(residuals).length}`);

    return c.json({
      project,
      sourceId,
      newVersion: newVersionNum,
      createdCopy: createCopy,
      appliedTotal,
      byRule,
      residuals,
      imagesNeedingReplacement,
    }, 201);
  } catch (error) {
    console.error("Retarget error:", error);
    return c.json({ error: "Failed to retarget project" }, 500);
  }
});

export default retargetRouter;
