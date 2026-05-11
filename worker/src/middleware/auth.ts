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

export async function authMiddleware(c: Context, next: Next) {
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
    return c.json({ error: "Unauthorized - No token provided" }, 401);
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
}
