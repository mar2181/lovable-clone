import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import { isOwner, getOrInitCredits } from "../services/credits";

const creditsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

creditsRouter.use("*", authMiddleware);

creditsRouter.get("/", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;

  // Unlimited credits in development
  const devCredits = {
    userId,
    balance: 9999,
    tier: "unlimited",
    updatedAt: new Date().toISOString()
  };

  const devBypassEnabled =
    c.env.ENVIRONMENT === "development" || c.env.DEV_BYPASS_AUTH === "1";
  if (devBypassEnabled) {
    return c.json({ credits: devCredits });
  }

  try {
    // Single source of truth for balances + first-use seeding (FREE_CREDITS).
    const credits = await getOrInitCredits(userId, kv);
    return c.json({ credits });
  } catch (error) {
    console.error("Failed to fetch credits:", error);
    return c.json({ error: "Failed to fetch credits" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/credits/add — owner-only.
// Self-service credit grants are a money-abuse hole. Until a real Stripe
// webhook handler exists (with signature verification), this route only
// accepts requests from registered owner accounts.
// ---------------------------------------------------------------------------
creditsRouter.post("/add", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;

  if (!isOwner(userId)) {
    return c.json(
      { error: "Credit purchases are not enabled yet. Contact an administrator." },
      403
    );
  }

  let body: { amount?: number; targetUserId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    return c.json({ error: "amount must be a positive number <= 10000" }, 400);
  }

  // Owner can grant credits to themselves or to a specific target user.
  const grantTarget = body.targetUserId && typeof body.targetUserId === "string"
    ? body.targetUserId
    : userId;

  try {
    const creditsStr = await kv.get(`user:${grantTarget}:credits`);
    const credits = creditsStr
      ? JSON.parse(creditsStr)
      : { userId: grantTarget, balance: 0, tier: "pro" };

    credits.balance += amount;
    credits.updatedAt = new Date().toISOString();

    await kv.put(`user:${grantTarget}:credits`, JSON.stringify(credits));
    console.log(`[Credits] Owner ${userId} granted ${amount} credits to ${grantTarget}`);

    return c.json({ credits });
  } catch (error) {
    console.error("Failed to add credits:", error);
    return c.json({ error: "Failed to add credits" }, 500);
  }
});

export default creditsRouter;
