/**
 * @hs/builder-sdk — a typed client for the HS Web App Builder API.
 *
 * Zero runtime dependencies: uses the global `fetch` available in modern
 * Node (>=18), Cloudflare Workers, Deno, Bun, and browsers.
 *
 * Quick start:
 *   import { BuilderClient } from "@hs/builder-sdk";
 *   const hs = new BuilderClient({ token: "dev-local-user" });
 *   const { projects } = await hs.listProjects();
 *
 * Auth:
 *   - Pass `apiKey` to authenticate as an MCP/service caller (X-API-Key header).
 *   - Pass `token` to authenticate as a user (Authorization: Bearer <token>).
 *   - With neither, falls back to the dev/test user "dev-local-user".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The identity to swap a clone-and-swap template TO. Mirrors the `target`
 * object accepted by `POST /api/retarget/:id` (see worker/src/routes/retarget.ts).
 * Required fields: firmFull, attorneyFull, phone, addressLine, city, state, zip.
 * Everything else is optional and derived/skipped when omitted.
 */
export interface RetargetTarget {
  /** Full firm name as written, e.g. "Marrero Injury Law Firm". */
  firmFull: string;
  /** Lead attorney's full name (first + last), e.g. "David Marrero". */
  attorneyFull: string;
  /** Primary phone, formatted "(XXX) XXX-XXXX". */
  phone: string;
  /** Street + suite only (no city/state/zip), e.g. "4200 N 10th St, Suite 200". */
  addressLine: string;
  /** City, e.g. "McAllen". */
  city: string;
  /** 2-letter USPS state code, e.g. "TX". */
  state: string;
  /** ZIP code, e.g. "78501". */
  zip: string;

  /** Attorney last name. Derived from `attorneyFull` when omitted. */
  attorneyLast?: string;
  /**
   * Header wordmark split. When omitted, `first`/`accent` are derived from the
   * first two words of `firmFull` and `suffix` defaults to "Law".
   */
  logo?: { first: string; accent: string; suffix?: string };
  /** Concierge data-token. Kept unchanged when null/omitted. */
  embedToken?: string | null;
  /** Brand color remap: { "#C9A84C": "#1d4ed8", ... }. */
  colorMap?: Record<string, string> | null;
  /** Per-image URL swaps: { oldUrl: newUrl }. */
  images?: Record<string, string>;
}

/** A single literal find/replace applied AFTER the identity swap. */
export interface ExtraReplacement {
  old: string;
  new: string;
}

/** Options shared by both retarget endpoints. */
export interface RetargetOptions {
  /** Clone the source first, keeping the master pristine. Defaults to true. */
  createCopy?: boolean;
  /** Name for the cloned project (only used when createCopy is true). */
  newProjectName?: string;
  /** Extra literal replacements applied last. */
  extraReplacements?: ExtraReplacement[];
}

/** Options for the scrape-driven retarget (`POST /api/retarget/:id/from-url`). */
export interface RetargetFromUrlOptions extends RetargetOptions {
  /** The target firm's website to scrape for its identity. */
  sourceUrl: string;
  /** When true, returns the extracted identity WITHOUT swapping (preview). */
  dryRun?: boolean;
  /** Caller-supplied fields that win over anything scraped. */
  overrides?: Partial<RetargetTarget>;
}

/** Business identity passed to `createFromTemplate` (the BusinessInfo shape). */
export interface BuilderClientOptions {
  /** API base URL. Defaults to the production worker. */
  baseUrl?: string;
  /** User bearer token. Used when `apiKey` is not supplied. */
  token?: string;
  /** MCP/service API key. When set, takes precedence over `token`. */
  apiKey?: string;
}

/** Thrown when the API responds with a non-2xx status. */
export class BuilderApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, path: string) {
    super(`HS Builder API ${status} on ${path}: ${body.slice(0, 500)}`);
    this.name = "BuilderApiError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE_URL =
  "https://lovable-clone-backend.hssolutions2181.workers.dev";

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

export class BuilderClient {
  private readonly baseUrl: string;
  private readonly authHeader: Record<string, string>;

  constructor(opts: BuilderClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.authHeader = opts.apiKey
      ? { "X-API-Key": opts.apiKey }
      : { Authorization: `Bearer ${opts.token ?? "dev-local-user"}` };
  }

