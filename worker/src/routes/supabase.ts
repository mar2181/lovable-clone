import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import { managementGet, managementPost } from "../services/supabase";
import type {
  SupabaseLinkRecord,
  SupabaseSchemaRecord,
  SupabaseMigrationRecord,
} from "../types/supabase";

const supabaseRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

supabaseRouter.use("*", authMiddleware);

// ── Connection status ──────────────────────────────────────────────────────
supabaseRouter.get("/connect-status", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ linked: false, patConfigured: !!c.env.SUPABASE_PAT });

  const link: SupabaseLinkRecord = JSON.parse(linkRaw);
  return c.json({
    linked: true,
    patConfigured: !!c.env.SUPABASE_PAT,
    link: {
      ref: link.ref,
      name: link.name,
      restUrl: link.restUrl,
      anonKey: link.anonKey,
      organization_name: link.organization_name,
      status: link.status,
    },
  });
});

// ── Project list (cached 60s) ──────────────────────────────────────────────
supabaseRouter.get("/projects", async (c) => {
  const userId = c.get("userId");
  const pat = c.env.SUPABASE_PAT;
  if (!pat) return c.json({ error: "Supabase PAT not configured", code: "no_pat" }, 500);

  const cached = await c.env.KV_METADATA.get(`user:${userId}:supabase_projects_cache`);
  if (cached) return c.json(JSON.parse(cached));

  try {
    const projects = await managementGet(pat, "/v1/projects");
    await c.env.KV_METADATA.put(
      `user:${userId}:supabase_projects_cache`,
      JSON.stringify(projects),
      { expirationTtl: 60 },
    );
    console.log(`[Supabase] action=list_projects status=ok userId=${userId} count=${Array.isArray(projects) ? projects.length : "?"}`);
    return c.json(projects);
  } catch (err: any) {
    console.error(`[Supabase] action=list_projects status=fail userId=${userId} ${err?.message || "unknown"}`);
    if (err?.message === "supabase_pat_invalid") {
      return c.json({ error: "Supabase PAT is invalid or expired.", code: "pat_invalid" }, 401);
    }
    return c.json({ error: "Failed to fetch projects" }, 502);
  }
});

// ── Get link info ──────────────────────────────────────────────────────────
supabaseRouter.get("/link", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ linked: false });
  return c.json({ linked: true, link: JSON.parse(linkRaw) });
});

// ── Link a project (uses the project you already have on Supabase) ─────────
supabaseRouter.post("/link", async (c) => {
  const userId = c.get("userId");
  const pat = c.env.SUPABASE_PAT;
  if (!pat) return c.json({ error: "Supabase PAT not configured", code: "no_pat" }, 500);

  const { projectId, ref } = await c.req.json();
  if (!projectId || !ref) {
    return c.json({ error: "projectId and ref are required", code: "missing_fields" }, 400);
  }

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  try {
    const [projectMetaRaw, apiKeys] = await Promise.all([
      managementGet(pat, `/v1/projects/${ref}`),
      managementGet(pat, `/v1/projects/${ref}/api-keys`),
    ]);
    const projectMeta = projectMetaRaw as {
      name: string;
      region: string;
      organization_id: string;
      organization_name?: string;
      status: string;
    };

    const anonKey = (apiKeys as any[]).find((k: any) => /anon/i.test(k.name || ""))?.api_key
      ?? (apiKeys as any[]).find((k: any) => k.type === "anon")?.api_key
      ?? "";

    if (!anonKey) {
      return c.json({ error: "Could not find anon key for this project", code: "no_anon_key" }, 500);
    }

    const link: SupabaseLinkRecord = {
      ref,
      name: projectMeta.name,
      region: projectMeta.region,
      organization_id: projectMeta.organization_id,
      organization_name: projectMeta.organization_name || "",
      restUrl: `https://${ref}.supabase.co`,
      anonKey,
      linkedAt: new Date().toISOString(),
      linkedByUserId: userId,
      status: projectMeta.status === "ACTIVE_HEALTHY" ? "active" : "paused",
    };

    await c.env.KV_METADATA.put(`project:${projectId}:supabase`, JSON.stringify(link));

    // Fetch initial schema (non-fatal)
    try {
      await fetchAndCacheSchema(c, pat, projectId, ref);
    } catch (schemaErr: any) {
      console.warn(`[Supabase] Initial schema fetch failed (non-fatal): ${schemaErr?.message || "unknown"}`);
    }

    console.log(`[Supabase] action=link status=ok userId=${userId} projectId=${projectId} ref=${ref}`);
    return c.json({ ok: true, link });
  } catch (err: any) {
    console.error(`[Supabase] action=link status=fail userId=${userId} projectId=${projectId} ${err?.message || "unknown"}`);
    return c.json({ error: "Failed to link project" }, 500);
  }
});

