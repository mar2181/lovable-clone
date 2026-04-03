import { Bindings } from "../index";

// In development, credits are unlimited
const UNLIMITED_DEV_CREDITS = true;

// Owner/admin emails — these accounts ALWAYS get unlimited credits in any environment
const OWNER_EMAILS = new Set([
  "hssolutions2181@gmail.com",
]);

// Cache of admin user IDs (resolved from email on first auth hit)
const ownerUserIds = new Set<string>();

/** Call this from auth middleware to register owner accounts by email */
export function registerOwnerIfAdmin(userId: string, email?: string | null) {
  if (email && OWNER_EMAILS.has(email.toLowerCase())) {
    ownerUserIds.add(userId);
  }
}

export function isOwner(userId: string): boolean {
  return ownerUserIds.has(userId);
}

export async function hasEnoughCredits(userId: string, kv: KVNamespace): Promise<{ hasCredits: boolean, balance: number }> {
  // Owner accounts always have unlimited credits
  if (isOwner(userId)) {
    return { hasCredits: true, balance: 99999 };
  }

  if (UNLIMITED_DEV_CREDITS) {
    return { hasCredits: true, balance: 9999 };
  }

  try {
    const creditsStr = await kv.get(`user:${userId}:credits`);

    if (!creditsStr) {
      return { hasCredits: true, balance: 10 };
    }

    const credits = JSON.parse(creditsStr);
    return {
      hasCredits: credits.balance > 0,
      balance: credits.balance
    };
  } catch (error) {
    console.error("Credit check failed:", error);
    return { hasCredits: false, balance: 0 };
  }
}

export async function deductCredit(userId: string, amount: number = 1, kv: KVNamespace): Promise<boolean> {
  // Owner accounts never get deducted
  if (isOwner(userId)) {
    return true;
  }

  if (UNLIMITED_DEV_CREDITS) {
    return true; // Don't actually deduct in dev
  }

  try {
     const creditsStr = await kv.get(`user:${userId}:credits`);
     if (!creditsStr) return false;

     const credits = JSON.parse(creditsStr);
     if (credits.balance < amount) return false;

     credits.balance -= amount;
     credits.updatedAt = new Date().toISOString();

     await kv.put(`user:${userId}:credits`, JSON.stringify(credits));
     return true;
  } catch (error) {
    console.error("Credit deduction failed:", error);
    return false;
  }
}
