/**
 * Regression test for Sandpack image-asset inlining on imported repos.
 * Run:  node --experimental-strip-types qa/test-sandpack-assets.ts
 *
 * The import stores rasters as data: URIs and SVGs as text; the preview must
 * rewrite every image reference (ES import, CSS url(), literal /public path)
 * to a data URI and drop the raw raster files (Sandpack can't treat a binary
 * as a module). Each fixture is the ALREADY-FLATTENED prepared file map (post
 * /src/ strip) plus the project's alias table, mirroring preview-panel.
 */
import assert from "node:assert";
import { inlineAssets, svgToDataUri } from "../lib/sandpack-assets.ts";
import { collectAliases } from "../lib/sandpack-alias.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

let passed = 0;
function ok(name: string, cond: boolean, msg?: string) {
  assert.ok(cond, `[${name}] ${msg ?? "failed"}`);
}

// ── A: relative raster import → const data URI, raster file dropped ───────────
{
  const aliases = collectAliases({
    "/tsconfig.json": `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}`,
  });
  const out = inlineAssets(
    {
      "/App.tsx": `import logo from "./assets/logo.png";\nexport default () => <img src={logo} />;`,
      "/assets/logo.png": PNG,
    },
    aliases,
  );
  ok("A", !("/assets/logo.png" in out), "raster file should be dropped");
  ok("A", /const logo = "data:image\/png;base64,/.test(out["/App.tsx"]), "import not inlined to const");
  ok("A", !/import\s+logo/.test(out["/App.tsx"]), "import statement should be gone");
  console.log("  ok  A: relative raster import");
  passed++;
}

// ── B: aliased raster import (@/) ────────────────────────────────────────────
{
  const aliases = collectAliases({
    "/tsconfig.json": `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}`,
  });
  const out = inlineAssets(
    {
      "/App.tsx": `import hero from "@/assets/hero.jpg";\nexport default () => <img src={hero} />;`,
      "/assets/hero.jpg": "data:image/jpeg;base64,/9j/AAAA",
    },
    aliases,
  );
  ok("B", /const hero = "data:image\/jpeg;base64,/.test(out["/App.tsx"]), "alias raster not inlined");
  ok("B", !("/assets/hero.jpg" in out), "raster file should be dropped");
  console.log("  ok  B: aliased raster import");
  passed++;
}

// ── C: svg URL import → data:image/svg+xml; svg text file kept ────────────────
{
  const out = inlineAssets(
    {
      "/App.tsx": `import react from "./react.svg";\nexport default () => <img src={react} />;`,
      "/react.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect fill="#61dafb" width="2" height="2"/></svg>`,
    },
    [],
  );
  ok("C", /const react = "data:image\/svg\+xml,/.test(out["/App.tsx"]), "svg import not inlined");
  ok("C", "/react.svg" in out, "svg text file should be kept (safe / svgr)");
  console.log("  ok  C: svg URL import");
  passed++;
}

// ── D: literal /public path in JSX + index.html ──────────────────────────────
{
  const out = inlineAssets(
    {
      "/App.tsx": `export default () => <img src="/vite.svg" alt="logo" />;`,
      "/public/vite.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>`,
    },
    [],
  );
  ok("D", /src="data:image\/svg\+xml,/.test(out["/App.tsx"]), "literal /public ref not inlined");
  console.log("  ok  D: literal /public path");
  passed++;
}

// ── E: CSS url() ─────────────────────────────────────────────────────────────
{
  const out = inlineAssets(
    {
      "/styles.css": `.bg{ background: url("./assets/bg.png") no-repeat; }`,
      "/assets/bg.png": PNG,
    },
    [],
  );
  ok("E", /url\("data:image\/png;base64,/.test(out["/styles.css"]), "css url() not inlined");
  console.log("  ok  E: css url()");
  passed++;
}

// ── F: svgr component import (?react) must be left untouched ──────────────────
{
  const out = inlineAssets(
    {
      "/App.tsx": `import Logo from "./logo.svg?react";\nexport default () => <Logo />;`,
      "/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>`,
    },
    [],
  );
  ok("F", /import Logo from "\.\/logo\.svg\?react"/.test(out["/App.tsx"]), "svgr import wrongly rewritten");
  console.log("  ok  F: svgr ?react import preserved");
  passed++;
}

// ── G: code imports are NOT mistaken for assets ──────────────────────────────
{
  const aliases = collectAliases({
    "/tsconfig.json": `{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}`,
  });
  const src = `import { Button } from "@/components/ui/button";\nimport { cn } from "@/lib/utils";\nexport default () => <Button/>;`;
  const out = inlineAssets(
    { "/App.tsx": src, "/components/ui/button.tsx": `export const Button=()=>null;`, "/assets/x.png": PNG },
    aliases,
  );
  ok("G", out["/App.tsx"] === src, "code imports must be left exactly as-is");
  console.log("  ok  G: code imports untouched");
  passed++;
}

// ── H: no-op when project has no images ──────────────────────────────────────
{
  const files = { "/App.tsx": `export default () => null;` };
  ok("H", inlineAssets(files, []) === files, "should return input unchanged when no assets");
  console.log("  ok  H: no-op without images");
  passed++;
}

// ── svgToDataUri sanity: unicode + quotes survive, no raw double-quote ────────
{
  const uri = svgToDataUri(`<svg><text>café "x"</text></svg>`);
  ok("svg", uri.startsWith("data:image/svg+xml,"), "wrong prefix");
  ok("svg", !/"/.test(uri.slice("data:image/svg+xml,".length)), "raw quote would break embedding");
  console.log("  ok  svgToDataUri robustness");
  passed++;
}

console.log(`\nAll ${passed} sandpack-assets checks passed.`);
