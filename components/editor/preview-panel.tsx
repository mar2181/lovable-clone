"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Laptop, Smartphone, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
} from "@codesandbox/sandpack-react";
import { atomDark } from "@codesandbox/sandpack-themes";

interface PreviewPanelProps {
  files: Record<string, string>;
  dependencies?: Record<string, string>;
}

// Clean HTML template — Tailwind is loaded via Sandpack's externalResources, NOT here
const SANDPACK_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

const DEFAULT_APP_CODE = `export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827', marginBottom: '0.5rem' }}>Preview Ready</h1>
        <p style={{ color: '#6b7280' }}>Describe your app in the chat to get started.</p>
      </div>
    </div>
  );
}`;

// Icons that DO NOT exist in lucide-react but AI models keep trying to use
const FORBIDDEN_ICONS = [
  "Facebook", "Instagram", "Twitter", "Linkedin", "Youtube", "Github",
  "Dribbble", "Figma", "Slack", "Discord", "TikTok", "Pinterest",
  "Snapchat", "WhatsApp", "Telegram", "Reddit", "Medium", "Twitch",
  "Spotify", "LinkedIn", "YouTube", "GitHub",
];

function sanitizeIcons(code: string): string {
  // Step 1: Clean up forbidden icon imports and replace with Globe
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g,
    (_match: string, imports: string) => {
      const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
      const cleaned = iconList.filter((icon: string) => !FORBIDDEN_ICONS.includes(icon));
      const hadForbidden = cleaned.length < iconList.length;
      if (hadForbidden && !cleaned.includes("Globe")) cleaned.push("Globe");
      if (cleaned.length === 0) return `import { Globe } from 'lucide-react'`;
      return `import { ${cleaned.join(", ")} } from 'lucide-react'`;
    }
  );

  // Step 2: Replace forbidden icon JSX usage with Globe
  for (const icon of FORBIDDEN_ICONS) {
    code = code.replace(new RegExp(`<${icon}(\\s[^>]*?)\\s*\\/>`, "g"), `<Globe$1 />`);
    code = code.replace(new RegExp(`<${icon}(\\s[^>]*)?>`, "g"), `<Globe$1>`);
    code = code.replace(new RegExp(`<\\/${icon}>`, "g"), `</Globe>`);
  }

  // Step 3: Replace react-icons and heroicons with lucide Globe
  code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]react-icons\/[^'"]+['"]\s*;?/g, `import { Globe } from 'lucide-react';`);
  code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]@heroicons\/[^'"]+['"]\s*;?/g, `import { Globe } from 'lucide-react';`);

  // Step 4: Auto-fix missing lucide-react icon imports
  const existingImportMatch = code.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/);
  const importedIcons = new Set<string>();
  if (existingImportMatch) {
    existingImportMatch[1].split(",").map(s => s.trim()).filter(Boolean).forEach(icon => importedIcons.add(icon));
  }

  // Collect locally declared names
  const localDeclarations = new Set<string>();
  const declRegex = /(?:const|let|var|function|class)\s+([A-Z][a-zA-Z0-9]*)/g;
  let declMatch;
  while ((declMatch = declRegex.exec(code)) !== null) {
    localDeclarations.add(declMatch[1]);
  }
  const exportDeclRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+([A-Z][a-zA-Z0-9]*)/g;
  while ((declMatch = exportDeclRegex.exec(code)) !== null) {
    localDeclarations.add(declMatch[1]);
  }

  // Collect all names imported from ANY module
  const allImportedNames = new Set<string>();
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
  let impMatch;
  while ((impMatch = importRegex.exec(code)) !== null) {
    impMatch[1].split(",").map(s => s.trim()).filter(Boolean).forEach(name => {
      const parts = name.split(/\s+as\s+/);
      allImportedNames.add(parts[parts.length - 1].trim());
    });
  }

  // Find PascalCase names used as JSX self-closing: <Name ... />
  const jsxIconUsages = new Set<string>();
  const jsxRegex = /<([A-Z][a-zA-Z0-9]+)\s[^>]*?\/>/g;
  let jsxMatch;
  while ((jsxMatch = jsxRegex.exec(code)) !== null) {
    const name = jsxMatch[1];
    if (
      !importedIcons.has(name) &&
      !localDeclarations.has(name) &&
      !allImportedNames.has(name) &&
      !FORBIDDEN_ICONS.includes(name)
    ) {
      jsxIconUsages.add(name);
    }
  }

  // Add missing icons to the lucide-react import
  if (jsxIconUsages.size > 0 && existingImportMatch) {
    const allIcons = [...importedIcons, ...jsxIconUsages];
    const newImport = `import { ${allIcons.join(", ")} } from 'lucide-react'`;
    code = code.replace(/import\s*\{[^}]+\}\s*from\s*['"]lucide-react['"]/, newImport);
  } else if (jsxIconUsages.size > 0 && !existingImportMatch) {
    const newImport = `import { ${[...jsxIconUsages].join(", ")} } from 'lucide-react';`;
    code = code.replace(/(import\s+.+\n)/, `$1${newImport}\n`);
  }

  return code;
}

