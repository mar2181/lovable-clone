/**
 * Supabase Management API client — PAT-based (no OAuth).
 *
 * Uses a single SUPABASE_PAT secret for all Management API calls.
 * The generated client app (the user's project) uses @supabase/supabase-js
 * directly — that's a completely separate concern.
 */

const MANAGEMENT_ORIGIN = "https://api.supabase.com";

async function mgmtFetch(
  pat: string,
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${MANAGEMENT_ORIGIN}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${pat}`,
      ...(opts.headers as Record<string, string> || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(empty)");
    const status = res.status;
    if (status === 401) throw new Error("supabase_pat_invalid");
    if (status === 429) throw new Error("supabase_rate_limited");
    throw new Error(`supabase_mgmt_${status}: ${text.slice(0, 300)}`);
  }
  return res;
}

export async function managementGet(pat: string, path: string) {
  const res = await mgmtFetch(pat, path);
  return res.json();
}

export async function managementPost(pat: string, path: string, body?: unknown) {
  const res = await mgmtFetch(pat, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export async function managementDelete(pat: string, path: string) {
  const res = await mgmtFetch(pat, path, { method: "DELETE" });
  if (res.status === 204) return null;
  return res.json();
}
