import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import {
  encryptToken,
  signState, verifyState,
  pkceVerifier, pkceChallenge,
} from "../services/crypto";
import {
  exchangeCode,
  managementGet, managementPost,
  withSupabaseToken,
} from "../services/supabase";
import type {
  SupabaseRefreshRecord,
  SupabaseAccessRecord,
  SupabaseLinkRecord,
  SupabaseSchemaRecord,
  SupabaseMigrationRecord,
  OAuthStateStash,
} from "../types/supabase";

const supabaseRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All routes require auth EXCEPT oauth/callback (uses signed state token).
supabaseRouter.use("/oauth/start", authMiddleware);
supabaseRouter.use("/projects", authMiddleware);
supabaseRouter.use("/link", authMiddleware);
supabaseRouter.use("/schema", authMiddleware);
supabaseRouter.use("/sql", authMiddleware);
supabaseRouter.use("/migrations", authMiddleware);
supabaseRouter.use("/me", authMiddleware);
supabaseRouter.use("/connect-status", authMiddleware);

// ── OAuth start ────────────────────────────────────────────────────────────
supabaseRouter.get("/oauth/start", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const verifier = pkceVerifier();
  const challenge = await pkceChallenge(verifier);
  const nonce = nanoid(16);
  const state = await signState(
    { userId, projectId, nonce, expiresAt: Date.now() + 5 * 60 * 1000 },
    c.env.OAUTH_STATE_SECRET,
  );

  await c.env.KV_METADATA.put(
    `oauth_state:${nonce}`,
    JSON.stringify({ verifier, userId, projectId } satisfies OAuthStateStash),
    { expirationTtl: 300 },
  );

  const url = new URL("https://api.supabase.com/v1/oauth/authorize");
  url.searchParams.set("client_id", c.env.SUPABASE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", c.env.SUPABASE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", [
    "read:organizations", "read:projects", "write:projects",
    "sql:read", "sql:write", "secrets:read", "secrets:write",
  ].join(" "));

  console.log(`[Supabase] action=oauth_start userId=${userId} projectId=${projectId}`);
  return c.json({ url: url.toString() });
});

// ── OAuth callback ─────────────────────────────────────────────────────────
function closePopupHtml(payload: unknown): string {
  const json = JSON.stringify(payload);
  return `<!doctype html><meta charset="utf-8"><script>
    if (window.opener) window.opener.postMessage({type:"supabase-oauth",payload:${json}}, "*");
    window.close();
  </script><body>You can close this window.</body>`;
}

supabaseRouter.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const stateRaw = c.req.query("state");
  if (!code || !stateRaw) {
    console.warn("[Supabase] action=oauth_callback status=fail reason=missing_code_or_state");
    return c.html(closePopupHtml({ ok: false, error: "missing_code_or_state" }));
  }

  let state;
  try {
    state = await verifyState(stateRaw, c.env.OAUTH_STATE_SECRET);
  } catch {
    console.warn("[Supabase] action=oauth_callback status=fail reason=state_verify_error");
    return c.html(closePopupHtml({ ok: false, error: "state_invalid" }));
  }
  if (!state || state.expiresAt < Date.now()) {
    console.warn("[Supabase] action=oauth_callback status=fail reason=state_expired_or_invalid");
    return c.html(closePopupHtml({ ok: false, error: "state_invalid" }));
  }

  const stashRaw = await c.env.KV_METADATA.get(`oauth_state:${state.nonce}`);
  if (!stashRaw) {
    console.warn("[Supabase] action=oauth_callback status=fail reason=state_consumed");
    return c.html(closePopupHtml({ ok: false, error: "state_consumed" }));
  }
  const stash: OAuthStateStash = JSON.parse(stashRaw);
  await c.env.KV_METADATA.delete(`oauth_state:${state.nonce}`);

  let tokens;
  try {
    tokens = await exchangeCode({
      code,
      codeVerifier: stash.verifier,
      clientId: c.env.SUPABASE_OAUTH_CLIENT_ID,
      clientSecret: c.env.SUPABASE_OAUTH_CLIENT_SECRET,
      redirectUri: c.env.SUPABASE_OAUTH_REDIRECT_URI,
    });
  } catch (err: any) {
    console.error(`[Supabase] action=oauth_callback status=fail reason=exchange_error ${err?.message || "unknown"}`);
    return c.html(closePopupHtml({ ok: false, error: "exchange_failed" }));
  }

  const { cipher, iv } = await encryptToken(tokens.refresh_token, c.env.SUPABASE_TOKEN_ENC_KEY);
  await c.env.KV_METADATA.put(
    `user:${stash.userId}:supabase_refresh`,
    JSON.stringify({
      tokenCipher: cipher,
      iv,
      obtainedAt: new Date().toISOString(),
      scopes: tokens.scope.split(" "),
      supabaseUserId: tokens.sub,
      supabaseEmail: tokens.email,
    } satisfies SupabaseRefreshRecord),
  );
  await c.env.KV_METADATA.put(
    `user:${stash.userId}:supabase_access`,
    JSON.stringify({
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      obtainedAt: new Date().toISOString(),
    } satisfies SupabaseAccessRecord),
    { expirationTtl: tokens.expires_in - 60 },
  );

  console.log(`[Supabase] action=oauth_callback status=ok userId=${stash.userId}`);
  return c.html(closePopupHtml({ ok: true }));
});

