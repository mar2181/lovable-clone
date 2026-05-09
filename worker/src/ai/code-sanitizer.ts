// Post-processing sanitizer for AI-generated code
// Fixes common issues that crash Sandpack previews

// Icons that DO NOT exist in lucide-react but AI models frequently try to use
const FORBIDDEN_ICONS = [
  "Facebook", "Instagram", "Twitter", "Linkedin", "Youtube", "Github",
  "Dribbble", "Figma", "Slack", "Discord", "TikTok", "Pinterest",
  "Snapchat", "WhatsApp", "Telegram", "Reddit", "Medium", "Twitch",
  "Spotify", "LinkedIn", "YouTube", "GitHub", "FaFacebook", "FaInstagram",
  "FaTwitter", "FaLinkedin", "FaYoutube", "FaGithub",
];

// Icons that DO exist in lucide-react and are safe to auto-import when the AI
// references them in JSX/objects but forgot to add them to the import line.
// MUST stay in sync with the "VERIFIED SAFE lucide-react icons" list in
// worker/src/ai/system-prompt.ts.
const SAFE_LUCIDE_ICONS = new Set<string>([
  "Phone", "Mail", "MapPin", "Menu", "X",
  "ChevronRight", "ChevronDown", "ChevronUp",
  "ArrowRight", "ArrowUp", "ArrowLeft",
  "Star", "Heart", "Clock", "Calendar",
  "User", "Users", "Home", "Building", "Building2",
  "Wrench", "Hammer", "PaintBucket", "Ruler",
  "Shield", "ShieldCheck", "CheckCircle", "Check",
  "ExternalLink", "Globe", "Send", "Search",
  "Plus", "Minus", "Eye", "EyeOff",
  "Camera", "Image", "Award", "Target", "TrendingUp", "DollarSign",
  "Loader2", "Settings", "LogOut", "Trash2", "Edit", "Copy",
  "Download", "Upload", "Share2", "Filter", "SlidersHorizontal",
  "BarChart3", "PieChart", "Zap", "Sparkles", "Sun", "Moon",
  "AlertCircle", "Info", "HelpCircle", "MessageCircle", "MessageSquare",
  "Bookmark", "Tag", "Link", "Palette", "Layers", "Grid", "List",
  "MoreHorizontal", "MoreVertical", "Play", "Pause",
  "SquareIcon", "CircleIcon", "Triangle", "Hexagon",
  "Move", "Maximize2", "Minimize2",
]);

// Resolve a relative import path against the importing file's directory.
// Returns the candidate /src/... keys we should look up in the file map.
// Used for the constants-file cross-validation pass below.
function resolveLocalImport(fromFile: string, spec: string): string[] {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return [];
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const parts = (fromDir + "/" + spec).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") { stack.pop(); continue; }
    stack.push(part);
  }
  const base = "/" + stack.join("/");
  const exts = [".ts", ".tsx", ".js", ".jsx"];
  const candidates: string[] = [];
  // Already has an extension
  if (/\.(t|j)sx?$/.test(base)) candidates.push(base);
  else {
    for (const ext of exts) candidates.push(base + ext);
    for (const ext of exts) candidates.push(base + "/index" + ext);
  }
  return candidates;
}

/**
 * Fixes broken imports, forbidden icons, and other common AI code mistakes.
 */