  /** Core request helper: fires fetch, throws on !ok, returns parsed JSON. */
  private async request<T = any>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { ...this.authHeader };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const res = await fetch(this.baseUrl + path, {
      method: init.method ?? "GET",
      headers,
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BuilderApiError(res.status, text, path);
    }
    // All API routes return JSON; tolerate an empty body just in case.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  /** List all projects owned by the caller. GET /api/projects */
  listProjects<T = { projects: Array<Record<string, any>> }>(): Promise<T> {
    return this.request<T>("/api/projects");
  }

  /** Fetch a single project's metadata. GET /api/projects/:id */
  getProject<T = { project: Record<string, any> }>(id: string): Promise<T> {
    return this.request<T>(`/api/projects/${encodeURIComponent(id)}`);
  }

  // ── Versions ─────────────────────────────────────────────────────────────

  /**
   * Fetch the latest version (incl. the `files` map). GET /api/versions/:id/latest
   * Returns { version: { version, createdAt, prompt, files, dependencies? } }.
   */
  getLatestVersion<T = { version: Record<string, any> }>(
    id: string,
  ): Promise<T> {
    return this.request<T>(`/api/versions/${encodeURIComponent(id)}/latest`);
  }

  // ── Template generation ──────────────────────────────────────────────────

  /**
   * Generate a brand-new project from a template. POST /api/template/generate
   * @param templateId   one of the ids from GET /api/template
   * @param businessInfo the BusinessInfo payload (businessName is required)
   * @param smartFill    run the AI content enhancer (default true server-side)
   */
  createFromTemplate<T = { project: Record<string, any>; version: number; files: Record<string, string>; dependencies?: Record<string, string>; smartFill?: boolean }>(
    templateId: string,
    businessInfo: Record<string, any>,
    smartFill?: boolean,
  ): Promise<T> {
    return this.request<T>("/api/template/generate", {
      method: "POST",
      body: {
        templateId,
        businessInfo,
        ...(smartFill !== undefined ? { smartFill } : {}),
      },
    });
  }

  // ── Multi-page build (Ralph Loop) ────────────────────────────────────────

  /**
   * Kick off a multi-page build from a freeform description.
   * POST /api/build/:projectId with { description }.
   *
   * NOTE: this endpoint streams Server-Sent Events (build_start, batch_*,
   * build_complete, error) rather than returning a single JSON body. This
   * method returns the raw Response so the caller can consume `res.body`
   * (a ReadableStream of the SSE feed). Throws on a non-OK status.
   */
  async build(projectId: string, prompt: string): Promise<Response> {
    const res = await fetch(
      `${this.baseUrl}/api/build/${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        headers: { ...this.authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ description: prompt }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BuilderApiError(res.status, text, `/api/build/${projectId}`);
    }
    return res;
  }

  // ── Clone-and-swap (retarget) ────────────────────────────────────────────

  /**
   * Re-target a template with a caller-supplied identity. POST /api/retarget/:id
   * Returns { project, sourceId, newVersion, createdCopy, appliedTotal, byRule,
   * residuals, imagesNeedingReplacement }.
   */
  retargetManual<T = Record<string, any>>(
    projectId: string,
    target: RetargetTarget,
    opts: RetargetOptions = {},
  ): Promise<T> {
    return this.request<T>(`/api/retarget/${encodeURIComponent(projectId)}`, {
      method: "POST",
      body: {
        target,
        ...(opts.createCopy !== undefined ? { createCopy: opts.createCopy } : {}),
        ...(opts.newProjectName !== undefined ? { newProjectName: opts.newProjectName } : {}),
        ...(opts.extraReplacements !== undefined ? { extraReplacements: opts.extraReplacements } : {}),
      },
    });
  }

  /**
   * Scrape a firm's website, extract its identity with an LLM, then swap.
   * POST /api/retarget/:id/from-url
   *
   * With `dryRun: true` the server returns { dryRun, extracted, target,
   * missing, sourceMeta } WITHOUT swapping — use it to preview/confirm before
   * committing. Without dryRun it performs the swap and returns the full
   * retarget body plus { extracted, target, sourceMeta }.
   */
  retargetFromUrl<T = Record<string, any>>(
    projectId: string,
    opts: RetargetFromUrlOptions,
  ): Promise<T> {
    const { sourceUrl, dryRun, createCopy, newProjectName, overrides, extraReplacements } = opts;
    return this.request<T>(
      `/api/retarget/${encodeURIComponent(projectId)}/from-url`,
      {
        method: "POST",
        body: {
          sourceUrl,
          ...(dryRun !== undefined ? { dryRun } : {}),
          ...(createCopy !== undefined ? { createCopy } : {}),
          ...(newProjectName !== undefined ? { newProjectName } : {}),
          ...(overrides !== undefined ? { overrides } : {}),
          ...(extraReplacements !== undefined ? { extraReplacements } : {}),
        },
      },
    );
  }

  // ── Deploy / import ──────────────────────────────────────────────────────

  /**
   * Deploy a project's latest version to Vercel. POST /api/vercel/deploy
   *
   * The deploy endpoint takes the file map directly, so this first fetches the
   * project's latest version, then ships its `files` to Vercel. Returns
   * { success, deploymentUrl, previewUrl, aliases, deploymentId, ... }.
   */
  async deployToVercel<T = Record<string, any>>(
    projectId: string,
  ): Promise<T> {
    const latest = await this.getLatestVersion(projectId);
    const files = (latest as any)?.version?.files;
    if (!files || typeof files !== "object") {
      throw new Error(
        `Project ${projectId} has no files in its latest version to deploy`,
      );
    }
    return this.request<T>("/api/vercel/deploy", {
      method: "POST",
      body: { files, projectId },
    });
  }

  /**
   * Import an existing GitHub repo as a NEW editable project.
   * POST /api/github/import with { repoUrl }.
   * Accepts owner/repo, an https URL, an scp-style git@ URL, or a /tree/<branch>
   * URL. Returns { project, version, imported, skipped, failed, truncated }.
   */
  importFromGitHub<T = Record<string, any>>(
    repoUrl: string,
    branch?: string,
  ): Promise<T> {
    return this.request<T>("/api/github/import", {
      method: "POST",
      body: { repoUrl, ...(branch ? { branch } : {}) },
    });
  }
}

export default BuilderClient;
