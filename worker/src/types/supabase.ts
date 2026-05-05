/**
 * KV record shapes for the Supabase integration.
 * All keys live in KV_METADATA (same namespace as projects/credits/etc.).
 *
 * Key naming:
 *   user:{userId}:supabase_refresh     — encrypted refresh token (no TTL)
 *   user:{userId}:supabase_access      — plain access token (TTL = expires_in - 60s)
 *   user:{userId}:supabase_projects_cache — project list cache (60s TTL)
 *   oauth_state:{nonce}                — PKCE verifier + metadata (5min TTL)
 *   project:{projectId}:supabase       — per-project link
 *   project:{projectId}:supabase_schema — cached schema introspection (5min TTL)
 *   project:{projectId}:supabase_migrations — migration history (capped 50)
 */

/** Encrypted refresh-token record. Refresh tokens are AES-GCM encrypted at rest. */
export interface SupabaseRefreshRecord {
  tokenCipher: string;   // AES-GCM ciphertext, base64
  iv: string;            // base64 IV (12 bytes)
  obtainedAt: string;    // ISO 8601
  scopes: string[];      // ["read:organizations", "write:projects", "sql:write", ...]
  supabaseUserId: string; // sub claim from Supabase OAuth
  supabaseEmail: string;
}

/** Cached access-token record (plaintext — short-lived). */
export interface SupabaseAccessRecord {
  accessToken: string;
  expiresAt: string;     // ISO 8601
  obtainedAt: string;
}

/** Per-project Supabase link — written when operator picks a project. */
export interface SupabaseLinkRecord {
  ref: string;           // Supabase project ref, e.g. "abcdefghijklmnop"
  name: string;
  region: string;
  organization_id: string;
  organization_name: string;
  restUrl: string;       // "https://abcdefghijklmnop.supabase.co"
  anonKey: string;       // public anon key — safe to expose
  linkedAt: string;
  linkedByUserId: string;
  status: "active" | "paused" | "errored";
}

/** Introspected table schema — cached at project:{projectId}:supabase_schema (TTL 300s). */
export interface SupabaseSchemaRecord {
  fetchedAt: string;
  tables: SupabaseTableInfo[];
}

export interface SupabaseTableInfo {
  name: string;
  schema: string;        // usually "public"
  columns: SupabaseColumnInfo[];
  rlsEnabled: boolean;
  policies: SupabasePolicyInfo[];
}

export interface SupabaseColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface SupabasePolicyInfo {
  name: string;
  command: string;       // SELECT, INSERT, UPDATE, DELETE, ALL
  definition: string;
  roles: string[];
}

/** Migration history entry — append-only, capped at 50. */
export interface SupabaseMigrationEntry {
  id: string;            // nanoid(10)
  appliedAt: string;
  description: string;
  sql: string;
  appliedByUserId: string;
  result: "success" | "error";
  errorMessage?: string;
}

export interface SupabaseMigrationRecord {
  history: SupabaseMigrationEntry[];
}

/** OAuth state stash — stored during the popup handshake. */
export interface OAuthStateStash {
  verifier: string;      // PKCE code_verifier
  userId: string;
  projectId: string;
}

/** Returned from /api/supabase/me. */
export interface SupabaseMeResponse {
  connected: boolean;
  supabaseEmail?: string;
  supabaseUserId?: string;
  scopes?: string[];
  obtainedAt?: string;
}

/** Returned from /api/supabase/projects (list). */
export interface SupabaseProjectSummary {
  ref: string;
  name: string;
  region: string;
  status: string;
  organization_id: string;
  organization_name: string;
  created_at: string;
}

/** AI migration proposal — surfaced from chat SSE "done" event. */
export interface AIChatMigration {
  description: string;
  sql: string;
}
