import { Context, Next } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";

// Cache JWKS per Clerk domain to avoid recreating on every request
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(clerkDomain: string) {
  if (!jwksCache.has(clerkDomain)) {
    const jwksUrl = new URL(`https://${clerkDomain}/.well-known/jwks.json`);
    jwksCache.set(clerkDomain, createRemoteJWKSet(jwksUrl));
  }
  return jwksCache.get(clerkDomain)!;
}

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
  // Development dev-bypass — matches the frontend lib/dev-auth.tsx fake user.
  // Only fires when ENVIRONMENT === "development" AND the bearer token is the
  // exact dev token. Owner email is registered so isOwner() returns true and
  // the dashboard shows the unlimited badge + project list.
  // ---------------------------------------------------------------------------
  const devAuthHeader = c.req.header("Authorization");
  if (
    c.env.ENVIRONMENT === "development" &&
    devAuthHeader === "Bearer dev-local-user"
  ) {
    const devUserId = "dev-local-user";
    c.set("userId", devUserId);
    registerOwnerIfAdmin(devUserId, "hssolutions2181@gmail.com");
    console.log(`[Dev Auth] dev-bypass accepted, user=${devUserId}`);
    await next();
    return;
  }

  // ---------------------------------------------------------------------------
  // Clerk JWT verification — the real auth path.
  // ---------------------------------------------------------------------------
  const authHeader = c.req.header("Authorization");
  const env = c.env.ENVIRONMENT;
  const devToken = "dev-local-user";

  // Local dev bypass: allow the localhost frontend even if Clerk is not configured
  // or the compiled frontend sends an older/empty dev token.
  if (env === "development") {
    c.set("userId", devToken);
    await next();
    return;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — no bearer token" }, 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return c.json({ error: "Unauthorized — empty token" }, 401);
  }

  const token = authHeader.split(" ")[1];

  // CLERK_DOMAIN is the Clerk frontend API domain (e.g. "clerk.your-app.com")
  // or the issuer URL without protocol (e.g. "clerk.your-app.com")
  const clerkDomain = c.env.CLERK_DOMAIN;

  if (!clerkDomain) {
    console.error("CLERK_DOMAIN is missing in worker environment");
    return c.json({ error: "Server Configuration Error" }, 500);
  }

  try {
    const JWKS = getJWKS(clerkDomain);
    const issuer = `https://${clerkDomain}`;

    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
    });

    if (!payload.sub) {
      return c.json({ error: "Invalid token structure" }, 401);
    }

    c.set("userId", payload.sub);

    // Register owner/admin accounts for unlimited credits
    const email =
      (payload.email as string) ||
      (payload.primary_email as string) ||
      (payload.email_addresses as any)?.[0]?.email_address;
    const { registerOwnerIfAdmin } = await import("../services/credits");
    registerOwnerIfAdmin(payload.sub, email);

    await next();
  } catch (error: any) {
    console.error("Auth JWT verification failed:", error?.code || error?.message || error);
    return c.json({ error: "Unauthorized - Invalid token" }, 401);
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