/**
 * Prepare files for Sandpack's react-ts template.
 * Strips /src/ prefix since Sandpack uses flat paths (/App.tsx not /src/App.tsx).
 */
function prepareFilesForSandpack(files: Record<string, string>): Record<string, string> {
  const prepared: Record<string, string> = {};

  const SKIP_PATHS = new Set([
    "/public/index.html",
    "/package.json",
    "/src/index.tsx", "/src/main.tsx",
    "/src/index.ts", "/src/main.ts",
    "/src/styles.css", "/src/index.css",
    "/index.tsx", "/main.tsx", "/index.ts", "/main.ts",
  ]);

  for (const [path, content] of Object.entries(files)) {
    if (SKIP_PATHS.has(path)) continue;

    let sandpackPath = path;
    if (path.startsWith("/src/")) {
      sandpackPath = "/" + path.slice(5);
    }

    if (sandpackPath.match(/\.(tsx?|jsx?|js)$/)) {
      prepared[sandpackPath] = sanitizeIcons(content);
    } else {
      prepared[sandpackPath] = content;
    }
  }

  if (!prepared["/App.tsx"] && !prepared["/App.jsx"] && !prepared["/App.js"]) {
    prepared["/App.tsx"] = DEFAULT_APP_CODE;
  }

  return prepared;
}

export function PreviewPanel({ files, dependencies = {} }: PreviewPanelProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [key, setKey] = useState(0);

  const handleRefresh = () => {
    setKey(prev => prev + 1);
  };

  const filesFingerprint = useMemo(() => {
    const appContent = files["/src/App.tsx"] || files["/App.tsx"] || "";
    return appContent.length.toString() + "_" + Object.keys(files).length.toString();
  }, [files]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setKey(prev => prev + 1);
    }, 800);
    return () => clearTimeout(timer);
  }, [filesFingerprint]);

  const sandpackFiles = Object.keys(files).length > 0
    ? prepareFilesForSandpack(files)
    : { "/App.tsx": DEFAULT_APP_CODE };

  const activeFiles: Record<string, string> = {
    "/public/index.html": SANDPACK_INDEX_HTML,
    ...sandpackFiles,
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="h-12 border-b border-white/5 bg-zinc-950/50 flex items-center justify-between px-4 shrink-0 z-20 relative">
        <div className="flex bg-zinc-900 rounded-lg p-1 border border-white/5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDevice("desktop")}
            className={cn(
              "h-7 px-3 text-xs rounded-md",
              device === "desktop"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <Laptop className="w-3.5 h-3.5 mr-1.5" />
            Desktop
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDevice("mobile")}
            className={cn(
              "h-7 px-3 text-xs rounded-md",
              device === "mobile"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
            )}
          >
            <Smartphone className="w-3.5 h-3.5 mr-1.5" />
            Mobile
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-white"
            onClick={handleRefresh}
            title="Force refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white">
            <ExternalLink className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Force Sandpack internals to fill 100% height */}
      <style dangerouslySetInnerHTML={{ __html: `
        .sp-wrapper { height: 100% !important; }
        .sp-layout { height: 100% !important; border: none !important; }
        .sp-preview { height: 100% !important; }
        .sp-preview-container { height: 100% !important; }
        .sp-preview iframe { height: 100% !important; }
      ` }} />

      <div className={cn(
        "flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden relative",
        device === "desktop" ? "p-0" : "p-4 sm:p-8 overflow-auto"
      )}>
        {device !== "desktop" && (
          <div
            className="absolute inset-0 z-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#4f4f5c 1px, transparent 1px)",
              backgroundSize: "20px 20px"
            }}
          />
        )}

        <div
          className={cn(
            "relative z-10 transition-all duration-300 ease-in-out overflow-hidden",
            device === "desktop"
              ? "w-full h-full"
              : "w-[375px] h-[812px] bg-white rounded-xl shadow-2xl ring-1 ring-white/10"
          )}
        >
          <SandpackProvider
            key={key}
            template="react-ts"
            theme={atomDark}
            files={activeFiles}
            customSetup={{
              dependencies: {
                "lucide-react": "latest",
                "react-router-dom": "^6.20.0",
                "date-fns": "latest",
                "framer-motion": "^10.16.0",
                ...dependencies
              }
            }}
            options={{
              externalResources: [
                "https://cdn.tailwindcss.com",
                "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
              ],
              classes: {
                "sp-wrapper": "custom-wrapper h-full",
                "sp-layout": "custom-layout h-full border-none bg-transparent",
                "sp-preview": "custom-preview h-full bg-white",
              }
            }}
          >
            <SandpackLayout className="h-full border-none overflow-hidden">
              <SandpackPreview
                showOpenInCodeSandbox={false}
                showRefreshButton={false}
                className="h-full bg-white text-black border-none"
              />
            </SandpackLayout>
          </SandpackProvider>
        </div>
      </div>
    </div>
  );
}
