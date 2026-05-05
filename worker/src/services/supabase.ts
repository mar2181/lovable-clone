/**
 * Supabase Management API client + token lifecycle.
 *
 * - `exchangeCode()`   — POST /v1/oauth/token (authorization_code grant)
 * - `withSupabaseToken()` — wraps any Management API call with auto-refresh
 * - `managementGet/Post/Delete()` — thin fetchers that inject Bearer + JSON
 *
 * This module ONLY talks to https://api.supabase.com. The generated client
 * app (the user's project) uses @supabase/supabase-js directly — that's a
 * completely separate concern.
 */

import { Context } from "hono";
import { Bindings, Variables } from "../index";
import {
  decryptToken,
  encryptToken,
} from "./crypto";
import type {
  SupabaseRefreshRecord,
  SupabaseAccessRecord,
  SupabaseProjectSummary,
} from "../types/supabase";

const MANAGEMENT_ORIGIN = "https://api.supabase.com";
const TOKEN_ENDPOINT = `${MANAGEMENT_ORIGIN}/v1/oauth/token`;

// ── OAuth code exchange ────────────────────────────────────────────────────

interface CodeExchangeInput {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface CodeExchangeResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;         // space-separated
  token_type: "Bearer";
  sub: string;           // Supabase user ID
  email: string;
}

export async function exchangeCode(input: CodeExchangeInput): Promise<CodeExchangeResult> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(empty)");
    throw new Error(
      `Supabase OAuth token exchange failed: HTTP ${res.status} — ${body.slice(0, 300)}`,
    );
  }
  const json: CodeExchangeResult = await res.json();
  return json;
}

// ── Token refresh (refresh_token grant) ────────────────────────────────────

interface RefreshResult {
  access_token: string;
  refresh_token: string; // Supabase rotates the refresh token on every use
  expires_in: number;
  scope: string;
  token_type: "Bearer";
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<RefreshResult> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(empty)");
    throw new Error(
      `Supabase token refresh failed: HTTP ${res.status} — ${body.slice(0, 300)}`,
    );
  }
  const json: RefreshResult = await res.json();
  return json;
}

// ── withSupabaseToken — get a valid access token (cached or refreshed) ─────

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

export async function withSupabaseToken<T>(
  c: Ctx,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;

  // 1. Try cached access token
  const accessRaw = await kv.get(`user:${userId}:supabase_access`);
  if (accessRaw) {
    const access: SupabaseAccessRecord = JSON.parse(accessRaw);
    if (new Date(access.expiresAt).getTime() > Date.now() + 30_000) {
      // Token still valid with 30s grace period
      return fn(access.accessToken);
    }
  }

  // 2. Refresh via stored (encrypted) refresh token
  const refreshRaw = await kv.get(`user:${userId}:supabase_refresh`);
  if (!refreshRaw) throw new Error("supabase_not_connected");

  const refreshRec: SupabaseRefreshRecord = JSON.parse(refreshRaw);
  const refreshToken = await decryptToken(
    refreshRec.tokenCipher,
    refreshRec.iv,
    c.env.SUPABASE_TOKEN_ENC_KEY,
  );

  const refreshed = await refreshAccessToken(
    refreshToken,
    c.env.SUPABASE_OAUTH_CLIENT_ID,
    c.env.SUPABASE_OAUTH_CLIENT_SECRET,
  );

  // 3. Persist new tokens
  const { cipher, iv } = await encryptToken(
    refreshed.refresh_token,
    c.env.SUPABASE_TOKEN_ENC_KEY,
  );
  await kv.put(
    `user:${userId}:supabase_refresh`,
    JSON.stringify({
      tokenCipher: cipher,
      iv,
      obtainedAt: new Date().toISOString(),
      scopes: refreshed.scope.split(" "),
      supabaseUserId: refreshRec.supabaseUserId,
      supabaseEmail: refreshRec.supabaseEmail,
    } satisfies SupabaseRefreshRecord),
  );
  await kv.put(
    `user:${userId}:supabase_access`,
    JSON.stringify({
      accessToken: refreshed.access_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      obtainedAt: new Date().toISOString(),
    } satisfies SupabaseAccessRecord),
    { expirationTtl: refreshed.expires_in - 60 },
  );

  return fn(refreshed.access_token);
}

// ── Thin Management API wrappers ──────────────────────────────────────────

export async function managementGet(c: Ctx, path: string) {
  return withSupabaseToken(c, async (token) => {
    const res = await fetch(`${MANAGEMENT_ORIGIN}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) await handleMgmtError(res, c);
    return res.json();
  });
}

export async function managementPost(c: Ctx, path: string, body?: unknown) {
  return withSupabaseToken(c, async (token) => {
    const res = await fetch(`${MANAGEMENT_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) await handleMgmtError(res, c);
    return res.json();
  });
}

export async function managementDelete(c: Ctx, path: string) {
  return withSupabaseToken(c, async (token) => {
    const res = await fetch(`${MANAGEMENT_ORIGIN}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) await handleMgmtError(res, c);
    if (res.status === 204) return null;
    return res.json();
  });
}

async function handleMgmtError(res: Response, c: Ctx): Promise<never> {
  const text = await res.text().catch(() => "(empty)");
  const status = res.status;
  // Surface known Supabase error codes for the frontend to discriminate
  if (status === 401) throw new Error("supabase_reauth_required");
  if (status === 429) throw new Error("supabase_rate_limited");
  throw new Error(`supabase_mgmt_${status}: ${text.slice(0, 300)}`);
}
