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
    const vercelProjectName = (projectSlug ? `${projectSlug}-${idTail}` : `lovable-${idTail}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52); // Vercel project name max ≈ 100, keep headroom

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

    // Build env array if Supabase is linked (mirrors github.ts:65-71 pattern).
    // CRA only exposes REACT_APP_* prefixed vars to the bundle at build time.
    const kv = c.env.KV_METADATA;
    const supabaseLinkRaw = projectId
      ? await kv.get(`project:${projectId}:supabase`)
      : null;
    const deployEnv: Array<{ key: string; value: string; type: string; target: string[] }> = [];
    if (supabaseLinkRaw) {
      const link: SupabaseLinkRecord = JSON.parse(supabaseLinkRaw);
      deployEnv.push(
        { key: "REACT_APP_SUPABASE_URL", value: link.restUrl, type: "plain", target: ["production", "preview"] },
        { key: "REACT_APP_SUPABASE_ANON_KEY", value: link.anonKey, type: "plain", target: ["production", "preview"] },
      );
    }

    // Deploy to Vercel using the v13 deployments API
    const deployRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: vercelProjectName,
        files: vercelFiles.map((f) => ({
          file: f.file,
          data: f.data,
        })),
        projectSettings: {
          framework: "create-react-app",
        },
        ...(deployEnv.length > 0 ? { env: deployEnv } : {}),
      }),
    });

    if (!deployRes.ok) {
      const err = await deployRes.text();
      console.error("Vercel deploy error:", err);
      return c.json({ error: `Vercel deployment failed: ${err.substring(0, 200)}` }, 500);
    }

    const deployData = (await deployRes.json()) as { url: string; id: string; readyState: string };

    return c.json({
      success: true,
      deploymentUrl: `https://${deployData.url}`,
      deploymentId: deployData.id,
      status: deployData.readyState,
    });
  } catch (error) {
    console.error("Vercel deploy error:", error);
    return c.json({ error: "Failed to deploy to Vercel" }, 500);
  }
});

export default vercelRouter;
