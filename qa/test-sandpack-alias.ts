/**
 * Regression test for Sandpack path-alias resolution on imported repos.
 * Run:  node --experimental-strip-types qa/test-sandpack-alias.ts
 *
 * Guards the #1 thing that breaks when importing a real GitHub repo into the
 * builder: a Vite path alias (@/, ~/, or custom) that Sandpack's static bundler
 * can't resolve. For each fixture project we replicate the preview's file prep
 * (strip /src/, skip entry/config files), inject the synthesized tsconfig, and
 * assert EVERY aliased import lands on a file that actually exists in the
 * flattened Sandpack file set. If any alias resolves to a missing file, the
 * real preview would throw "module not found" — and this test fails.
 */
import assert from "node:assert";
import {
  collectAliases,
  buildInjectedTsconfig,
  resolveAliasSpecifier,
  parseJsonc,
} from "../lib/sandpack-alias.ts";

type Files = Record<string, string>;

// --- replicate the relevant parts of prepareFilesForSandpack (flatten + skip) ---
const SKIP = new Set([
  "/public/index.html",
  "/package.json",
  "/src/index.tsx",
  "/src/main.tsx",
  "/src/index.ts",
  "/src/main.ts",
  "/src/styles.css",
  "/src/index.css",
  "/index.tsx",
  "/main.tsx",
  "/index.ts",
  "/main.ts",
]);

function flatten(files: Files): Files {
  const out: Files = {};
  for (const [p, c] of Object.entries(files)) {
    if (SKIP.has(p)) continue;
    const sp = p.startsWith("/src/") ? "/" + p.slice(5) : p;
    out[sp] = c;
  }
  return out;
}

function importSpecifiers(code: string): string[] {
  const re = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

function fileExists(prepared: Files, abs: string): boolean {
  if (prepared[abs] !== undefined) return true;
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", ".css", ".json", ".svg"];
  for (const e of exts) if (prepared[abs + e] !== undefined) return true;
  for (const e of [".tsx", ".ts", ".jsx", ".js"]) {
    if (prepared[abs + "/index" + e] !== undefined) return true;
  }
  return false;
}

let passed = 0;
function check(name: string, files: Files) {
  const prepared = flatten(files);
  prepared["/tsconfig.json"] = buildInjectedTsconfig(files);
  const aliases = collectAliases(files);

  // The injected tsconfig MUST carry baseUrl — sandpack-core drops paths without it.
  const injected = JSON.parse(prepared["/tsconfig.json"]);
  assert.strictEqual(
    injected.compilerOptions.baseUrl,
    ".",
    `[${name}] injected tsconfig missing baseUrl`,
  );

  let aliasImports = 0;
  for (const [path, content] of Object.entries(prepared)) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    for (const spec of importSpecifiers(content)) {
      const resolved = resolveAliasSpecifier(spec, aliases);
      if (resolved === null) continue; // relative or bare package
      aliasImports++;
      assert.ok(
        fileExists(prepared, resolved),
        `[${name}] alias import "${spec}" in ${path} resolved to ${resolved} but no such file exists`,
      );
    }
  }
  assert.ok(aliasImports > 0, `[${name}] expected at least one alias import to exercise`);
  console.log(`  ok  ${name}  (${aliasImports} aliased imports resolved)`);
  passed++;
}

// ── Fixture A: standard shadcn-vite, "@/" → ./src/*, baseUrl "." ───────────────
check("A: @/ alias (baseUrl '.', ./src/*)", {
  "/tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }`,
  "/src/App.tsx": `import { Badge } from "@/components/ui/badge";\nimport { CountBtn } from "@/components/count-btn";\nimport logo from "@/assets/react.svg";\nexport default function App(){return <CountBtn/>}`,
  "/src/components/count-btn.tsx": `import { Button } from "@/components/ui/button";\nexport function CountBtn(){return <Button/>}`,
  "/src/components/ui/button.tsx": `import { cn } from "@/lib/utils";\nexport function Button(){return null}`,
  "/src/components/ui/badge.tsx": `import { cn } from "@/lib/utils";\nexport function Badge(){return null}`,
  "/src/lib/utils.ts": `export function cn(){}`,
  "/src/assets/react.svg": `<svg/>`,
});

// ── Fixture B: "~/" alias (the dan5py/react-vite-shadcn-ui shape) ──────────────
check("B: ~/ alias (split tsconfig.app.json)", {
  "/tsconfig.json": `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }`,
  "/tsconfig.app.json": `{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } }, "include": ["src"] }`,
  "/src/App.tsx": `import { Badge } from "~/components/ui/badge";\nimport { CountBtn } from "~/components/count-btn";\nexport default function App(){return <CountBtn/>}`,
  "/src/components/count-btn.tsx": `import { Button } from "~/components/ui/button";\nexport function CountBtn(){return <Button/>}`,
  "/src/components/ui/button.tsx": `import { cn } from "~/lib/utils";\nexport function Button(){return null}`,
  "/src/components/ui/badge.tsx": `import { cn } from "~/lib/utils";\nexport function Badge(){return null}`,
  "/src/lib/utils.ts": `export function cn(){}`,
});

// ── Fixture C: custom sub-dir alias "@ui/*" → ./src/components/ui/* ────────────
check("C: custom sub-dir alias @ui/*", {
  "/tsconfig.json": `{
    // a comment + trailing comma to exercise the JSONC parser
    "compilerOptions": {
      "baseUrl": ".",
      "paths": {
        "@/*": ["./src/*"],
        "@ui/*": ["./src/components/ui/*"],
      },
    },
  }`,
  "/src/App.tsx": `import { Button } from "@ui/button";\nimport { cn } from "@/lib/utils";\nexport default function App(){return <Button/>}`,
  "/src/components/ui/button.tsx": `export function Button(){return null}`,
  "/src/lib/utils.ts": `export function cn(){}`,
});

// ── Fixture D: alias only in vite.config.ts (no tsconfig paths) → default kicks in
check("D: vite-only alias, relies on @/ default", {
  "/tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
  "/vite.config.ts": `export default { resolve: { alias: { "@": "/src" } } }`,
  "/src/App.tsx": `import { cn } from "@/lib/utils";\nexport default function App(){return null}`,
  "/src/lib/utils.ts": `export function cn(){}`,
});

// ── Parser robustness ─────────────────────────────────────────────────────────
assert.deepStrictEqual(
  parseJsonc(`{ "a": 1, /* c */ "b": "http://x//y", } // tail`),
  { a: 1, b: "http://x//y" },
  "parseJsonc should strip comments/trailing commas and preserve :// in strings",
);
console.log(`  ok  parseJsonc robustness`);
passed++;

console.log(`\nAll ${passed} sandpack-alias checks passed.`);
