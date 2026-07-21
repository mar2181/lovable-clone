// Unlimited credits are reserved for owner/admin accounts only (see isOwner).
// This was previously `true`, which granted EVERY authenticated user unlimited
// credits — fine while the only way in was the dev-bypass, but a credit-burn
// abuse vector once real Clerk sign-up is enabled. Non-owners now fall through
// to the metered path (10 free credits, then KV-tracked balance).
const UNLIMITED_DEV_CREDITS = false;

// Free credits granted to a brand-new (non-owner) account on first use.
export const FREE_CREDITS = 10;

// Shape of the KV record at `user:<id>:credits`.
export type CreditRecord = {
  userId: string;
  balance: number;
  tier: string;
  createdAt?: string;
  updatedAt: string;
};

// Owner/admin emails — these accounts ALWAYS get unlimited credits in any environment
const OWNER_EMAILS = new Set([
  "hssolutions2181@gmail.com",
]);

// Cache of admin user IDs (resolved from email on first auth hit)
const ownerUserIds = new Set<string>();

/** True if this email is an owner/admin (case-insensitive). */
export function isOwnerEmail(email?: string | null): boolean {
  return !!email && OWNER_EMAILS.has(email.toLowerCase());
}

/** Call this from auth middleware to register owner accounts by email */
export function registerOwnerIfAdmin(userId: string, email?: string | null) {
  if (isOwnerEmail(email)) {
    ownerUserIds.add(userId);
  }
}

export function isOwner(userId: string): boolean {
  return ownerUserIds.has(userId);
}

/**
 * Read the user's credit record, seeding a free-tier record the first time we
 * ever see them. This is the single source of truth for balances: without it a
 * new user has NO KV record, so the balance is a phantom that never decrements
 * (= unlimited free generations). Owners/dev-bypass never reach here.
 * NOTE: KV is eventually consistent and has no atomic compare-and-swap, so two
 * simultaneous requests can race a small over-spend; balance never goes negative
 * (deduct re-checks). True atomicity would need a Durable Object — acceptable for
 * the gated beta.
 */
export async function getOrInitCredits(userId: string, kv: KVNamespace): Promise<CreditRecord> {
  const creditsStr = await kv.get(`user:${userId}:credits`);
  if (creditsStr) {
    const parsed = JSON.parse(creditsStr) as Partial<CreditRecord>;
    return {
      userId,
      balance: typeof parsed.balance === "number" ? parsed.balance : 0,
      tier: parsed.tier || "free",
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  }
  const now = new Date().toISOString();
  const seeded: CreditRecord = {
    userId,
    balance: FREE_CREDITS,
    tier: "free",
    createdAt: now,
    updatedAt: now,
  };
  await kv.put(`user:${userId}:credits`, JSON.stringify(seeded));
  console.log(`[Credits] seeded new user=${userId} balance=${FREE_CREDITS}`);
  return seeded;
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
    const credits = await getOrInitCredits(userId, kv);
    return {
      hasCredits: credits.balance > 0,
      balance: credits.balance,
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
     // Seed-on-first-use so a brand-new user is actually charged (previously a
     // missing record short-circuited to `return false`, and callers ignore the
     // return value → the generation ran but nothing was ever deducted).
     const credits = await getOrInitCredits(userId, kv);
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
