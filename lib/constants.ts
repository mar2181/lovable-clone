// Default to 8788 because 8787 is held by another local service in this dev
// environment. .env.local should set NEXT_PUBLIC_WORKER_URL explicitly; this
// is just the safety net.
export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8788";
