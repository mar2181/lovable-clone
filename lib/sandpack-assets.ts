/**
 * Image-asset inlining for the Sandpack preview.
 *
 * WHY THIS EXISTS
 * ---------------
 * Sandpack's static `react-ts` bundler (`sandpack-core`) has no real asset
 * pipeline: it cannot turn `import logo from "./logo.png"` into a served URL
 * the way Vite/webpack do, and a raster file dropped into its filesystem is
 * not a valid module (it throws when something imports it). So imported repos
 * that use images render with broken `<img>`s — or fail outright.
 *
 * THE FIX
 * -------
 * The GitHub import now stores each raster image as a `data:` URI under its
 * real path (see worker/src/routes/github.ts), and SVGs arrive as text. Here we
 * rewrite every image REFERENCE in the source to that data URI, so the bundler
 * never has to resolve an asset module at all:
 *   - `import x from "./logo.png"`        -> `const x = "data:image/png;base64,…";`
 *   - `import x from "@/assets/logo.svg"` -> `const x = "data:image/svg+xml,…";`
 *   - CSS `url("./bg.png")`               -> `url("data:image/png;base64,…")`
 *   - literal `<img src="/vite.svg">`     -> `<img src="data:image/svg+xml,…">`
 * …resolving specifiers through the SAME relative + path-alias logic the preview
 * uses for code (see ./sandpack-alias). Raster files are then dropped from the
 * Sandpack file set (they can't be modules); SVG text files are left in place
 * (harmless, and keeps `?react`/ReactComponent svgr-style imports resolvable).
 *
 * Result: an imported project's images render in the preview in the same state
 * they're in in the repo, with no per-import manual fixup. Pure module (no
 * React/DOM) so it's unit-tested directly — see qa/test-sandpack-assets.ts.
 */

import {
  resolveAliasSpecifier,
  type AliasEntry,
} from "./sandpack-alias.ts";

// Image extensions we inline. Rasters arrive as data: URIs; svg arrives as text.
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/i;

function isDataUri(s: string): boolean {
  return typeof s === "string" && s.startsWith("data:");
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

// Resolve "." / ".." segments against a flat root, e.g. "/a/b/../c" -> "/a/c".
function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return "/" + out.join("/");
}

/**
 * Encode raw SVG markup as a `data:image/svg+xml,…` URI. URL-encoded (not
 * base64) so it survives unicode without `btoa`; quotes/`#`/`<`/`>` stay
 * percent-encoded (encodeURIComponent handles them) so the result is safe to
 * drop inside either quote style. Spaces/`=`/`:`/`/` are restored for size.
 */
export function svgToDataUri(svg: string): string {
  const cleaned = svg.replace(/[\r\n\t]+/g, " ").trim();
  const enc = encodeURIComponent(cleaned)
    .replace(/%20/g, " ")
    .replace(/%3D/g, "=")
    .replace(/%3A/g, ":")
    .replace(/%2F/g, "/");
  return "data:image/svg+xml," + enc;
}

// Flat path -> data URI for every inlinable image in the prepared file set.
function buildAssetMap(files: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [p, content] of Object.entries(files)) {
    if (!IMG_EXT.test(p)) continue;
    let uri: string | null = null;
    if (isDataUri(content)) uri = content;
    else if (/\.svg$/i.test(p)) uri = svgToDataUri(content);
    if (!uri) continue;
    m.set(p, uri);
    // Vite serves /public/* at the site root, so /public/vite.svg is also
    // reachable as /vite.svg. ("/public".length === 7)
    if (p.startsWith("/public/")) m.set(p.slice(7), uri);
  }
  return m;
}

/**
 * Resolve an image specifier (from a file at `fromPath`) to its data URI, or
 * null if it isn't an image / isn't a known asset. Handles relative (`./`,
 * `../`), root-absolute (`/…`, incl. /public), and path-alias (`@/…`) forms,
 * ignoring any `?query`/`#hash` suffix.
 */
