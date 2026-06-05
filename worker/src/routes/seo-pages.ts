import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { cityServicePage } from "../templates/city-page";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — local-SEO page generator.
//
//   POST /api/seo-pages/:id
//     body: {
//       service: string,                          // e.g. "Personal Injury Lawyer"
//       cities: Array<{ city: string; state: string }>,
//       pathPrefix?: string                        // default "/src/pages/seo"
//     }
//
// Loads the project's latest version (same KV/R2 model as retarget.ts
// performRetarget), generates one React+TS landing page per city via
// cityServicePage(), pulls firmName from the project name and best-effort
// scrapes the phone from existing files, then saves an APPEND-ONLY new version.
//
// Returns: { newVersion, pagesAdded: [paths], firmName, phone }   (201)
// ─────────────────────────────────────────────────────────────────────────────

const seoPagesRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();
seoPagesRouter.use("*", authMiddleware);

// Kebab-case a value for use in a file path slug (collapse non-alphanumerics to
// single dashes, trim leading/trailing dashes, lowercase).
function kebab(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Best-effort phone extraction: first US-style "(XXX) XXX-XXXX" across all files.
const PHONE_RE = /\(\d{3}\)\s?\d{3}-\d{4}/;
function findPhone(files: Record<string, string>): string {
  for (const path of Object.keys(files)) {
    const m = files[path].match(PHONE_RE);
    if (m) return m[0];
  }
  return "";
}

seoPagesRouter.post("/:id", async (c) => {
  const userId = c.get("userId");
  const sourceId = c.req.param("id");
  try {
    const body = await c.req.json().catch(() => null);
    const service = (body?.service ?? "").toString().trim();
    const cities = Array.isArray(body?.cities) ? body.cities : null;
    if (!service) {
      return c.json({ error: "Body must include a non-empty `service` string" }, 400);
    }
    if (!cities || cities.length === 0) {
      return c.json({ error: "Body must include a non-empty `cities` array" }, 400);
    }

    const pathPrefixRaw = (body?.pathPrefix ?? "/src/pages/seo").toString().trim() || "/src/pages/seo";
    // Normalize: ensure leading slash, no trailing slash.
    const pathPrefix = ("/" + pathPrefixRaw.replace(/^\/+|\/+$/g, "")).replace(/\/+$/g, "");

    const kv = c.env.KV_METADATA;
    const r2 = c.env.R2_PROJECTS;

    // Ownership + load latest version files — byte-for-byte the retarget.ts model.
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

    // firmName from the project name; phone best-effort from existing files.
    const firmName = (typeof source?.name === "string" && source.name.trim()) ? source.name.trim() : "";
    const phone = findPhone(files);

    // Generate one page per city. Slug = service + city kebab-case.
    const pagesAdded: string[] = [];
    const seen = new Set<string>();
    for (const entry of cities) {
      const city = (entry?.city ?? "").toString().trim();
      const state = (entry?.state ?? "").toString().trim();
      if (!city) continue;
      let slug = kebab(`${service}-${city}`);
      if (!slug) continue;
      // De-dupe slugs within this request so two cities never clobber each other.
      let unique = slug;
      let n = 2;
      while (seen.has(unique)) unique = `${slug}-${n++}`;
      seen.add(unique);

      const path = `${pathPrefix}/${unique}.tsx`;
      files[path] = cityServicePage({ service, city, state, firmName, phone, homePath: "/" });
      pagesAdded.push(path);
    }

    if (pagesAdded.length === 0) {
      return c.json({ error: "No valid cities to generate pages for" }, 400);
    }

    // Persist: append-only new version in place — byte-for-byte the retarget.ts model.
    const now = new Date().toISOString();
    const newVersionNum = parseInt(latestVersionStr) + 1;
    const versionData: Record<string, unknown> = {
      version: newVersionNum,
      createdAt: now,
      prompt: `SEO pages → ${service} (${pagesAdded.length} ${pagesAdded.length === 1 ? "city" : "cities"})`,
      files,
      ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    };
    await r2.put(`${sourceId}/v${newVersionNum}.json`, JSON.stringify(versionData));
    await kv.put(`project:${sourceId}:latest_version`, newVersionNum.toString());
    const project = { ...source, updatedAt: now };
    await kv.put(`user:${userId}:project:${sourceId}`, JSON.stringify(project));

    console.log(`[SeoPages] user=${userId} ${sourceId} v${newVersionNum} service="${service}" pages=${pagesAdded.length} phone="${phone}"`);

    return c.json({ newVersion: newVersionNum, pagesAdded, firmName, phone }, 201);
  } catch (error) {
    console.error("SEO pages error:", error);
    return c.json({ error: "Failed to generate SEO pages" }, 500);
  }
});

export default seoPagesRouter;