// ── Connection status ──────────────────────────────────────────────────────
supabaseRouter.get("/me", async (c) => {
  const userId = c.get("userId");
  const refreshRaw = await c.env.KV_METADATA.get(`user:${userId}:supabase_refresh`);
  if (!refreshRaw) return c.json({ connected: false });
  const r: SupabaseRefreshRecord = JSON.parse(refreshRaw);
  return c.json({
    connected: true,
    supabaseEmail: r.supabaseEmail,
    supabaseUserId: r.supabaseUserId,
    scopes: r.scopes,
    obtainedAt: r.obtainedAt,
  });
});

// ── Per-project link status ────────────────────────────────────────────────
supabaseRouter.get("/connect-status", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  // ownership check
  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ linked: false, connected: false });

  const link: SupabaseLinkRecord = JSON.parse(linkRaw);
  const refreshRaw = await c.env.KV_METADATA.get(`user:${userId}:supabase_refresh`);

  return c.json({
    linked: true,
    connected: !!refreshRaw,
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
  const cached = await c.env.KV_METADATA.get(`user:${userId}:supabase_projects_cache`);
  if (cached) return c.json(JSON.parse(cached));

  try {
    const projects = await managementGet(c, "/v1/projects");
    await c.env.KV_METADATA.put(
      `user:${userId}:supabase_projects_cache`,
      JSON.stringify(projects),
      { expirationTtl: 60 },
    );
    console.log(`[Supabase] action=list_projects status=ok userId=${userId} count=${Array.isArray(projects) ? projects.length : "?"}`);
    return c.json(projects);
  } catch (err: any) {
    if (err?.message === "supabase_reauth_required") {
      return c.json({ error: "Supabase connection expired. Reconnect to continue.", code: "supabase_reauth_required" }, 401);
    }
    console.error(`[Supabase] action=list_projects status=fail userId=${userId} ${err?.message || "unknown"}`);
    return c.json({ error: "Failed to fetch projects" }, 502);
  }
});

// ── Create new project ──────────────────────────────────────────────────────
supabaseRouter.post("/projects", async (c) => {
  const userId = c.get("userId");
  const { name, region, organization_id, db_pass } = await c.req.json();

  if (!name || !region || !organization_id || !db_pass) {
    return c.json({ error: "name, region, organization_id, and db_pass are required", code: "missing_fields" }, 400);
  }

  try {
    const result = await managementPost(c, "/v1/projects", {
      name,
      region,
      organization_id,
      db_pass,
      plan: "free",
    });
    console.log(`[Supabase] action=create_project status=ok userId=${userId} ref=${result.ref}`);
    return c.json(result, 201);
  } catch (err: any) {
    console.error(`[Supabase] action=create_project status=fail userId=${userId} ${err?.message || "unknown"}`);
    return c.json({ error: "Failed to create Supabase project" }, 502);
  }
});

