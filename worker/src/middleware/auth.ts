import { Context, Next } from "hono";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { registerOwnerIfAdmin, isOwnerEmail } from "../services/credits";

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
    // MCP-API-key holders are fully trusted internal callers (the key is a
    // write-only worker secret). Treat them as owner for confused-deputy gates.
    c.set("isOwner", true);
    console.log(`[MCP Auth] API key accepted, user=${serviceUserId}`);
    await next();
    return;
  }

  // ---------------------------------------------------------------------------
  // Development / dev-bypass — matches the frontend lib/dev-auth.tsx fake user.
  // Fires when ENVIRONMENT === "development" (local dev) OR DEV_BYPASS_AUTH=1
  // (production dev-bypass, e.g. for internal testing) AND the bearer token is
  // the exact dev token. Owner email is registered so isOwner() returns true
  // and the dashboard shows the unlimited badge + project list.
  // ---------------------------------------------------------------------------
  const devAuthHeader = c.req.header("Authorization");
  const devBypassEnabled =
    c.env.ENVIRONMENT === "development" || c.env.DEV_BYPASS_AUTH === "1";
  if (
    devBypassEnabled &&
    devAuthHeader === "Bearer dev-local-user"
  ) {
    const devUserId = "dev-local-user";
    c.set("userId", devUserId);
    c.set("isOwner", true);
    registerOwnerIfAdmin(devUserId, "hssolutions2181@gmail.com");
    console.log(`[Dev Auth] dev-bypass accepted, user=${devUserId}`);
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

  let email =
    (payload as any).email ||
    (payload as any).primary_email ||
    (payload as any).email_addresses?.[0]?.email_address;

  // Clerk's DEFAULT session token does not carry an email claim. When it's
  // absent, resolve it from the Clerk Backend API by subject id so owner-remap
  // still fires reliably (best-effort; never blocks auth on a lookup failure).
  if (!email && c.env.CLERK_SECRET_KEY) {
    try {
      const lookup = await fetch(`https://api.clerk.com/v1/users/${payload.sub}`, {
        headers: { Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}` },
      });
      if (lookup.ok) {
        const u: any = await lookup.json();
        email =
          u?.email_addresses?.find((e: any) => e.id === u.primary_email_address_id)?.email_address ||
          u?.email_addresses?.[0]?.email_address;
      } else {
        console.warn(`[Auth] Clerk user lookup failed: ${lookup.status}`);
      }
    } catch (err) {
      console.warn("[Auth] Clerk user lookup error:", String(err));
    }
  }

  // The legacy single-operator workspace (47 projects) lives under the
  // "dev-local-user" namespace. Map the owner's real Clerk identity onto that
  // namespace so retiring the public dev-bypass does NOT orphan their work —
  // zero data migration. Non-owner users keep their own Clerk subject id.
  // Owner is matched by email (when the token/Backend-API yields it) OR by an
  // explicit subject-id pin (OWNER_CLERK_SUB) — the pin is instance-agnostic and
  // works even when email resolution is unavailable.
  const isOwner =
    isOwnerEmail(email) ||
    (!!c.env.OWNER_CLERK_SUB && payload.sub === c.env.OWNER_CLERK_SUB);
  const uid = isOwner ? "dev-local-user" : payload.sub;
  c.set("userId", uid);
  c.set("isOwner", isOwner);

  // Register owner/admin accounts for unlimited credits.
  // (The owner cache is in-process; this is best-effort and re-runs per cold start.)
  registerOwnerIfAdmin(uid, email);
  console.log(`[Auth] Clerk verified sub=${payload.sub} email=${email ?? "?"} -> uid=${uid}`);

  await next();
}

// -----------------------------------------------------------------------------
// ownerOnly — confused-deputy gate.
//
// Several routes act on the OPERATOR's shared third-party credentials (the
// Supabase management PAT, the GitHub PAT, the Vercel API key, the Twilio
// account). Until per-tenant credentials exist, a non-owner who reached these
// routes would be borrowing Mario's identity — arbitrary cross-tenant SQL,
// public repos under his account, prod deploys, SMS toll-fraud. This gate
// restricts such routes to the workspace owner (or a trusted MCP-key service
// call). Everyone else authenticated gets a clean 403.
//
// Mount AFTER authMiddleware so `isOwner` is populated:
//   router.use("*", authMiddleware);
//   router.use("*", ownerOnly);
// -----------------------------------------------------------------------------
export async function ownerOnly(c: Context, next: Next) {
  if (c.get("isOwner") === true) {
    await next();
    return;
  }
  console.warn(
    `[OwnerGate] blocked non-owner userId=${c.get("userId") ?? "?"} ${c.req.method} ${c.req.path}`,
  );
  return c.json(
    {
      error: "This feature isn't available on your account yet.",
      code: "owner_only",
    },
    403,
  );
}
