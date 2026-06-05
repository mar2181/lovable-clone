import { Hono } from "hono";
import { Bindings, Variables } from "../index";
import { authMiddleware } from "../middleware/auth";
import type { SupabaseLinkRecord } from "../types/supabase";

const vercelRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

vercelRouter.use("*", authMiddleware);

// Default CRA dependencies that every deployed project needs
const DEFAULT_DEPENDENCIES: Record<string, string> = {
  react: "^18.2.0",
  "react-dom": "^18.2.0",
  "react-scripts": "5.0.1",
  "lucide-react": "^0.300.0",
  "react-router-dom": "^6.20.0",
  clsx: "^2.1.0",
  "tailwind-merge": "^2.2.0",
  typescript: "^4.9.5",
  "@types/react": "^18.2.0",
  "@types/react-dom": "^18.2.0",
  "@types/node": "^18.0.0",
};

// Default browserslist that CRA requires
const BROWSERSLIST = {
  production: [">0.2%", "not dead", "not op_mini all"],
  development: ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"],
};

// Generate src/index.tsx — the CRA entry point
function generateIndexTsx(appFiles: Record<string, string>): string {
  // Check if there's an App.tsx or App.jsx
  const hasAppTsx = "App.tsx" in appFiles || "src/App.tsx" in appFiles;
  const hasAppJsx = "App.jsx" in appFiles || "src/App.jsx" in appFiles;

  if (hasAppTsx || hasAppJsx) {
    return `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
  }

  // If no App file, look for any component that could be the main page
  const componentFiles = Object.keys(appFiles).filter(
    (f) => f.endsWith(".tsx") || f.endsWith(".jsx")
  );

  if (componentFiles.length > 0) {
    // Use the first component as the main page
    const mainFile = componentFiles[0];
    const componentName = mainFile
      .replace(/\.(tsx|jsx)$/, "")
      .split("/")
      .pop() || "App";
    const importPath = mainFile.startsWith("src/") ? `./${mainFile.replace("src/", "")}` : `./${mainFile}`;

    return `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import ${componentName} from '${importPath}';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <${componentName} />
  </React.StrictMode>
);`;
  }

  // Fallback: create a minimal App
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return <div style={{ padding: 40, textAlign: 'center' }}><h1>My App</h1></div>;
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
}

// Generate src/index.css with Tailwind directives
function generateIndexCss(): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`;
}

// Generate public/index.html
function generateIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
}