// ── Link a project ─────────────────────────────────────────────────────────
supabaseRouter.post("/link", async (c) => {
  const userId = c.get("userId");
  const { projectId, ref } = await c.req.json();

  if (!projectId || !ref) {
    return c.json({ error: "projectId and ref are required", code: "missing_fields" }, 400);
  }

  // Ownership check
  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  try {
    // Fetch project metadata + anon key from Management API
    const [projectMeta, apiKeys] = await Promise.all([
      managementGet(c, `/v1/projects/${ref}`),
      managementGet(c, `/v1/projects/${ref}/api-keys`),
    ]);

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

    await c.env.KV_METADATA.put(
      `project:${projectId}:supabase`,
      JSON.stringify(link),
    );

    // Fetch initial schema in background (don't block link creation)
    try {
      await fetchAndCacheSchema(c, projectId, ref);
    } catch (schemaErr: any) {
      console.warn(`[Supabase] Initial schema fetch failed (non-fatal): ${schemaErr?.message || "unknown"}`);
    }

    console.log(`[Supabase] action=link status=ok userId=${userId} projectId=${projectId} ref=${ref}`);
    return c.json({ ok: true, link });
  } catch (err: any) {
    if (err?.message === "supabase_reauth_required") {
      return c.json({ error: "Supabase connection expired. Reconnect to continue.", code: "supabase_reauth_required" }, 401);
    }
    console.error(`[Supabase] action=link status=fail userId=${userId} projectId=${projectId} ${err?.message || "unknown"}`);
    return c.json({ error: "Failed to link project" }, 500);
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

// ── Unlink ─────────────────────────────────────────────────────────────────
supabaseRouter.delete("/link", async (c) => {
  const userId = c.get("userId");
  const { projectId } = await c.req.json();

  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  await c.env.KV_METADATA.delete(`project:${projectId}:supabase`);
  await c.env.KV_METADATA.delete(`project:${projectId}:supabase_schema`);
  // Keep migration history for re-link scenarios

  console.log(`[Supabase] action=unlink status=ok userId=${userId} projectId=${projectId}`);
  return c.json({ ok: true });
});

// ── Schema (cached 5min) ───────────────────────────────────────────────────
supabaseRouter.get("/schema", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required", code: "missing_project" }, 400);

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ error: "Supabase not linked to this project", code: "supabase_not_linked" }, 400);
  const link: SupabaseLinkRecord = JSON.parse(linkRaw);

  const forceRefresh = c.req.query("refresh") === "true";

  if (!forceRefresh) {
    const cachedRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase_schema`);
    if (cachedRaw) {
      const cached: SupabaseSchemaRecord = JSON.parse(cachedRaw);
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < 300_000) {
        return c.json(cached.tables);
      }
    }
  }

  try {
    const tables = await fetchAndCacheSchema(c, projectId, link.ref);
    return c.json(tables);
  } catch (err: any) {
    if (err?.message === "supabase_reauth_required") {
      return c.json({ error: "Supabase connection expired.", code: "supabase_reauth_required" }, 401);
    }
    console.warn(`[Supabase] action=fetch_schema status=fail projectId=${projectId} ${err?.message || "unknown"}`);
    // Return cached even if expired — better than nothing
    const staleRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase_schema`);
    if (staleRaw) {
      const stale: SupabaseSchemaRecord = JSON.parse(staleRaw);
      return c.json(stale.tables);
    }
    return c.json([]);
  }
});

