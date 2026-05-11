
import { VALID_LUCIDE_ICONS } from './lucide-valid-icons';

/**
 * Validate lucide-react imports against the known-good icon list.
 * Any icon NOT in VALID_LUCIDE_ICONS is a hallucination and gets replaced with Circle.
 * This catches names like "Glove", "BoxingGlove", "Treadmill" that the AI invents.
 */
export function cleanHallucinatedIcons(code: string): string {
  return code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]\s*;?/g,
    (_match: string, imports: string) => {
      const iconList = imports.split(',').map((s: string) => s.trim()).filter(Boolean);
      const cleaned: string[] = [];
      const replaced = new Map<string, string>();
      for (const icon of iconList) {
        const baseName = icon.split(/\s+as\s+/i)[0].trim();
        if (VALID_LUCIDE_ICONS.has(baseName)) {
          cleaned.push(icon);
        } else {
          if (!replaced.has(baseName)) {
            replaced.set(baseName, 'Circle');
          }
        }
      }
      if (replaced.size > 0 && !cleaned.some((s: string) => s.split(/\s+as\s+/i).pop()?.trim() === 'Circle')) {
        cleaned.push('Circle');
      }
      // Replace JSX usage of hallucinated icons
      for (const [bad] of replaced) {
        code = code.replace(new RegExp(`<${bad}(?=[\\s/>])([^>]*?)\\s*\\/>`, 'g'), '<Circle$1 />');
        code = code.replace(new RegExp(`<${bad}(?=[\\s>])([^>]*)?>`, 'g'), '<Circle$1>');
        code = code.replace(new RegExp(`<\\/${bad}>`, 'g'), '</Circle>');
        code = code.replace(new RegExp(`\\bicon\\s*:\\s*${bad}\\b`, 'g'), 'icon: Circle');
        code = code.replace(new RegExp(`\\bIcon\\s*:\\s*${bad}\\b`, 'g'), 'Icon: Circle');
      }
      if (cleaned.length === 0) return '';
      return `import { ${cleaned.join(', ')} } from 'lucide-react';`;
    }
  );
}

/**
 * Full sanitization pipeline — runs all icon cleanup steps.
 */
export function sanitizeIcons(code: string): string {
  code = cleanForbiddenIconImports(code);
  code = cleanForbiddenIconJsx(code);
  code = cleanOtherIconLibraries(code);
  code = cleanHallucinatedIcons(code);
  return code;
}