export function sanitizeGeneratedCode(files: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [filename, content] of Object.entries(files)) {
    if (!filename.endsWith(".tsx") && !filename.endsWith(".jsx") && !filename.endsWith(".ts") && !filename.endsWith(".js")) {
      sanitized[filename] = content;
      continue;
    }

    let code = content;

    // 0. FIX MALFORMED MULTI-DEFAULT IMPORTS
    // Catches: import AppHeader, Hero, Services from '...' (invalid JS)
    // Converts to separate default imports per component
    code = code.replace(
      /import\s+([A-Z][a-zA-Z0-9]*(?:\s*,\s*[A-Z][a-zA-Z0-9]*)+)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
      (_match, names: string, source: string) => {
        const components = names.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (source.startsWith("./") || source.startsWith("../")) {
          const baseDir = source.substring(0, source.lastIndexOf("/") + 1);
          return components
            .map((comp: string) => {
              const pathName = comp.replace(/^App/, "");
              return `import ${comp} from '${baseDir}${pathName || comp}';`;
            })
            .join("\n");
        }
        return `import { ${components.join(", ")} } from '${source}';`;
      }
    );

    // 0b. FIX DUPLICATE DECLARATIONS
    const declaredNames = new Map<string, number>();
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const declMatch = lines[i].match(/^(?:export\s+)?(?:default\s+)?(?:function|const|class)\s+([A-Z][a-zA-Z0-9]*)/);
      if (declMatch) {
        const name = declMatch[1];
        if (declaredNames.has(name)) {
          const prevLine = declaredNames.get(name)!;
          let endLine = prevLine;
          const indent = lines[prevLine].match(/^(\s*)/)?.[1] || "";
          for (let j = prevLine + 1; j < i; j++) {
            if (lines[j].match(new RegExp(`^${indent}(?:export\\s+)?(?:default\\s+)?(?:function|const|class)\\s+[A-Z]`))) {
              break;
            }
            endLine = j;
          }
          for (let j = prevLine; j <= endLine; j++) {
            lines[j] = "";
          }
        }
        declaredNames.set(name, i);
      }
    }
    code = lines.filter((line, i) => {
      if (line === "" && declaredNames.size > 0) {
        for (const [, lineNum] of declaredNames) {
          if (i < lineNum) return true;
        }
      }
      return true;
    }).join("\n");
    code = code.replace(/\n{4,}/g, "\n\n");

    // 1. Fix lucide-react imports — remove forbidden icons, ensure Globe is imported
    code = code.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g,
      (match, imports) => {
        const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
        const cleaned = iconList.filter((icon: string) => !FORBIDDEN_ICONS.includes(icon));
        const hadForbidden = cleaned.length < iconList.length;
        if (hadForbidden && !cleaned.includes("Globe")) cleaned.push("Globe");
        if (cleaned.length === 0) return `import { Globe } from 'lucide-react'`;
        return `import { ${cleaned.join(", ")} } from 'lucide-react'`;
      }
    );

    // 2. Replace JSX usage of forbidden icons with Globe
    for (const icon of FORBIDDEN_ICONS) {
      code = code.replace(new RegExp(`<${icon}(\\s[^>]*?)\\s*\\/>`, "g"), `<Globe$1 />`);
      code = code.replace(new RegExp(`<${icon}(\\s[^>]*)?>`, "g"), `<Globe$1>`);
      code = code.replace(new RegExp(`<\\/${icon}>`, "g"), `</Globe>`);
    }

    // 3. Kill any react-icons imports entirely
    code = code.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]react-icons\/[^'"]+['"]\s*;?/g,
      `import { Globe } from 'lucide-react';`
    );

    // 4. Kill any @heroicons imports
    code = code.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]@heroicons\/[^'"]+['"]\s*;?/g,
      `import { Globe } from 'lucide-react';`
    );

    // 5. NUCLEAR FIX: SVG data URIs in style attributes
    // The AI generates code like:
    //   style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width='60'...")' }}
    // The single quotes INSIDE the SVG (width='60', fill='none') break out of the outer
    // single-quoted string, causing a JSX parse error.
    //
    // Strategy: Line-by-line scan. Any line with 'data:image/svg+xml' inside a style=
    // attribute — extract the full SVG URI, replace with template literal.
    const fixLines = code.split('\n');
    for (let i = 0; i < fixLines.length; i++) {
      const line = fixLines[i];
      if (!line.includes('data:image/svg+xml')) continue;

      // Find the SVG data URI: starts at 'data:image/svg+xml,' and ends at '%3C/svg%3E'
      const startIdx = line.indexOf('data:image/svg+xml,');
      if (startIdx === -1) continue;

      // Find the closing — the SVG ends with %3C/svg%3E (URL-encoded </svg>)
      const svgEnd = line.indexOf('%3C/svg%3E', startIdx);
      if (svgEnd === -1) continue;

      const endIdx = svgEnd + '%3C/svg%3E'.length;
      const svgUri = line.substring(startIdx, endIdx);

      // Replace the backgroundImage value with a clean template literal version
      // Use [\s\S]*? for non-greedy match across the full style={{ }} block
      const newLine = line.replace(
        /style=\{\{[\s\S]*?\}\}/,
        (match) => {
          // Replace just the backgroundImage value, preserving other style props
          return match.replace(
            /backgroundImage:\s*['"]?url\([^)]*\)['"]?/,
            `backgroundImage: \`url("${svgUri}")\``
          );
        }
      );
      
      if (newLine !== line) {
        fixLines[i] = newLine;
      }
    }
    code = fixLines.join('\n');

    // 6. SAFETY NET: Remove any remaining lines where quote counting is broken
    // After all fixes above, if a line still has data:image/svg+xml and odd quotes, strip it
    const safetyLines = code.split('\n');
    for (let i = 0; i < safetyLines.length; i++) {
      const line = safetyLines[i];
      if (!line.includes('data:image/svg+xml')) continue;

      // Count quotes (excluding escaped quotes)
      const singleCount = (line.match(/(?<!\\)'/g) || []).length;
      const doubleCount = (line.match(/(?<!\\)"/g) || []).length;
      if (singleCount % 2 !== 0 || doubleCount % 2 !== 0) {
        // Still broken — remove the backgroundImage entirely
        safetyLines[i] = line.replace(
          /backgroundImage:\s*['"`]?url\([^}]+['"`]?/g,
          ''
        ).replace(/,\s*\}\}/, '}}').replace(/\{\{\s*\}\}/, '');
      }
    }
    code = safetyLines.join('\n');

    // 6.5 AUTO-IMPORT MISSING LUCIDE-REACT ICONS
    // The AI frequently writes `icon: Home` or `<Home />` in a file but forgets
    // to add the icon to the `import { ... } from 'lucide-react'` line. The
    // resulting ReferenceError red-screens the entire Sandpack preview.
    //
    // Strategy: find every PascalCase identifier referenced as a JSX tag, an
    // `icon: Foo` value in an object literal, or an `icon={Foo}` JSX prop. If
    // the identifier is in SAFE_LUCIDE_ICONS and isn't already imported from
    // anywhere in the file, append it to the existing lucide-react import (or
    // create one if absent).
    {
      const importedNames = new Set<string>();
      // Collect every imported identifier in the file from any source.
      // Named imports
      for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g)) {
        for (const raw of m[1].split(",")) {
          const name = raw.trim().split(/\s+as\s+/i)[0].trim();
          if (name) importedNames.add(name);
        }
      }
      // Default imports
      for (const m of code.matchAll(/import\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s*['"][^'"]+['"]/g)) {
        importedNames.add(m[1]);
      }
      // Default + named on the same line: `import Foo, { Bar } from '...'`
      for (const m of code.matchAll(/import\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*\{([^}]+)\}\s*from/g)) {
        importedNames.add(m[1]);
        for (const raw of m[2].split(",")) {
          const name = raw.trim().split(/\s+as\s+/i)[0].trim();
          if (name) importedNames.add(name);
        }
      }

      const referenced = new Set<string>();
      // JSX usage: <Home ...> or <Home />
      for (const m of code.matchAll(/<\s*([A-Z][a-zA-Z0-9]*)\b/g)) referenced.add(m[1]);
      // icon: Home or Icon: Home in object literals
      for (const m of code.matchAll(/\b[Ii]con\s*:\s*([A-Z][a-zA-Z0-9]*)\b/g)) referenced.add(m[1]);
      // icon={Home} as JSX prop
      for (const m of code.matchAll(/\b[Ii]con\s*=\s*\{\s*([A-Z][a-zA-Z0-9]*)\s*\}/g)) referenced.add(m[1]);

      const missing: string[] = [];
      for (const name of referenced) {
        if (!SAFE_LUCIDE_ICONS.has(name)) continue;
        if (importedNames.has(name)) continue;
        missing.push(name);
      }

      if (missing.length > 0) {
        const lucideRe = /import\s*\{([^}]*)\}\s*from\s*(['"])lucide-react\2/;
        if (lucideRe.test(code)) {
          code = code.replace(lucideRe, (_m, existing: string, quote: string) => {
            const cur = existing.split(",").map((s: string) => s.trim()).filter(Boolean);
            for (const name of missing) if (!cur.includes(name)) cur.push(name);
            return `import { ${cur.join(", ")} } from ${quote}lucide-react${quote}`;
          });
        } else {
          // No existing lucide-react import — add one at the top of the file,
          // after any leading "use client"/"use strict" directive.
          const directiveMatch = code.match(/^(\s*['"](?:use [a-z]+)['"];?\s*\n)/);
          const insertAt = directiveMatch ? directiveMatch[0].length : 0;
          const importLine = `import { ${missing.join(", ")} } from 'lucide-react';\n`;
          code = code.slice(0, insertAt) + importLine + code.slice(insertAt);
        }
      }
    }

    // 7. FIX UNESCAPED APOSTROPHES IN SINGLE-QUOTED STRINGS
    // AI generates strings like: 'We're not just agents' — the apostrophe breaks JS parsing.
    // Solution: Replace ASCII apostrophes in common English contractions with the Unicode
    // right single quotation mark (U+2019 \u2019). This is typographically correct AND
    // won't terminate single-quoted JS strings since \u2019 !== \u0027.
    code = code.replace(
      /\b(We|we|I|They|they|You|you|It|it|He|he|She|she|Don|don|Won|won|Can|can|Shouldn|shouldn|Wouldn|wouldn|Couldn|couldn|Didn|didn|Isn|isn|Aren|aren|Wasn|wasn|Weren|weren|Hasn|hasn|Haven|haven|Hadn|hadn|That|that|There|there|Here|here|What|what|Who|who|Let|let)'(re|ve|ll|t|s|m|d)\b/g,
      "$1\u2019$2"
    );

    sanitized[filename] = code;
  }

  // 8. CROSS-FILE: AUTO-STUB MISSING EXPORTS
  // The AI frequently imports `{ PHONE, EMAIL }` from `'../lib/constants'`
  // but only `EMAIL` is actually exported there. The result is `PHONE` is
  // `undefined` at render time and the page renders broken / hydration
  // mismatches fire. Walk every importer, look up the source file in this
  // batch, parse its top-level exports, and append placeholder
  // `export const X = '';` lines for any imported names that are missing.
  // This keeps the preview rendering instead of crashing — the AI can still
  // populate real values on the next iteration.
  {
    type Want = { from: string; importer: string; names: string[] };
    const wants: Want[] = [];
    const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;

    for (const [filename, content] of Object.entries(sanitized)) {
      if (!/\.(t|j)sx?$/.test(filename)) continue;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(content)) !== null) {
        const spec = m[2];
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
        const names = m[1]
          .split(",")
          .map((s: string) => s.trim().split(/\s+as\s+/i)[0].trim())
          .filter(Boolean);
        if (names.length === 0) continue;
        const candidates = resolveLocalImport(filename, spec);
        const resolved = candidates.find((c) => sanitized[c] !== undefined);
        if (!resolved) continue;
        wants.push({ from: resolved, importer: filename, names });
      }
    }

    // Group wanted names by source file
    const wantedByFile = new Map<string, Set<string>>();
    for (const w of wants) {
      let set = wantedByFile.get(w.from);
      if (!set) { set = new Set(); wantedByFile.set(w.from, set); }
      for (const n of w.names) set.add(n);
    }

    for (const [sourceFile, wanted] of wantedByFile) {
      const src = sanitized[sourceFile];
      if (typeof src !== "string") continue;

      // Collect existing top-level export identifiers
      const exported = new Set<string>();
      // export const X = ...; export let X = ...; export var X = ...;
      for (const mm of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        exported.add(mm[1]);
      }
      // export function X(...) { ... }; export async function X(...) { ... }
      for (const mm of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        exported.add(mm[1]);
      }
      // export default function X(...) { ... }; export default async function X(...) { ... }
      for (const mm of src.matchAll(/export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        exported.add(mm[1]);
      }
      // export class X { ... }
      for (const mm of src.matchAll(/export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        exported.add(mm[1]);
      }
      // export default class X { ... }
      for (const mm of src.matchAll(/export\s+default\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        exported.add(mm[1]);
      }
      // export { A, B as C } -> exposes A and C
      for (const mm of src.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const raw of mm[1].split(",")) {
          const piece = raw.trim();
          if (!piece) continue;
          const parts = piece.split(/\s+as\s+/i);
          const exposedAs = (parts[1] || parts[0]).trim();
          if (exposedAs) exported.add(exposedAs);
        }
      }
      // export default ... -> only exposed via default import, ignore here

      const missing: string[] = [];
      for (const name of wanted) {
        if (name === "default") continue;
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
        if (!exported.has(name)) missing.push(name);
      }

      if (missing.length === 0) continue;

      const stubLines = [
        "",
        "// Auto-stubbed by sanitizer: these identifiers were imported elsewhere",
        "// but never exported. Stubbed as no-op components to keep the preview alive.",
        ...missing.map((n) => `const ${n} = () => null;\nexport { ${n} };`),
        "",
      ].join("\n");

      sanitized[sourceFile] = src.replace(/\s*$/, "\n") + stubLines;
    }
  }

  return sanitized;
}
