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

  return sanitized;
}
