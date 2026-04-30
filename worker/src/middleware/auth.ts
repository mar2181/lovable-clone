import { Context, Next } from "hono";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { registerOwnerIfAdmin } from "../services/credits";

// JWKS is cached across requests within a worker instance. jose's
// createRemoteJWKSet handles its own internal caching; we memoize the
// builder so we don't recompute the URL on every request.
let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedFrontendApi: string | null = null;
let cachedPublishableKey: string | null = null;

function deriveFrontendApi(publishableKey: string): string | null {
  // Clerk publishable keys: "pk_(test|live)_<base64(frontend-api + '$')>"
  // The base64 payload decodes to e.g. "clerk.example.com$"
  try {
    const stripped = publishableKey.replace(/^pk_(test|live)_/, "");
    const decoded = atob(stripped);
    const frontendApi = decoded.replace(/\$+$/, "").trim();
    if (!frontendApi || !frontendApi.includes(".")) return null;
    return frontendApi;
  } catch {
    return null;
  }
}

function getJWKS(publishableKey: string): { jwks: ReturnType<typeof createRemoteJWKSet>; frontendApi: string } | null {
  if (cachedJWKS && cachedFrontendApi && cachedPublishableKey === publishableKey) {
    return { jwks: cachedJWKS, frontendApi: cachedFrontendApi };
  }
  const frontendApi = deriveFrontendApi(publishableKey);
  if (!frontendApi) return null;
  const jwksUrl = new URL(`https://${frontendApi}/.well-known/jwks.json`);
  cachedJWKS = createRemoteJWKSet(jwksUrl);
  cachedFrontendApi = frontendApi;
  cachedPublishableKey = publishableKey;
  return { jwks: cachedJWKS, frontendApi };
}

export async function authMiddleware(c: Context, next: Next) {
  // ---------------------------------------------------------------------------
  // MCP API Key bypass — for internal tool access (MCP server, scripted tests).
  // Intentionally scoped: requires BOTH a non-empty MCP_API_KEY env var AND a
  // matching X-API-Key header. There is no implicit fallback.
  // ---------------------------------------------------------------------------
  const apiKey = c.req.header("X-API-Key");
  if (apiKey && c.env.MCP_API_KEY && apiKey === c.env.MCP_API_KEY) {
    const serviceUserId = c.req.header("X-User-Id") || "mcp-service-user";
    c.set("userId", serviceUserId);
    console.log(`[MCP Auth] API key accepted, user=${serviceUserId}`);
    await next();
    return;
  }

  // ---------------------------------------------------------------------------
  // Clerk JWT verification — the real auth path.
  // ---------------------------------------------------------------------------
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — no bearer token" }, 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return c.json({ error: "Unauthorized — empty token" }, 401);
  }

  const publishableKey = c.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    console.error("[Auth] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set");
    return c.json({ error: "Server configuration error" }, 500);
  }

  const jwksBundle = getJWKS(publishableKey);
  if (!jwksBundle) {
    console.error("[Auth] Could not derive Clerk frontend API from publishable key");
    return c.json({ error: "Server configuration error" }, 500);
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, jwksBundle.jwks, {
      issuer: `https://${jwksBundle.frontendApi}`,
      // Clerk session JWTs do not carry an `aud` claim by default.
      // Skipping audience verification is consistent with Clerk's own SDKs.
    });
    payload = result.payload;
  } catch (err: any) {
    const code = err?.code || err?.name || "unknown";
    if (code === "ERR_JWT_EXPIRED" || code === "JWTExpired") {
      return c.json({ error: "Unauthorized — token expired" }, 401);
    }
    if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" || code === "JWSSignatureVerificationFailed") {
      console.warn("[Auth] Bad signature");
      return c.json({ error: "Unauthorized — invalid signature" }, 401);
    }
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" || code === "JWTClaimValidationFailed") {
      return c.json({ error: "Unauthorized — claim validation failed" }, 401);
    }
    console.warn("[Auth] JWT verify failed:", code, err?.message);
    return c.json({ error: "Unauthorized — invalid token" }, 401);
  }

  if (!payload.sub || typeof payload.sub !== "string") {
    return c.json({ error: "Unauthorized — missing subject claim" }, 401);
  }

  c.set("userId", payload.sub);

  // Register owner/admin accounts for unlimited credits.
  // (The owner cache is in-process; this is best-effort and re-runs per cold start.)
  const email =
    (payload as any).email ||
    (payload as any).primary_email ||
    (payload as any).email_addresses?.[0]?.email_address;
  registerOwnerIfAdmin(payload.sub, email);

  await next();
}