vercelRouter.post("/deploy", async (c) => {
  const vercelToken = c.env.VERCEL_API_KEY;

  if (!vercelToken) {
    return c.json({ error: "Vercel API key not configured on the server" }, 500);
  }

  try {
    const { files, projectId } = await c.req.json();

    if (!files) {
      return c.json({ error: "Missing files" }, 400);
    }

    // Look up the human-readable project name so Vercel project names look
    // like "my-coffee-shop-abc12345" instead of "lovable-abc12345".
    const userId = c.get("userId");
    let projectSlug = "";
    if (projectId && userId) {
      try {
        const raw = await c.env.KV_METADATA.get(`user:${userId}:project:${projectId}`);
        if (raw) {
          const meta = JSON.parse(raw) as { name?: string };
          if (meta.name) {
            projectSlug = meta.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 40);
          }
        }
      } catch { /* fall through to default */ }
    }
    const idTail = projectId ? String(projectId).slice(0, 8) : "app";
    let vercelProjectName = (projectSlug ? `${projectSlug}-${idTail}` : `lovable-${idTail}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52); // Vercel project name max ≈ 100, keep headroom

    // Identity persistence: the v13 deployments API routes a deploy to a Vercel
    // project by `name`, creating one if it doesn't exist. If the user renames
    // the project the computed name changes and Vercel would spin up a SECOND
    // project (a duplicate, orphaning the first + its production domain). So on
    // the first successful deploy we remember the project name we used, and on
    // every later deploy we reuse it regardless of the current display name.
    const vercelKey =
      projectId && userId ? `project:${projectId}:vercel_project_id` : null;
    let reusedVercelProject = false;
    if (vercelKey) {
      try {
        const savedName = await c.env.KV_METADATA.get(vercelKey);
        if (savedName) {
          vercelProjectName = savedName;
          reusedVercelProject = true;
        }
      } catch { /* fall through with the freshly computed name */ }
    }

    const projectFiles = files as Record<string, string>;
    const vercelFiles: Array<{ file: string; data: string }> = [];

    // Normalize all file paths (strip leading slashes)
    for (const [filePath, content] of Object.entries(projectFiles)) {
      const cleanPath = filePath.startsWith("/") ? filePath.substring(1) : filePath;
      vercelFiles.push({
        file: cleanPath,
        data: content as string,
      });
    }

    // --- Detect framework from incoming package.json ---
    // The default project (worker/src/ai/default-project.ts) ships a Vite
    // package.json. Trying to build a Vite project with framework:create-react-app
    // makes Vercel run `vite build`, which then can't find `index.html` at the
    // project root (Vite's entry) and dies in 10ms. So detect Vite up front.
    let framework: "vite" | "create-react-app" = "create-react-app";
    let viteEntry = "/src/index.tsx";
    const incomingPkgFile = vercelFiles.find((f) => f.file === "package.json");
    if (incomingPkgFile) {
      try {
        const pkg = JSON.parse(incomingPkgFile.data) as {
          scripts?: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const buildScript = pkg.scripts?.build ?? "";
        const hasViteDep = !!(pkg.devDependencies?.vite ?? pkg.dependencies?.vite);
        if (/\bvite\b/.test(buildScript) || hasViteDep) {
          framework = "vite";
          // Vite resolves its entry through the script tag in index.html, so we
          // just need to know which file to point at. Honor whichever entry
          // file actually exists in the bundle.
          const candidates = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx"];
          const found = candidates.find((p) => vercelFiles.some((f) => f.file === p));
          if (found) viteEntry = `/${found}`;
        }
      } catch { /* fall through with CRA default */ }
    }

    if (framework === "vite") {
      // 1. index.html at ROOT (Vite's required build entry).
      const hasRootIndexHtml = vercelFiles.some((f) => f.file === "index.html");
      if (!hasRootIndexHtml) {
        const publicHtml = vercelFiles.find((f) => f.file === "public/index.html");
        let html: string;
        if (publicHtml) {
          // Reuse the project's index.html (keeps custom <title>, fonts, etc.)
          // and inject the module entry script before </body>.
          html = publicHtml.data;
          if (!/<script[^>]+type=["']module["']/i.test(html)) {
            const scriptTag = `    <script type="module" src="${viteEntry}"></script>\n  </body>`;
            if (/<\/body>/i.test(html)) {
              html = html.replace(/<\/body>/i, scriptTag);
            } else {
              html += `\n${scriptTag}\n</html>`;
            }
          }
        } else {
          html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${viteEntry}"></script>
  </body>
</html>`;
        }
        vercelFiles.push({ file: "index.html", data: html });
      }

      // 2. vite.config.ts with the React plugin.
      const hasViteConfig = vercelFiles.some((f) =>
        /^vite\.config\.(ts|js|mjs|mts|cjs)$/.test(f.file),
      );
      if (!hasViteConfig) {
        vercelFiles.push({
          file: "vite.config.ts",
          data: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`,
        });
      }

      // 3. tsconfig.json — Vite-style (bundler module resolution, no emit).
      const hasTsConfig = vercelFiles.some((f) => f.file === "tsconfig.json");
      if (!hasTsConfig) {
        vercelFiles.push({
          file: "tsconfig.json",
          data: JSON.stringify(
            {
              compilerOptions: {
                target: "ES2020",
                useDefineForClassFields: true,
                lib: ["ES2020", "DOM", "DOM.Iterable"],
                module: "ESNext",
                skipLibCheck: true,
                moduleResolution: "bundler",
                allowImportingTsExtensions: true,
                resolveJsonModule: true,
                isolatedModules: true,
                noEmit: true,
                jsx: "react-jsx",
                strict: false,
                allowSyntheticDefaultImports: true,
                esModuleInterop: true,
              },
              include: ["src"],
            },
            null,
            2,
          ),
        });
      }

      // Skip CRA scaffolding entirely — Vite path is complete.
    } else {

    // --- Scaffold: ensure CRA can build this project ---

    // 1. package.json
    const hasPackageJson = vercelFiles.some((f) => f.file === "package.json");
    if (!hasPackageJson) {
      // Detect extra dependencies from imports in the generated code
      const allCode = Object.values(projectFiles).join("\n");
      const extraDeps: Record<string, string> = {};

      // Common packages the AI might use
      if (allCode.includes("framer-motion")) extraDeps["framer-motion"] = "^10.16.0";
      if (allCode.includes("@headlessui")) extraDeps["@headlessui/react"] = "^1.7.17";
      if (allCode.includes("react-icons/")) extraDeps["react-icons"] = "^4.12.0";
      if (allCode.includes("date-fns")) extraDeps["date-fns"] = "^3.0.0";
      if (allCode.includes("sonner")) extraDeps["sonner"] = "^1.3.0";

      vercelFiles.push({
        file: "package.json",
        data: JSON.stringify(
          {
            name: vercelProjectName,
            version: "1.0.0",
            private: true,
            scripts: {
              start: "react-scripts start",
              build: "react-scripts build",
              test: "react-scripts test",
              eject: "react-scripts eject",
            },
            dependencies: {
              ...DEFAULT_DEPENDENCIES,
              ...extraDeps,
            },
            browserslist: BROWSERSLIST,
          },
          null,
          2
        ),
      });
    }

    // 2. public/index.html
    const hasIndexHtml = vercelFiles.some((f) => f.file === "public/index.html");
    if (!hasIndexHtml) {
      vercelFiles.push({
        file: "public/index.html",
        data: generateIndexHtml("My App"),
      });
    }

    // 3. src/index.tsx — CRA entry point
    const hasIndexTsx = vercelFiles.some(
      (f) => f.file === "src/index.tsx" || f.file === "src/index.jsx"
    );
    if (!hasIndexTsx) {
      vercelFiles.push({
        file: "src/index.tsx",
        data: generateIndexTsx(projectFiles),
      });
    }

    // 4. src/index.css — Tailwind directives
    const hasIndexCss = vercelFiles.some((f) => f.file === "src/index.css");
    if (!hasIndexCss) {
      vercelFiles.push({
        file: "src/index.css",
        data: generateIndexCss(),
      });
    }

    // 5. tsconfig.json — TypeScript config for CRA
    const hasTsConfig = vercelFiles.some((f) => f.file === "tsconfig.json");
    if (!hasTsConfig) {
      vercelFiles.push({
        file: "tsconfig.json",
        data: JSON.stringify(
          {
            compilerOptions: {
              target: "es5",
              lib: ["dom", "dom.iterable", "esnext"],
              allowJs: true,
              skipLibCheck: true,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              strict: true,
              forceConsistentCasingInFileNames: true,
              noFallthroughCasesInSwitch: true,
              module: "esnext",
              moduleResolution: "node",
              resolveJsonModule: true,
              isolatedModules: true,
              noEmit: true,
              jsx: "react-jsx",
            },
            include: ["src"],
          },
          null,
          2
        ),
      });
    }

    // 6. If there's no App.tsx but there are component files, wrap them
    const hasAppFile = vercelFiles.some(
      (f) =>
        f.file === "src/App.tsx" ||
        f.file === "src/App.jsx" ||
        f.file === "App.tsx" ||
        f.file === "App.jsx"
    );

    if (!hasAppFile) {
      // Find all component files
      const componentFiles = vercelFiles
        .filter(
          (f) =>
            (f.file.endsWith(".tsx") || f.file.endsWith(".jsx")) &&
            f.file !== "src/index.tsx" &&
            f.file !== "src/index.jsx"
        )
        .map((f) => f.file);

      if (componentFiles.length > 0) {
        // Build imports for all component files
        const imports = componentFiles
          .map((f) => {
            const name = f.replace(/\.(tsx|jsx)$/, "").split("/").pop() || "Component";
            const path = f.startsWith("src/") ? `./${f.replace("src/", "")}` : `./${f}`;
            return `import ${name} from '${path}';`;
          })
          .join("\n");

        const firstComponent = componentFiles[0]
          .replace(/\.(tsx|jsx)$/, "")
          .split("/")
          .pop() || "Component";

        const appCode = `import React from 'react';
${imports}

export default function App() {
  return (
    <div>
      <${firstComponent} />
    </div>
  );
}`;

        vercelFiles.push({
          file: "src/App.tsx",
          data: appCode,
        });
      }
    }
    } // end of else (CRA scaffold branch)

    // Build env object if Supabase is linked.
    // CRA exposes REACT_APP_*; Vite exposes VITE_* — set both so client code
    // works regardless of which template the AI shipped.
    const kv = c.env.KV_METADATA;
    const supabaseLinkRaw = projectId
      ? await kv.get(`project:${projectId}:supabase`)
      : null;
    const deployEnv: Record<string, string> = {};
    if (supabaseLinkRaw) {
      const link: SupabaseLinkRecord = JSON.parse(supabaseLinkRaw);
      deployEnv.REACT_APP_SUPABASE_URL = link.restUrl;
      deployEnv.REACT_APP_SUPABASE_ANON_KEY = link.anonKey;
      deployEnv.VITE_SUPABASE_URL = link.restUrl;
      deployEnv.VITE_SUPABASE_ANON_KEY = link.anonKey;
    }

    // Deploy to Vercel using the v13 deployments API.
    // target:"production" promotes this deployment to production, which
    // aliases it to the project's stable hostname (e.g. {project}.vercel.app)
    // instead of leaving it on a per-deploy hash subdomain.
    const deployRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: vercelProjectName,
        target: "production",
        files: vercelFiles.map((f) => ({
          file: f.file,
          data: f.data,
        })),
        projectSettings: {
          framework,
        },
        env: deployEnv,
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.text();
      console.error("Vercel deploy error:", err);
      return c.json({ error: `Vercel deployment failed: ${err.substring(0, 200)}` }, 500);
    }

    type DeploymentState = {
      url: string;
      id: string;
      readyState: string;
      alias?: string[];
      aliasAssigned?: number | boolean;
    };
    let state = (await deployRes.json()) as DeploymentState;

    // The deploy POST was accepted, so the Vercel project named
    // `vercelProjectName` now exists. Pin it to this project so future deploys
    // (even after a rename) target the same project instead of duplicating.
    // Best-effort: a KV failure must not break an otherwise-successful deploy.
    if (vercelKey && !reusedVercelProject) {
      try {
        await kv.put(vercelKey, vercelProjectName);
      } catch (e) {
        console.error("Failed to persist vercel_project_id key:", e);
      }
    }

    // Poll until the deployment finishes building. We cannot return the URL
    // before READY because (a) the per-deploy URL serves a Vercel "deploying"
    // page during build, and (b) the production alias does not resolve at all
    // until READY — it returns DEPLOYMENT_NOT_FOUND, which is exactly the 404
    // Mario was seeing in the browser.
    const TERMINAL = new Set(["READY", "ERROR", "CANCELED"]);
    const POLL_INTERVAL_MS = 3000;
    const MAX_ATTEMPTS = 60; // ~3 minutes upper bound for CRA builds
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !TERMINAL.has(state.readyState); attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollRes = await fetch(
        `https://api.vercel.com/v13/deployments/${state.id}`,
        { headers: { Authorization: `Bearer ${vercelToken}` } },
      );
      if (pollRes.ok) {
        state = (await pollRes.json()) as DeploymentState;
      }
    }

    if (state.readyState === "ERROR") {
      // Pull the build error so the UI can show something useful.
      let buildError = "Build failed";
      try {
        const eventsRes = await fetch(
          `https://api.vercel.com/v3/deployments/${state.id}/events?builds=1&direction=backward&limit=20`,
          { headers: { Authorization: `Bearer ${vercelToken}` } },
        );
        if (eventsRes.ok) {
          const events = (await eventsRes.json()) as Array<{ text?: string; type?: string }>;
          const errLine = events.reverse().find(
            (e) => e?.type === "stderr" || (e?.text && /error/i.test(e.text)),
          );
          if (errLine?.text) buildError = errLine.text.slice(0, 400);
        }
      } catch { /* fall through with generic message */ }
      return c.json({ error: `Vercel build failed: ${buildError}`, deploymentId: state.id }, 500);
    }

    if (!TERMINAL.has(state.readyState)) {
      // Build is still queued/building after 3 minutes — return what we have
      // so the user at least gets the per-deploy URL (which serves a Vercel
      // progress page) instead of a stale alias that 404s.
      return c.json({
        success: true,
        deploymentUrl: `https://${state.url}`,
        previewUrl: `https://${state.url}`,
        aliases: [],
        deploymentId: state.id,
        vercelProjectName,
        reusedExisting: reusedVercelProject,
        status: state.readyState,
        warning: "Deployment still building after 3 minutes — returning per-deploy URL. Production alias will catch up when build completes.",
      });
    }

    // READY — production alias is now live. Pick the cleanest one.
    const aliases = Array.isArray(state.alias) ? state.alias : [];
    const productionAlias = aliases
      .filter((a) => typeof a === "string" && a.endsWith(".vercel.app"))
      .sort((a, b) => a.length - b.length)[0];
    const cleanUrl = productionAlias ? `https://${productionAlias}` : `https://${state.url}`;

    return c.json({
      success: true,
      deploymentUrl: cleanUrl,
      previewUrl: `https://${state.url}`,
      aliases: aliases.map((a) => `https://${a}`),
      deploymentId: state.id,
      vercelProjectName,
      reusedExisting: reusedVercelProject,
      status: state.readyState,
    });
  } catch (error) {
    console.error("Vercel deploy error:", error);
    const msg = error instanceof Error ? error.message : "Failed to deploy to Vercel";
    return c.json({ error: msg }, 500);
  }
});

export default vercelRouter;
