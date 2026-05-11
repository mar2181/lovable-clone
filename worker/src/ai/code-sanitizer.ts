// Post-processing sanitizer for AI-generated code

import { VALID_LUCIDE_ICONS } from "../data/lucide-valid-icons";
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
        // If the source looks like a relative path to a specific file, split into per-component imports
        // e.g., './components/Header' -> keep first as-is, derive others from their names
        if (source.startsWith("./") || source.startsWith("../")) {
          const baseDir = source.substring(0, source.lastIndexOf("/") + 1);
          return components
            .map((comp: string) => {
              // Derive path from component name: AppHeader -> Header, HeroSection -> HeroSection
              const pathName = comp.replace(/^App/, "");
              return `import ${comp} from '${baseDir}${pathName || comp}';`;
            })
            .join("\n");
        }
        // If it's a package import with multiple names, convert to named imports
        return `import { ${components.join(", ")} } from '${source}';`;
      }
    );

    // 0b. FIX DUPLICATE DECLARATIONS
    // If the same function/const is declared multiple times, remove duplicates (keep last)
    const declaredNames = new Map<string, number>();
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const declMatch = lines[i].match(/^(?:export\s+)?(?:default\s+)?(?:function|const|class)\s+([A-Z][a-zA-Z0-9]*)/);
      if (declMatch) {
        const name = declMatch[1];
        if (declaredNames.has(name)) {
          // Find the previous declaration and blank it out (keep the later one)
          const prevLine = declaredNames.get(name)!;
          // Find the end of the previous declaration block (next export/function/const at same indent, or end of file)
          let endLine = prevLine;
          const indent = lines[prevLine].match(/^(\s*)/)?.[1] || "";
          for (let j = prevLine + 1; j < i; j++) {
            // Stop if we hit another top-level declaration
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
      // Remove blank lines that were declarations, but keep intentional blank lines
      if (line === "" && declaredNames.size > 0) {
        // Check if this was a blanked-out declaration
        for (const [, lineNum] of declaredNames) {
          if (i < lineNum) return true;
        }
      }
      return true;
    }).join("\n");
    // Clean up excessive blank lines (more than 2 in a row)
    code = code.replace(/\n{4,}/g, "\n\n");

    // 1. Fix lucide-react imports — remove forbidden icons, ensure Globe is imported
    code = code.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g,
      (match, imports) => {
        const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
        const cleaned = iconList.filter((icon: string) => !FORBIDDEN_ICONS.includes(icon));
        const hadForbidden = cleaned.length < iconList.length;

        // Add Globe as fallback if we removed any icons
        if (hadForbidden && !cleaned.includes("Globe")) {
          cleaned.push("Globe");
        }

        if (cleaned.length === 0) {
          return `import { Globe } from 'lucide-react'`;
        }

        return `import { ${cleaned.join(", ")} } from 'lucide-react'`;
      }
    );

    // 2. Replace JSX usage of forbidden icons with Globe
    for (const icon of FORBIDDEN_ICONS) {
      // Match self-closing: <Facebook className="..." />
      const selfClosingRegex = new RegExp(`<${icon}(\\s[^>]*?)\\s*\\/>`, "g");
      code = code.replace(selfClosingRegex, `<Globe$1 />`);
      // Match opening tag without self-close: <Facebook className="...">
      const openTagRegex = new RegExp(`<${icon}(\\s[^>]*)?>`, "g");
      code = code.replace(openTagRegex, `<Globe$1>`);
      // Match closing tag: </Facebook>
      const closeTagRegex = new RegExp(`<\\/${icon}>`, "g");
      code = code.replace(closeTagRegex, `</Globe>`);
    }

    // 2.5 VALIDATE LUCIDE-REACT IMPORTS — replace hallucinated icon names.
    // The AI frequently invents icon names that don't exist in lucide-react
    // (e.g. "Glove", "BoxingGlove", "Treadmill"). Replace them with Circle.
    code = code.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]\s*;?/g,
      (_match: string, imports: string) => {
        const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
        const cleaned: string[] = [];
        const replaced = new Map<string, string>();
        for (const icon of iconList) {
          const baseName = icon.split(/\s+as\s+/i)[0].trim();
          if (VALID_LUCIDE_ICONS.has(baseName)) {
            cleaned.push(icon);
          } else {
            if (!replaced.has(baseName)) {
              replaced.set(baseName, "Circle");
            }
          }
        }
        if (replaced.size > 0 && !cleaned.some((s: string) => s.split(/\s+as\s+/i).pop()?.trim() === "Circle")) {
          cleaned.push("Circle");
        }
        // Replace JSX usage of hallucinated icons
        for (const [bad] of replaced) {
          const selfCloseRe = new RegExp(`<${bad}(?=[\\s/>])([^>]*?)\\s*\\/>`, "g");
          code = code.replace(selfCloseRe, "<Circle$1 />");
          const openRe = new RegExp(`<${bad}(?=[\\s>])([^>]*)?>`, "g");
          code = code.replace(openRe, "<Circle$1>");
          const closeRe = new RegExp(`<\\/${bad}>`, "g");
          code = code.replace(closeRe, "</Circle>");
          code = code.replace(new RegExp(`\\bicon\\s*:\\s*${bad}\\b`, "g"), "icon: Circle");
          code = code.replace(new RegExp(`\\bIcon\\s*:\\s*${bad}\\b`, "g"), "Icon: Circle");
        }
        if (cleaned.length === 0) return "";
        return `import { ${cleaned.join(", ")} } from 'lucide-react';`;
      }
    );

    // 3. Kill any react-icons imports entirely (replace with lucide-react Globe)
    code = code.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]react-icons\/[^'"]+['"]\s*;?/g,
      `import { Globe } from 'lucide-react';`
    );

    // 4. Kill any @heroicons imports
    code = code.replace(
      /import\s*\{[^}]+\}\s*from\s*['"]@heroicons\/[^'"]+['"]\s*;?/g,
      `import { Globe } from 'lucide-react';`
    );

    sanitized[filename] = code;
  }

  return sanitized;
}