// ── Unlink ─────────────────────────────────────────────────────────────────
supabaseRouter.delete("/link", async (c) => {
  const userId = c.get("userId");
  const { projectId } = await c.req.json();
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  await c.env.KV_METADATA.delete(`project:${projectId}:supabase`);
  await c.env.KV_METADATA.delete(`project:${projectId}:supabase_schema`);

  console.log(`[Supabase] action=unlink status=ok userId=${userId} projectId=${projectId}`);
  return c.json({ ok: true });
});

// ── Schema (cached 5min) ───────────────────────────────────────────────────
supabaseRouter.get("/schema", async (c) => {
  const userId = c.get("userId");
  const pat = c.env.SUPABASE_PAT;
  if (!pat) return c.json({ error: "Supabase PAT not configured", code: "no_pat" }, 500);

  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ error: "Supabase not linked", code: "supabase_not_linked" }, 400);
  const link: SupabaseLinkRecord = JSON.parse(linkRaw);

  const forceRefresh = c.req.query("refresh") === "true";

  if (!forceRefresh) {
    const cachedRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase_schema`);
    if (cachedRaw) {
      const cached: SupabaseSchemaRecord = JSON.parse(cachedRaw);
      if (Date.now() - new Date(cached.fetchedAt).getTime() < 300_000) {
        return c.json(cached.tables);
      }
    }
  }

  try {
    const tables = await fetchAndCacheSchema(c, pat, projectId, link.ref);
    return c.json(tables);
  } catch (err: any) {
    console.warn(`[Supabase] action=fetch_schema status=fail projectId=${projectId} ${err?.message || "unknown"}`);
    const staleRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase_schema`);
    if (staleRaw) return c.json(JSON.parse(staleRaw).tables);
    return c.json([]);
  }
});

// ── Run SQL (migration) ────────────────────────────────────────────────────
supabaseRouter.post("/sql", async (c) => {
  const userId = c.get("userId");
  const pat = c.env.SUPABASE_PAT;
  if (!pat) return c.json({ error: "Supabase PAT not configured", code: "no_pat" }, 500);

  const { projectId, sql } = await c.req.json();
  if (!projectId || !sql) {
    return c.json({ error: "projectId and sql are required", code: "missing_fields" }, 400);
  }

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ error: "Supabase not linked", code: "supabase_not_linked" }, 400);
  const link: SupabaseLinkRecord = JSON.parse(linkRaw);

  const upper = sql.toUpperCase();
  if (/\bDROP\s+DATABASE\b/.test(upper) || /\bALTER\s+ROLE\b/.test(upper)) {
    return c.json({ error: "This SQL statement is blocked for safety.", code: "sql_blocked" }, 400);
  }

  // Rate limit: 100 SQL/hr/user
  const rateKey = `ratelimit:sql:${userId}`;
  const rateCount = parseInt(await c.env.KV_METADATA.get(rateKey) || "0");
  if (rateCount >= 100) {
    return c.json({ error: "Rate limit exceeded (100 SQL/hr).", code: "rate_limited" }, 429);
  }

  const migrationId = nanoid(10);
  const start = Date.now();

  try {
    const result = await managementPost(pat, `/v1/projects/${link.ref}/database/query`, { query: sql });
    await c.env.KV_METADATA.delete(`project:${projectId}:supabase_schema`);
    await appendMigration(c, projectId, userId, {
      id: migrationId,
      appliedAt: new Date().toISOString(),
      description: "Migration",
      sql,
      appliedByUserId: userId,
      result: "success",
    });
    await c.env.KV_METADATA.put(rateKey, String(rateCount + 1), { expirationTtl: 3600 });

    const durationMs = Date.now() - start;
    console.log(`[Supabase] action=run_sql status=ok userId=${userId} projectId=${projectId} ref=${link.ref} durationMs=${durationMs}`);
    return c.json({ ok: true, result, migrationId });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMessage = err?.message || "unknown error";
    await appendMigration(c, projectId, userId, {
      id: migrationId,
      appliedAt: new Date().toISOString(),
      description: "Migration",
      sql,
      appliedByUserId: userId,
      result: "error",
      errorMessage,
    });
    console.error(`[Supabase] action=run_sql status=fail userId=${userId} projectId=${projectId} ref=${link.ref} durationMs=${durationMs} err=${errorMessage.slice(0, 200)}`);
    return c.json({ error: "Migration failed.", code: "sql_exec_failed", details: errorMessage.slice(0, 500) }, 400);
  }
});