export function resolveAsset(
  spec: string,
  fromPath: string,
  aliases: AliasEntry[],
  assetMap: Map<string, string>,
): string | null {
  if (/\?react\b/.test(spec)) return null; // vite-plugin-svgr: a component, not a URL
  const clean = spec.split(/[?#]/)[0];
  if (!IMG_EXT.test(clean)) return null;

  let target: string | null = null;
  if (clean.startsWith("./") || clean.startsWith("../")) {
    target = normalize(dirname(fromPath) + "/" + clean);
  } else if (clean.startsWith("/")) {
    target = normalize(clean);
  } else {
    target = resolveAliasSpecifier(clean, aliases); // flat path, or null
  }
  if (!target) return null;
  return assetMap.get(target) ?? assetMap.get("/public" + target) ?? null;
}

// Replace quoted literal image paths (e.g. <img src="/vite.svg">) with their
// data URI. Skips already-inlined / remote refs.
function rewriteLiterals(
  code: string,
  fromPath: string,
  aliases: AliasEntry[],
  assetMap: Map<string, string>,
): string {
  return code.replace(
    /(["'])((?:[^"'\\]|\\.)*?\.(?:png|jpe?g|gif|webp|avif|ico|bmp|svg)(?:\?[^"']*)?)\1/gi,
    (m: string, q: string, spec: string) => {
      if (/^(data:|https?:|\/\/)/i.test(spec)) return m;
      const uri = resolveAsset(spec, fromPath, aliases, assetMap);
      return uri ? q + uri + q : m;
    },
  );
}

function rewriteSource(
  code: string,
  fromPath: string,
  aliases: AliasEntry[],
  assetMap: Map<string, string>,
): string {
  // `import logo from "./logo.png"` -> `const logo = "data:…";`
  code = code.replace(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])([^"']+)\2\s*;?/g,
    (m: string, name: string, _q: string, spec: string) => {
      const uri = resolveAsset(spec, fromPath, aliases, assetMap);
      return uri ? `const ${name} = ${JSON.stringify(uri)};` : m;
    },
  );
  // Side-effect `import "./logo.png";` (rare) -> drop. Won't touch css/module imports.
  code = code.replace(
    /import\s*(["'])([^"']+)\1\s*;?/g,
    (m: string, _q: string, spec: string) => {
      return resolveAsset(spec, fromPath, aliases, assetMap) ? "" : m;
    },
  );
  return rewriteLiterals(code, fromPath, aliases, assetMap);
}

function rewriteCss(
  code: string,
  fromPath: string,
  aliases: AliasEntry[],
  assetMap: Map<string, string>,
): string {
  return code.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (m: string, _q: string, spec: string) => {
      if (/^(data:|https?:|\/\/)/i.test(spec)) return m;
      const uri = resolveAsset(spec, fromPath, aliases, assetMap);
      return uri ? `url("${uri}")` : m;
    },
  );
}

/**
 * Inline every image reference in `files` to a data URI and drop the raster
 * asset files (which can't be Sandpack modules). `files` must already be the
 * flattened, prepared map; `aliases` come from collectAliases(originalFiles).
 * No-op (returns the input) when the project has no inlinable images.
 */
export function inlineAssets(
  files: Record<string, string>,
  aliases: AliasEntry[],
): Record<string, string> {
  const assetMap = buildAssetMap(files);
  if (assetMap.size === 0) return files;

  const out: Record<string, string> = {};
  for (const [p, content] of Object.entries(files)) {
    if (IMG_EXT.test(p)) {
      // Raster (data: URI) files are not valid modules — drop them now that
      // their references are inlined. SVG text files are safe to keep.
      if (isDataUri(content)) continue;
      out[p] = content;
      continue;
    }
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(p)) {
      out[p] = rewriteSource(content, p, aliases, assetMap);
    } else if (/\.css$/.test(p)) {
      out[p] = rewriteCss(content, p, aliases, assetMap);
    } else if (/\.html?$/.test(p)) {
      out[p] = rewriteLiterals(content, p, aliases, assetMap);
    } else {
      out[p] = content;
    }
  }
  return out;
}
