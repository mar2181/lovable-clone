/**
 * Supabase client — calls OUR worker's /api/supabase/* endpoints.
 *
 * This is NOT the supabase-js package. That package is only used inside
 * generated user projects. This module talks to the worker to orchestrate
 * the OAuth flow, project linking, schema fetching, and SQL execution.
 */

import { WORKER_URL } from "./constants";

type FetchFn = typeof fetch;

export interface SupabaseLinkInfo {
  ref: string;
  name: string;
  restUrl: string;
  anonKey: string;
  organization_name: string;
  status: "active" | "paused" | "errored";
}

export interface SupabaseMe {
  connected: boolean;
  supabaseEmail?: string;
  supabaseUserId?: string;
  scopes?: string[];
  obtainedAt?: string;
}

export interface SupabaseConnectStatus {
  linked: boolean;
  connected: boolean;
  link?: SupabaseLinkInfo;
}

export interface SupabaseProject {
  ref: string;
  name: string;
  region: string;
  status: string;
  organization_id: string;
  organization_name: string;
  created_at: string;
}

export interface SupabaseTable {
  name: string;
  schema: string;
  columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
  rlsEnabled: boolean;
  policies: Array<{ name: string; command: string; definition: string; roles: string[] }>;
}

export interface SqlResult {
  ok: boolean;
  result?: unknown;
  migrationId?: string;
  error?: string;
  code?: string;
  details?: string;
}

async function authFetch(
  path: string,
  token: string,
  opts: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> || {}),
    },
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.code === "supabase_reauth_required") {
      throw new Error("supabase_reauth_required");
    }
  }
  return res;
}

export async function startOAuth(token: string, projectId: string): Promise<string> {
  const res = await authFetch(
    `/api/supabase/oauth/start?projectId=${encodeURIComponent(projectId)}`,
    token,
  );
  if (!res.ok) throw new Error("oauth_start_failed");
  return (await res.json()).url;
}

export async function getMe(token: string): Promise<SupabaseMe> {
  const res = await authFetch("/api/supabase/me", token);
  return res.json();
}

export async function getConnectStatus(token: string, projectId: string): Promise<SupabaseConnectStatus> {
  const res = await authFetch(
    `/api/supabase/connect-status?projectId=${encodeURIComponent(projectId)}`,
    token,
  );
  return res.json();
}

export async function listProjects(token: string): Promise<SupabaseProject[]> {
  const res = await authFetch("/api/supabase/projects", token);
  return res.json();
}

export async function createProject(
  token: string,
  name: string,
  region: string,
  organization_id: string,
  db_pass: string,
): Promise<SupabaseProject> {
  const res = await authFetch("/api/supabase/projects", token, {
    method: "POST",
    body: JSON.stringify({ name, region, organization_id, db_pass }),
  });
  if (!res.ok) throw new Error("create_project_failed");
  return res.json();
}

export async function linkProject(
  token: string,
  projectId: string,
  ref: string,
): Promise<{ ok: boolean; link: SupabaseLinkInfo }> {
  const res = await authFetch("/api/supabase/link", token, {
    method: "POST",
    body: JSON.stringify({ projectId, ref }),
  });
  if (!res.ok) throw new Error("link_failed");
  return res.json();
}

export async function unlinkProject(
  token: string,
  projectId: string,
): Promise<{ ok: boolean }> {
  const res = await authFetch("/api/supabase/link", token, {
    method: "DELETE",
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) throw new Error("unlink_failed");
  return res.json();
}

export async function getSchema(
  token: string,
  projectId: string,
  refresh = false,
): Promise<SupabaseTable[]> {
  const res = await authFetch(
    `/api/supabase/schema?projectId=${encodeURIComponent(projectId)}${refresh ? "&refresh=true" : ""}`,
    token,
  );
  return res.json();
}

export async function runSql(
  token: string,
  projectId: string,
  sql: string,
): Promise<SqlResult> {
  const res = await authFetch("/api/supabase/sql", token, {
    method: "POST",
    body: JSON.stringify({ projectId, sql }),
  });
  return res.json();
}

export async function getMigrationHistory(
  token: string,
  projectId: string,
): Promise<{ history: Array<{ id: string; appliedAt: string; description: string; sql: string; appliedByUserId: string; result: string; errorMessage?: string }> }> {
  const res = await authFetch(
    `/api/supabase/migrations?projectId=${encodeURIComponent(projectId)}`,
    token,
  );
  return res.json();
}