// ── Migration history ──────────────────────────────────────────────────────
supabaseRouter.get("/migrations", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const raw = await c.env.KV_METADATA.get(`project:${projectId}:supabase_migrations`);
  if (!raw) return c.json({ history: [] });
  const record: SupabaseMigrationRecord = JSON.parse(raw);
  return c.json({ history: record.history });
});

// ── Helpers ────────────────────────────────────────────────────────────────

const SCHEMA_INTROSPECTION_SQL = `
SELECT
  c.table_schema,
  c.table_name,
  json_agg(json_build_object(
    'name', c.column_name,
    'type', c.data_type,
    'nullable', c.is_nullable = 'YES',
    'default', c.column_default
  ) ORDER BY c.ordinal_position) AS columns,
  COALESCE(t.relrowsecurity, false) AS rls_enabled,
  COALESCE(p.policies, '[]'::json) AS policies
FROM information_schema.columns c
LEFT JOIN pg_class t ON t.relname = c.table_name AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
LEFT JOIN LATERAL (
  SELECT json_agg(json_build_object(
    'name', polname,
    'command', polcmd,
    'definition', pg_get_expr(polqual, polrelid),
    'roles', CASE WHEN polroles = '{0}'::oid[] THEN ARRAY['public']::text[] ELSE (SELECT array_agg(rolname) FROM pg_roles WHERE oid = ANY(polroles)) END
  )) AS policies
  FROM pg_policy WHERE polrelid = t.oid
) p ON true
WHERE c.table_schema = 'public'
GROUP BY c.table_schema, c.table_name, t.relrowsecurity, p.policies
ORDER BY c.table_name;
`.trim();

async function fetchAndCacheSchema(
  c: import("hono").Context<{ Bindings: Bindings; Variables: Variables }>,
  pat: string,
  projectId: string,
  ref: string,
): Promise<any[]> {
  const result = await managementPost(pat, `/v1/projects/${ref}/database/query`, { query: SCHEMA_INTROSPECTION_SQL });
  const tables = Array.isArray(result) ? result.map((row: any) => ({
    name: row.table_name,
    schema: row.table_schema || "public",
    columns: Array.isArray(row.columns) ? row.columns : JSON.parse(row.columns || "[]"),
    rlsEnabled: row.rls_enabled === true,
    policies: Array.isArray(row.policies) ? row.policies : JSON.parse(row.policies || "[]"),
  })) : [];

  const schemaRecord: SupabaseSchemaRecord = { fetchedAt: new Date().toISOString(), tables };
  await c.env.KV_METADATA.put(`project:${projectId}:supabase_schema`, JSON.stringify(schemaRecord), { expirationTtl: 300 });
  return tables;
}

async function appendMigration(
  c: import("hono").Context<{ Bindings: Bindings; Variables: Variables }>,
  projectId: string,
  userId: string,
  entry: { id: string; appliedAt: string; description: string; sql: string; appliedByUserId: string; result: "success" | "error"; errorMessage?: string },
): Promise<void> {
  const key = `project:${projectId}:supabase_migrations`;
  const raw = await c.env.KV_METADATA.get(key);
  const record: SupabaseMigrationRecord = raw ? JSON.parse(raw) : { history: [] };
  record.history.push(entry);
  if (record.history.length > 50) record.history = record.history.slice(-50);
  await c.env.KV_METADATA.put(key, JSON.stringify(record));
}

export default supabaseRouter;
