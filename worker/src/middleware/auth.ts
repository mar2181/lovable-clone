import { Context, Next } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { registerOwnerIfAdmin } from "../services/credits";

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized - No token provided" }, 401);
  }

  const token = authHeader.split(" ")[1];
  const clerkPublishableKey = c.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!clerkPublishableKey) {
    console.warn("Clerk Publishable Key is missing in environment");
    // During local dev, if keys are missing we might want to bypass or mock, 
    // but for production this should strictly fail
    return c.json({ error: "Server Configuration Error" }, 500);
  }

  // Extract the JWKS URL from the publishable key format
  // Clerk publishable keys look like: pk_test_Y2xlcmu...
  try {
    // This is a simplified validation. In a real production environment,
    // you would verify the JWT against Clerk's JWKS endpoint:
    // https://<YOUR_CLERK_DOMAIN>/.well-known/jwks.json
    
    // For local dev without a real domain, we are extracting the userId directly
    // This assumes the frontend is sending a valid Clerk token
    
    // WARNING: In production, MUST use proper jose jwtVerify with remote JWKS
    // const JWKS = createRemoteJWKSet(new URL(`https://${clerkDomain}/.well-known/jwks.json`))
    // const { payload } = await jwtVerify(token, JWKS)
    
    // For now, we'll try to extract the user ID assuming token is valid (Dev mode fallback)
    // A robust implementation would use Clerk's backend SDK (which isn't fully Edge compatible)
    // or properly configure the JWKS URL
    
    // Temporary dev-mode parsing (NOT SECURE FOR PROD)
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    
    const payload = JSON.parse(jsonPayload);
    
    // Clerk usually stores user id in 'sub'
    if (!payload.sub) {
       return c.json({ error: "Invalid token structure" }, 401);
    }
    
    c.set("userId", payload.sub);

    // Register owner/admin accounts for unlimited credits
    const email = payload.email || payload.primary_email || payload.email_addresses?.[0]?.email_address;
    registerOwnerIfAdmin(payload.sub, email);

    await next();
  } catch (error) {
    console.error("Auth error:", error);
    return c.json({ error: "Unauthorized - Invalid token" }, 401);
  }
}
