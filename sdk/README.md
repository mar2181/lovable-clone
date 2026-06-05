# @hs/builder-sdk

A small, dependency-free TypeScript client for the **HS Web App Builder** API
(the lovable-clone worker). Uses the global `fetch`, so it runs anywhere modern
JS does: Node 18+, Cloudflare Workers, Deno, Bun, and browsers.

## Install

This package lives inside the monorepo. From a consumer:

```bash
npm install @hs/builder-sdk
# then build it (no prebuilt dist is published):
npm run build --workspace @hs/builder-sdk
```

Or copy `sdk/src/index.ts` into your project and import it directly.

## Authentication

The constructor takes one of three auth modes:

| Option   | Header sent                       | Use for                          |
| -------- | --------------------------------- | -------------------------------- |
| `apiKey` | `X-API-Key: <apiKey>`             | MCP / service-to-service callers |
| `token`  | `Authorization: Bearer <token>`   | A specific user                  |
| (none)   | `Authorization: Bearer dev-local-user` | Local dev / tests           |

`apiKey` wins if both are supplied.

```ts
import { BuilderClient } from "@hs/builder-sdk";

// Production, as a user:
const hs = new BuilderClient({ token: "user-jwt-here" });

// Local worker, dev auth:
const local = new BuilderClient({
  baseUrl: "http://localhost:8799",
  // no token → falls back to "dev-local-user"
});

// As an MCP/service caller:
const svc = new BuilderClient({ apiKey: process.env.MCP_API_KEY });
```

Default `baseUrl` is `https://lovable-clone-backend.hssolutions2181.workers.dev`.

## Usage

```ts
const hs = new BuilderClient({ token: "dev-local-user" });

// List + fetch projects
const { projects } = await hs.listProjects();
const { project } = await hs.getProject(projects[0].id);

// Latest version (includes the file map)
const { version } = await hs.getLatestVersion(project.id);
console.log(Object.keys(version.files));

// Generate a fresh project from a template
const created = await hs.createFromTemplate("contractor", {
  businessName: "Rio Grande Roofing",
  city: "McAllen",
  state: "TX",
  phone: "(956) 555-0100",
  email: "hi@rgroofing.com",
  services: [{ name: "Roof Repair" }, { name: "Roof Replacement" }],
});

// Deploy a project's latest version to Vercel
const deploy = await hs.deployToVercel(project.id);
console.log("Live at", deploy.deploymentUrl);

// Import an existing GitHub repo as a new project
const imported = await hs.importFromGitHub("owner/some-repo");
```

### Multi-page build (streaming)

`build()` returns the raw `Response` because the endpoint streams Server-Sent
Events. Consume `res.body` to follow progress:

```ts
const res = await hs.build(project.id, "A bilingual roofing site for McAllen TX");
const reader = res.body!.getReader();
const decoder = new TextDecoder();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value)); // build_start, batch_*, build_complete
}
```

### Clone-and-swap: retarget a template to a new firm

The recommended flow is **dry-run first** to preview the extracted identity,
confirm it, then run the real swap with `createCopy` so the master template
stays pristine.

```ts
const sourceId = "tuqnPHcLCa"; // the pristine lawyer master (or any clone)

// 1) DRY RUN — scrape the firm's site, see what we'd swap in, swap nothing.
const preview = await hs.retargetFromUrl(sourceId, {
  sourceUrl: "https://www.marreroinjurylaw.com",
  dryRun: true,
});
console.log("Extracted identity:", preview.extracted);
console.log("Still missing:", preview.missing); // fill these via `overrides`

// 2) CREATE — once it looks right, run the real swap into a NEW project copy.
const result = await hs.retargetFromUrl(sourceId, {
  sourceUrl: "https://www.marreroinjurylaw.com",
  createCopy: true,
  newProjectName: "Marrero Injury Law",
  overrides: {
    // Anything the scrape missed or you want to force:
    phone: "(956) 800-1000",
    state: "TX",
  },
});
console.log("New project:", result.project.id, "v" + result.newVersion);
console.log("Replacements applied:", result.appliedTotal, result.byRule);
console.log("Images still needing a client asset:", result.imagesNeedingReplacement);
```

You can also swap with an explicit identity (no scraping):

```ts
const result = await hs.retargetManual(
  sourceId,
  {
    firmFull: "Marrero Injury Law Firm",
    attorneyFull: "David Marrero",
    phone: "(956) 800-1000",
    addressLine: "4200 N 10th St, Suite 200",
    city: "McAllen",
    state: "TX",
    zip: "78501",
  },
  { createCopy: true, newProjectName: "Marrero Injury Law" },
);
```

## Errors

Any non-2xx response throws a `BuilderApiError` carrying `.status` and `.body`:

```ts
import { BuilderApiError } from "@hs/builder-sdk";

try {
  await hs.getProject("does-not-exist");
} catch (err) {
  if (err instanceof BuilderApiError) {
    console.error(err.status, err.body); // 404 {"error":"Project not found"}
  }
}
```

## API surface

| Method | Endpoint |
| --- | --- |
| `listProjects()` | `GET /api/projects` |
| `getProject(id)` | `GET /api/projects/:id` |
| `getLatestVersion(id)` | `GET /api/versions/:id/latest` |
| `createFromTemplate(templateId, businessInfo, smartFill?)` | `POST /api/template/generate` |
| `build(projectId, prompt)` | `POST /api/build/:projectId` (SSE) |
| `retargetManual(projectId, target, opts?)` | `POST /api/retarget/:id` |
| `retargetFromUrl(projectId, opts)` | `POST /api/retarget/:id/from-url` |
| `deployToVercel(projectId)` | fetches latest version, then `POST /api/vercel/deploy` |
| `importFromGitHub(repoUrl, branch?)` | `POST /api/github/import` |

## License

UNLICENSED — internal HS Solutions use.
