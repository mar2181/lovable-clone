/**
 * Supabase client — calls OUR worker's /api/supabase/* endpoints.
 *
 * Auth is handled server-side via SUPABASE_PAT — no OAuth popup needed.
 * This module talks to the worker to orchestrate project linking, schema
 * fetching, and SQL execution.
 */

import { WORKER_URL } from "./constants";

export interface SupabaseLinkInfo {
  ref: string;
  name: string;
  restUrl: string;
  anonKey: string;
  organization_name: string;
  status: "active" | "paused" | "errored";
}

export interface SupabaseConnectStatus {
  linked: boolean;
  patConfigured: boolean;
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
  return fetch(`${WORKER_URL}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> || {}),
    },
  });
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

