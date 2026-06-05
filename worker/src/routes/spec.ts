import { Hono } from "hono";
import { Bindings, Variables } from "../index";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — agent-friendly API surface.
//
// GET /api/spec.json (mounted PUBLIC, no authMiddleware) returns a complete
// OpenAPI 3.1 document describing the builder's public REST API so AI agents and
// MCP clients can discover endpoints, request/response shapes, and the two auth
// schemes without reading the source.
//
// This document is hand-authored from the live route handlers (projects.ts,
// versions.ts, template.ts, github.ts, vercel.ts, retarget.ts, attachments.ts)
// and intentionally documents only the stable, agent-facing endpoints — not the
// streaming chat/build internals or the editor-only inline-edit/taste routes.
// ─────────────────────────────────────────────────────────────────────────────

const specRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Authored as a plain object literal so it type-checks under the worker's strict
// tsconfig and ships zero runtime cost (no schema library, no validation hop).
const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "HS Web App Builder API",
    version: "1.0.0",
    description:
      "Public REST API for the HS Web App Builder. Lets agents create projects, " +
      "read version history and generated files, scaffold from templates, import " +
      "from / push to GitHub, deploy to Vercel, clone-and-swap a template onto a " +
      "new business (retarget), and manage attachments. Most endpoints require " +
      "authentication via a Clerk session JWT (bearerAuth) or an internal service " +
      "key (apiKeyAuth, header X-API-Key). Project files live in append-only " +
      "versions: each mutation writes a new version rather than overwriting.",
  },
  servers: [
    {
      url: "https://lovable-clone-backend.hssolutions2181.workers.dev",
      description: "production",
    },
    { url: "http://localhost:8799", description: "local dev" },
  ],
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  tags: [
    { name: "Projects", description: "Create, read, rename, and delete projects." },
    { name: "Versions", description: "Append-only version history and generated files." },
    { name: "Templates", description: "List templates and scaffold a project from one." },
    { name: "GitHub", description: "Import a repo as a project, or push a project to a repo." },
    { name: "Vercel", description: "Deploy a project's files to Vercel." },
    { name: "Retarget", description: "Clone-and-swap a template onto a new business identity." },
    { name: "Attachments", description: "Upload, list, and delete per-project file attachments." },
    { name: "Meta", description: "Service health and this API specification." },
  ],
  paths: {
    "/api/spec.json": {
      get: {
        tags: ["Meta"],
        summary: "Get this OpenAPI specification",
        description: "Returns this OpenAPI 3.1 document. Public — no authentication required.",
        operationId: "getApiSpec",
        security: [],
        responses: {
          "200": {
            description: "The OpenAPI document.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/health": {
      get: {
        tags: ["Meta"],
        summary: "Health check",
        description: "Liveness probe. Public — no authentication required.",
        operationId: "health",
        security: [],
        responses: {
          "200": {
            description: "Service is up.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", example: "ok" } },
                  required: ["status"],
                },
              },
            },
          },
        },
      },
    },
    "/api/projects": {
      get: {
        tags: ["Projects"],
        summary: "List the current user's projects",
        operationId: "listProjects",
        responses: {
          "200": {
            description: "All projects owned by the authenticated user.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    projects: { type: "array", items: { $ref: "#/components/schemas/Project" } },
                  },
                  required: ["projects"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
      post: {
        tags: ["Projects"],
        summary: "Create a new project",
        description:
          "Creates a project seeded with the default React/Vite template as version 1.",
        operationId: "createProject",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Project display name (required)." },
                  description: { type: "string" },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Project created.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    project: { $ref: "#/components/schemas/Project" },
                    version: { type: "integer", example: 1 },
                  },
                  required: ["project", "version"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/projects/{id}": {
      parameters: [{ $ref: "#/components/parameters/ProjectId" }],
      get: {
        tags: ["Projects"],
        summary: "Get a single project",
        operationId: "getProject",
        responses: {
          "200": {
            description: "The project metadata.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { project: { $ref: "#/components/schemas/Project" } },
                  required: ["project"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
      patch: {
        tags: ["Projects"],
        summary: "Rename a project",
        operationId: "updateProject",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string", description: "New project name." } },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The updated project.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { project: { $ref: "#/components/schemas/Project" } },
                  required: ["project"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
      delete: {
        tags: ["Projects"],
        summary: "Delete a project",
        description:
          "Deletes the project metadata, all versions in R2, and cascade-deletes " +
          "linked attachments, Supabase links, and per-project state.",
        operationId: "deleteProject",
        responses: {
          "200": {
            description: "Deleted.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { success: { type: "boolean", example: true } },
                  required: ["success"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/projects/{id}/clone": {
      parameters: [{ $ref: "#/components/parameters/ProjectId" }],
      post: {
        tags: ["Projects"],
        summary: "Clone a project",
        description:
          "Seeds a brand-new, fully independent project from the source project's " +
          "current files as version 1. Version history, chat, memory, and " +
          "integrations are NOT copied.",
        operationId: "cloneProject",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", description: 'Name for the clone (default "Copy of …").' },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The cloned project.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    project: { $ref: "#/components/schemas/Project" },
                    version: { type: "integer", example: 1 },
                  },
                  required: ["project", "version"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/Unprocessable" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/versions/{id}": {
      parameters: [{ $ref: "#/components/parameters/ProjectId" }],
      get: {
        tags: ["Versions"],
        summary: "List version history metadata",
        description:
          "Returns up to the 50 most recent versions (newest first), without the " +
          "heavy file contents.",
        operationId: "listVersions",
        responses: {
          "200": {
            description: "Version history (metadata only).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    history: {
                      type: "array",
                      items: { $ref: "#/components/schemas/VersionSummary" },
                    },
                  },
                  required: ["history"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
      post: {
        tags: ["Versions"],
        summary: "Save a new manual version",
        description:
          "Appends a new version carrying the supplied files (e.g. after a manual " +
          "edit in the code editor).",
        operationId: "saveVersion",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  files: {
                    $ref: "#/components/schemas/FileMap",
                  },
                  message: { type: "string", description: 'Commit-style label (default "Manual Edit").' },
                },
                required: ["files"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Saved.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    version: { type: "integer" },
                  },
                  required: ["success", "version"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/versions/{id}/latest": {
      parameters: [{ $ref: "#/components/parameters/ProjectId" }],
      get: {
        tags: ["Versions"],
        summary: "Get the latest version (with files)",
        description: "Returns the full latest version object, including the file map.",
        operationId: "getLatestVersion",
        responses: {
          "200": {
            description: "The latest version.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { version: { $ref: "#/components/schemas/Version" } },
                  required: ["version"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/versions/{id}/{versionNum}": {
      parameters: [
        { $ref: "#/components/parameters/ProjectId" },
        {
          name: "versionNum",
          in: "path",
          required: true,
          description: "Positive integer version number.",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      get: {
        tags: ["Versions"],
        summary: "Get a specific version (with files)",
        operationId: "getVersion",
        responses: {
          "200": {
            description: "The requested version.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { version: { $ref: "#/components/schemas/Version" } },
                  required: ["version"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/versions/{id}/{versionNum}/restore": {
      parameters: [
        { $ref: "#/components/parameters/ProjectId" },
        {
          name: "versionNum",
          in: "path",
          required: true,
          description: "The version to restore.",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      post: {
        tags: ["Versions"],
        summary: "Restore a previous version",
        description:
          "Append-only rollback: copies the chosen version's files into a brand-new " +
          "version and points the project at it (history is preserved).",
        operationId: "restoreVersion",
        responses: {
          "200": {
            description: "Restored as a new version.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    version: { type: "integer" },
                    files: { $ref: "#/components/schemas/FileMap" },
                    dependencies: { $ref: "#/components/schemas/Dependencies" },
                  },
                  required: ["success", "version", "files"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/Unprocessable" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/template": {
      get: {
        tags: ["Templates"],
        summary: "List available templates",
        operationId: "listTemplates",
        responses: {
          "200": {
            description: "Template catalog (summaries).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    templates: {
                      type: "array",
                      items: { $ref: "#/components/schemas/TemplateSummary" },
                    },
                  },
                  required: ["templates"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/template/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Template id.",
          schema: { type: "string" },
        },
      ],
      get: {
        tags: ["Templates"],
        summary: "Get a single template",
        operationId: "getTemplate",
        responses: {
          "200": {
            description: "The full template definition.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { template: { type: "object" } },
                  required: ["template"],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/template/generate": {
      post: {
        tags: ["Templates"],
        summary: "Generate a project from a template",
        description:
          "Scaffolds a full project from a template + business info. When " +
          "smartFill is true (default) a lightweight AI pass enhances copy " +
          "(tagline, about, hero, FAQs, reviews) before the project is saved as " +
          "version 1.",
        operationId: "generateFromTemplate",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  templateId: { type: "string" },
                  businessInfo: { $ref: "#/components/schemas/BusinessInfo" },
                  smartFill: {
                    type: "boolean",
                    default: true,
                    description: "Run the AI content-enhancement pass (default true).",
                  },
                },
                required: ["templateId", "businessInfo"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Project generated.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    project: { $ref: "#/components/schemas/Project" },
                    version: { type: "integer", example: 1 },
                    files: { $ref: "#/components/schemas/FileMap" },
                    dependencies: { $ref: "#/components/schemas/Dependencies" },
                    smartFill: { type: "boolean" },
                  },
                  required: ["project", "version", "files"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/github/import": {
      post: {
        tags: ["GitHub"],
        summary: "Import a GitHub repo as a new project",
        description:
          "Reads a repo's file tree on the given (or default) branch, decodes text " +
          "files and inlines raster images as data: URIs, and creates a new project " +
          "as version 1. Caps: 200 files, 256 KB per text file, 6 MB text total, " +
          "512 KB per image, 3 MB images total. node_modules/build dirs and " +
          "lockfiles are skipped.",
        operationId: "githubImport",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  repoUrl: {
                    type: "string",
                    description:
                      "owner/repo, an https github URL, or a git@ URL. A /tree/<branch> URL is honored.",
                    example: "https://github.com/owner/repo",
                  },
                  branch: {
                    type: "string",
                    description: "Branch to import (defaults to the repo's default branch).",
                  },
                },
                required: ["repoUrl"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Imported.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    project: { $ref: "#/components/schemas/Project" },
                    version: { type: "integer", example: 1 },
                    imported: { type: "integer", description: "Number of files imported." },
                    skipped: { type: "integer" },
                    failed: { type: "integer" },
                    truncated: { type: "boolean" },
                  },
                  required: ["project", "version", "imported"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "502": { $ref: "#/components/responses/BadGateway" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/github/push": {
      post: {
        tags: ["GitHub"],
        summary: "Push a project's files to a GitHub repo",
        description:
          "Creates the repo if needed (or reuses the repo previously pinned to this " +
          "project) and writes every file via the GitHub Contents API. Best for " +
          "fewer than ~100 files.",
        operationId: "githubPush",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  repoName: { type: "string", description: "Target repo name (bare name)." },
                  files: { $ref: "#/components/schemas/FileMap" },
                  projectId: {
                    type: "string",
                    description:
                      "Pins this project to the created/used repo so later pushes reuse it.",
                  },
                },
                required: ["repoName", "files"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Push complete (check `pushed` vs `total`).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    repoUrl: { type: "string", format: "uri" },
                    repoName: { type: "string" },
                    reusedExisting: { type: "boolean" },
                    pushed: { type: "integer" },
                    total: { type: "integer" },
                    errors: { type: "array", items: { type: "string" } },
                  },
                  required: ["success", "repoUrl", "repoName", "pushed", "total"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/vercel/deploy": {
      post: {
        tags: ["Vercel"],
        summary: "Deploy a project's files to Vercel",
        description:
          "Detects the framework (Vite vs create-react-app) from the incoming " +
          "package.json, scaffolds any missing build files, deploys to production " +
          "via the Vercel v13 deployments API, and polls until the build reaches a " +
          "terminal state. If the project was deployed before, the same Vercel " +
          "project is reused (no duplicate).",
        operationId: "vercelDeploy",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  files: { $ref: "#/components/schemas/FileMap" },
                  projectId: {
                    type: "string",
                    description:
                      "Used to name and pin the Vercel project; also pulls Supabase env if linked.",
                  },
                },
                required: ["files"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Deployment finished (or still building after the poll window).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VercelDeployResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": {
            description: "Server misconfiguration or a Vercel build error.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    deploymentId: { type: "string" },
                  },
                  required: ["error"],
                },
              },
            },
          },
        },
      },
    },
    "/api/retarget/{id}": {
      parameters: [{ $ref: "#/components/parameters/ProjectId" }],
      post: {
        tags: ["Retarget"],
        summary: "Clone-and-swap a template onto a new business",
        description:
          "Re-targets the orlando-family law-firm template (master `tuqnPHcLCa` or " +
          "any fresh clone) to a NEW firm in one shot: firm name, split-logo JSX, " +
          "attorney name, both phones + the tel: href, address, city/state/zip, " +
          "concierge token, and optional brand colors and per-image swaps. " +
          "Replacements are global and longest-match-first. By default a clone is " +
          "made first (createCopy=true) so the master stays pristine; otherwise an " +
          "append-only new version is written in place.",
        operationId: "retarget",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  target: { $ref: "#/components/schemas/RetargetTarget" },
                  createCopy: {
                    type: "boolean",
                    default: true,
                    description: "Clone first and swap the copy (default true).",
                  },
                  newProjectName: {
                    type: "string",
                    description: "Name for the copy (createCopy only).",
                  },
                  extraReplacements: {
                    type: "array",
                    description: "Literal old→new string swaps applied last.",
                    items: {
                      type: "object",
                      properties: { old: { type: "string" }, new: { type: "string" } },
                      required: ["old", "new"],
                    },
                  },
                },
                required: ["target"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Swap complete.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RetargetResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/Unprocessable" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/retarget/{id}/from-url": {
      parameters: [{ $ref: "#/components/parameters/ProjectId" }],
      post: {
        tags: ["Retarget"],
        summary: "Retarget by scraping a firm's website",
        description:
          "Scrapes the target firm's website (Firecrawl), extracts its public " +
          "identity with an LLM, merges caller `overrides` (which win), then runs " +
          "the same swap as POST /api/retarget/{id}. With dryRun=true (or when " +
          "required fields can't be extracted) it returns the extracted identity " +
          "WITHOUT swapping so the caller can confirm or supply overrides.",
        operationId: "retargetFromUrl",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  sourceUrl: {
                    type: "string",
                    format: "uri",
                    description: "The target firm's website (http:// or https://).",
                  },
                  dryRun: {
                    type: "boolean",
                    default: false,
                    description: "Preview the extracted identity without swapping.",
                  },
                  overrides: {
                    allOf: [{ $ref: "#/components/schemas/RetargetTarget" }],
                    description: "Partial target fields; these win over anything scraped.",
                  },
                  createCopy: { type: "boolean", default: true },
                  newProjectName: { type: "string" },
                  extraReplacements: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { old: { type: "string" }, new: { type: "string" } },
                      required: ["old", "new"],
                    },
                  },
                },
                required: ["sourceUrl"],
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "dryRun preview — the extracted identity and resolved target (no swap).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RetargetDryRunResponse" },
              },
            },
          },
          "201": {
            description: "Swap complete (extracted identity is echoed back).",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/RetargetResponse" },
                    {
                      type: "object",
                      properties: {
                        extracted: { $ref: "#/components/schemas/RetargetTarget" },
                        target: { $ref: "#/components/schemas/RetargetTarget" },
                        sourceMeta: { $ref: "#/components/schemas/ScrapeMeta" },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "422": {
            description:
              "Required identity fields could not be extracted — supply them via overrides.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RetargetDryRunResponse" },
              },
            },
          },
          "502": { $ref: "#/components/responses/BadGateway" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/attachments": {
      get: {
        tags: ["Attachments"],
        summary: "List a project's attachments",
        operationId: "listAttachments",
        parameters: [
          {
            name: "projectId",
            in: "query",
            required: true,
            description: "The project whose attachments to list.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "The project's attachments.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    attachments: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Attachment" },
                    },
                  },
                  required: ["attachments"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
      post: {
        tags: ["Attachments"],
        summary: "Upload an attachment",
        description:
          "Multipart upload of a single file scoped to a project. Max 100 MB; " +
          "rate-limited per user.",
        operationId: "uploadAttachment",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                  projectId: { type: "string" },
                },
                required: ["file", "projectId"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Uploaded.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Attachment" } },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "413": {
            description: "File exceeds the 100 MB limit.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "415": {
            description: "Unsupported file type.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Too many uploads — rate limited.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
    "/api/attachments/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "Attachment id.",
          schema: { type: "string" },
        },
      ],
      delete: {
        tags: ["Attachments"],
        summary: "Delete an attachment",
        operationId: "deleteAttachment",
        responses: {
          "200": {
            description: "Deleted.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { success: { type: "boolean", example: true } },
                  required: ["success"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Clerk session JWT. Send `Authorization: Bearer <token>`. The worker " +
          "verifies it against the Clerk JWKS derived from the publishable key. In " +
          "local dev (ENVIRONMENT=development or DEV_BYPASS_AUTH=1) the literal " +
          "token `dev-local-user` is accepted.",
      },
      apiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description:
          "Internal service / MCP key. Send `X-API-Key: <MCP_API_KEY>`. Optionally " +
          "pass `X-User-Id` to scope the request to a specific user (defaults to " +
          "`mcp-service-user`).",
      },
    },
    parameters: {
      ProjectId: {
        name: "id",
        in: "path",
        required: true,
        description: "The project id.",
        schema: { type: "string" },
      },
    },
    responses: {
      BadRequest: {
        description: "Malformed request (missing or invalid fields).",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Unauthorized: {
        description: "Missing or invalid credentials.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Resource not found (or not owned by the caller).",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Unprocessable: {
        description: "The request was understood but cannot be processed (e.g. no files/versions).",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      BadGateway: {
        description: "An upstream service (GitHub, Firecrawl, the LLM) failed.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ServerError: {
        description: "Unexpected server error.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string", description: "Human-readable error message." } },
        required: ["error"],
      },
      Project: {
        type: "object",
        description: "Project metadata stored at KV `user:{userId}:project:{id}`.",
        properties: {
          id: { type: "string", description: "10-char project id." },
          userId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          templateId: { type: "string", description: "Set when created from a template." },
          thumbnailUrl: { type: "string", format: "uri" },
        },
        required: ["id", "userId", "name", "createdAt", "updatedAt"],
      },
      FileMap: {
        type: "object",
        description:
          'A virtual filesystem: keys are absolute file paths (e.g. "/src/App.tsx"), ' +
          "values are the file contents (raster images may be data: URIs).",
        additionalProperties: { type: "string" },
      },
      Dependencies: {
        type: "object",
        description: 'npm dependencies as a name→version-range map, e.g. {"clsx":"^2.1.0"}.',
        additionalProperties: { type: "string" },
      },
      Version: {
        type: "object",
        description: "A full version record stored at R2 `{id}/v{n}.json`.",
        properties: {
          version: { type: "integer", description: "Monotonically increasing version number." },
          createdAt: { type: "string", format: "date-time" },
          prompt: { type: "string", description: "What produced this version." },
          files: { $ref: "#/components/schemas/FileMap" },
          dependencies: { $ref: "#/components/schemas/Dependencies" },
        },
        required: ["version", "createdAt", "files"],
      },
      VersionSummary: {
        type: "object",
        description: "Version history entry without the file contents.",
        properties: {
          version: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          prompt: { type: "string" },
        },
        required: ["version"],
      },
      TemplateSummary: {
        type: "object",
        description: "Summary fields returned by GET /api/template.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          icon: { type: "string" },
          businessTypes: { type: "array", items: { type: "string" } },
          defaultServices: { type: "array", items: { type: "string" } },
          defaultPages: { type: "array", items: { type: "string" } },
          colorSchemes: { type: "array", items: {} },
          sections: { type: "array", items: { type: "string" } },
        },
        required: ["id", "name"],
      },
      BusinessInfo: {
        type: "object",
        description:
          "Business details used to scaffold a template. `businessName` is required; " +
          "the rest populate contact, services, and brand colors.",
        properties: {
          businessName: { type: "string" },
          tagline: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          primaryColor: { type: "string" },
          secondaryColor: { type: "string" },
          services: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["name"],
            },
          },
        },
        required: ["businessName"],
      },
      Attachment: {
        type: "object",
        description: "A file uploaded against a project.",
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          projectId: { type: "string" },
          filename: { type: "string" },
          mimeType: { type: "string" },
          kind: { type: "string", description: "Derived kind (e.g. image, document)." },
          sizeBytes: { type: "integer" },
          r2Key: { type: "string" },
          publicUrl: { type: "string", format: "uri" },
          uploadedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "projectId", "filename", "mimeType", "publicUrl", "uploadedAt"],
      },
      RetargetTarget: {
        type: "object",
        description:
          "The NEW business identity to swap in. Required: firmFull, attorneyFull, " +
          "phone, addressLine, city, state, zip. Mirrors the `target` shape in " +
          "retarget.ts.",
        properties: {
          firmFull: { type: "string", example: "Marrero Injury Law Firm" },
          logo: {
            type: "object",
            description: "Header wordmark split; derived from firmFull if omitted.",
            properties: {
              first: { type: "string" },
              accent: { type: "string" },
              suffix: { type: "string", default: "Law" },
            },
          },
          attorneyFull: { type: "string", example: "David Marrero" },
          attorneyLast: { type: "string", description: "Derived from attorneyFull if omitted." },
          phone: { type: "string", example: "(956) 800-1000" },
          addressLine: { type: "string", example: "4200 N 10th St, Suite 200" },
          city: { type: "string" },
          state: { type: "string", description: "2-letter USPS code." },
          zip: { type: "string" },
          embedToken: {
            type: ["string", "null"],
            description: "Concierge data-token; kept if null.",
          },
          colorMap: {
            type: ["object", "null"],
            description: 'Brand recolor map, e.g. {"#C9A84C":"#1d4ed8"}.',
            additionalProperties: { type: "string" },
          },
          images: {
            type: "object",
            description: "Per-image URL swaps { oldUrl: newUrl }.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["firmFull", "attorneyFull", "phone", "addressLine", "city", "state", "zip"],
      },
      RetargetResponse: {
        type: "object",
        description: "Result of a successful swap.",
        properties: {
          project: { $ref: "#/components/schemas/Project" },
          sourceId: { type: "string", description: "The project that was retargeted from." },
          newVersion: { type: "integer" },
          createdCopy: { type: "boolean", description: "True if a new project was cloned." },
          appliedTotal: { type: "integer", description: "Total string replacements made." },
          byRule: {
            type: "object",
            description: "Per-rule replacement counts (firm-full, phone, address, …).",
            additionalProperties: { type: "integer" },
          },
          residuals: {
            type: "object",
            description: "Old-identity strings still present after the swap (gaps).",
            additionalProperties: {
              type: "object",
              properties: {
                count: { type: "integer" },
                files: { type: "array", items: { type: "string" } },
              },
            },
          },
          imagesNeedingReplacement: {
            type: "array",
            description: "Source-template image URLs the caller still needs to replace.",
            items: { type: "string" },
          },
        },
        required: ["project", "sourceId", "newVersion", "createdCopy", "appliedTotal"],
      },
      RetargetDryRunResponse: {
        type: "object",
        description:
          "Returned by /from-url in preview mode or when required fields can't be " +
          "extracted (no swap performed).",
        properties: {
          dryRun: { type: "boolean" },
          extracted: { $ref: "#/components/schemas/RetargetTarget" },
          target: { $ref: "#/components/schemas/RetargetTarget" },
          missing: {
            type: "array",
            description: "Required fields still missing after scrape + overrides.",
            items: { type: "string" },
          },
          sourceMeta: { $ref: "#/components/schemas/ScrapeMeta" },
          error: { type: "string" },
        },
        required: ["extracted", "missing"],
      },
      ScrapeMeta: {
        type: "object",
        description: "Metadata about the scraped source page.",
        properties: {
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          statusCode: { type: "integer" },
          markdownChars: { type: "integer" },
        },
      },
      VercelDeployResponse: {
        type: "object",
        description: "Result of a Vercel deploy.",
        properties: {
          success: { type: "boolean", example: true },
          deploymentUrl: {
            type: "string",
            format: "uri",
            description: "Cleanest production URL (the stable alias when READY).",
          },
          previewUrl: { type: "string", format: "uri", description: "The per-deploy URL." },
          aliases: { type: "array", items: { type: "string", format: "uri" } },
          deploymentId: { type: "string" },
          vercelProjectName: { type: "string" },
          reusedExisting: { type: "boolean" },
          status: {
            type: "string",
            description: "Vercel readyState (READY, ERROR, CANCELED, BUILDING, …).",
          },
          warning: { type: "string", description: "Set if the build was still in progress." },
        },
        required: ["success", "deploymentUrl", "status"],
      },
    },
  },
} as const;

// GET / — the spec. Public; safe to cache at the edge.
specRouter.get("/", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json(OPENAPI_DOCUMENT);
});

export default specRouter;