// ── Run SQL (migration) ────────────────────────────────────────────────────
supabaseRouter.post("/sql", async (c) => {
  const userId = c.get("userId");
  const { projectId, sql } = await c.req.json();

  if (!projectId || !sql) {
    return c.json({ error: "projectId and sql are required", code: "missing_fields" }, 400);
  }

  const projectExists = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
  if (!projectExists) return c.json({ error: "Project not found" }, 404);

  const linkRaw = await c.env.KV_METADATA.get(`project:${projectId}:supabase`);
  if (!linkRaw) return c.json({ error: "Supabase not linked to this project", code: "supabase_not_linked" }, 400);
  const link: SupabaseLinkRecord = JSON.parse(linkRaw);

  // Block dangerous statements
  const upper = sql.toUpperCase();
  if (/\bDROP\s+DATABASE\b/.test(upper) || /\bALTER\s+ROLE\b/.test(upper)) {
    return c.json({ error: "This SQL statement is blocked for safety.", code: "sql_blocked" }, 400);
  }

  // Rate limit: 100 SQL/hr/user
  const rateKey = `ratelimit:sql:${userId}`;
  const rateCount = parseInt(await c.env.KV_METADATA.get(rateKey) || "0");
  if (rateCount >= 100) {
    return c.json({ error: "Rate limit exceeded (100 SQL executions/hour).", code: "rate_limited" }, 429);
  }

  const migrationId = nanoid(10);
  const start = Date.now();

  try {
    const result = await managementPost(c, `/v1/projects/${link.ref}/database/query`, { query: sql });

    // Invalidate schema cache
    await c.env.KV_METADATA.delete(`project:${projectId}:supabase_schema`);

    // Append to migration history
    await appendMigration(c, projectId, userId, {
      id: migrationId,
      appliedAt: new Date().toISOString(),
      description: "Manual / AI-proposed migration",
      sql,
      appliedByUserId: userId,
      result: "success",
    });

    // Update rate limit
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
      description: "AI-proposed migration",
      sql,
      appliedByUserId: userId,
      result: "error",
      errorMessage,
    });

    console.error(`[Supabase] action=run_sql status=fail userId=${userId} projectId=${projectId} ref=${link.ref} durationMs=${durationMs} err=${errorMessage.slice(0, 200)}`);

    if (err?.message === "supabase_reauth_required") {
      return c.json({ error: "Supabase connection expired. Reconnect to continue.", code: "supabase_reauth_required" }, 401);
    }

    return c.json({
      error: "Migration failed. See details below.",
      code: "sql_exec_failed",
      details: errorMessage.slice(0, 500),
    }, 400);
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

// ── Helpers (context-aware — must receive a real Hono context, not a mock) ──

type SupabaseCtx = ReturnType<typeof supabaseRouter> extends { _bindings: infer B; _variables: infer V }
  ? import("hono").Context<B, string, V>
  : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _CtxCheck = SupabaseCtx extends import("hono").Context<{ Bindings: Bindings; Variables: Variables }, string, { Variables: Variables }> ? true : never;

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

/** Fetch schema from Supabase Management API and cache in KV (TTL 300s). */
async function fetchAndCacheSchema(
  c: import("hono").Context<{ Bindings: Bindings; Variables: Variables }>,
  projectId: string,
  ref: string,
): Promise<any[]> {
  const result = await managementPost(c, `/v1/projects/${ref}/database/query`, {
    query: SCHEMA_INTROSPECTION_SQL,
  });

  const tables = Array.isArray(result) ? result.map((row: any) => ({
    name: row.table_name,
    schema: row.table_schema || "public",
    columns: Array.isArray(row.columns) ? row.columns : JSON.parse(row.columns || "[]"),
    rlsEnabled: row.rls_enabled === true,
    policies: Array.isArray(row.policies) ? row.policies : JSON.parse(row.policies || "[]"),
  })) : [];

  const schemaRecord: SupabaseSchemaRecord = {
    fetchedAt: new Date().toISOString(),
    tables,
  };

  await c.env.KV_METADATA.put(
    `project:${projectId}:supabase_schema`,
    JSON.stringify(schemaRecord),
    { expirationTtl: 300 },
  );

  return tables;
}

/** Append a migration entry to the per-project history (capped at 50). */
async function appendMigration(
  c: import("hono").Context<{ Bindings: Bindings; Variables: Variables }>,
  projectId: string,
  userId: string,
  entry: {
    id: string;
    appliedAt: string;
    description: string;
    sql: string;
    appliedByUserId: string;
    result: "success" | "error";
    errorMessage?: string;
  },
): Promise<void> {
  const key = `project:${projectId}:supabase_migrations`;
  const raw = await c.env.KV_METADATA.get(key);
  const record: SupabaseMigrationRecord = raw
    ? JSON.parse(raw)
    : { history: [] };

  record.history.push(entry);
  if (record.history.length > 50) {
    record.history = record.history.slice(-50);
  }

  await c.env.KV_METADATA.put(key, JSON.stringify(record));
}

export default supabaseRouter;
