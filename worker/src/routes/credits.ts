import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";

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

  if (c.env.ENVIRONMENT === "development") {
    return c.json({ credits: devCredits });
  }

  try {
    const creditsStr = await kv.get(`user:${userId}:credits`);

    if (!creditsStr) {
      const initialCredits = {
        userId,
        balance: 10,
        tier: "free",
        updatedAt: new Date().toISOString()
      };

      await kv.put(`user:${userId}:credits`, JSON.stringify(initialCredits));
      return c.json({ credits: initialCredits });
    }

    return c.json({ credits: JSON.parse(creditsStr) });
  } catch (error) {
    console.error("Failed to fetch credits:", error);
    return c.json({ error: "Failed to fetch credits" }, 500);
  }
});

// Admin-only route for actual real money recharge (mocked for now)
creditsRouter.post("/add", async (c) => {
  const userId = c.get("userId");
  const kv = c.env.KV_METADATA;
  const { amount } = await c.req.json();
  
  // Here we would normally verify a Stripe webhook signature
  
  try {
    const creditsStr = await kv.get(`user:${userId}:credits`);
    let credits = creditsStr ? JSON.parse(creditsStr) : { userId, balance: 0, tier: "pro" };
    
    credits.balance += amount;
    credits.updatedAt = new Date().toISOString();
    
    await kv.put(`user:${userId}:credits`, JSON.stringify(credits));
    
    return c.json({ credits });
  } catch (error) {
    return c.json({ error: "Failed to add credits" }, 500);
  }
});

export default creditsRouter;
