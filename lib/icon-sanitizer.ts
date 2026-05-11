/**
 * Shared icon sanitization logic.
 * Used by both the backend sanitizer (worker) and frontend preview panel.
 *
 * The AI models (especially Kimi K2 and DeepSeek) frequently generate imports
 * for icons that don't exist in lucide-react — brand logos, social media icons, etc.
 * This list catches them and replaces with Globe as a safe fallback.
 */

export const FORBIDDEN_ICONS = [
  // Social media brands (lucide names)
  "Facebook", "Instagram", "Twitter", "Linkedin", "Youtube", "Github",
  "Dribbble", "Figma", "Slack", "Discord", "TikTok", "Pinterest",
  "Snapchat", "WhatsApp", "Telegram", "Reddit", "Medium", "Twitch",
  "Spotify", "LinkedIn", "YouTube", "GitHub",
  // react-icons fontawesome prefixes (AI often mixes these)
  "FaFacebook", "FaInstagram", "FaTwitter", "FaLinkedin", "FaYoutube", "FaGithub",
  "FaDribbble", "FaFigma", "FaSlack", "FaDiscord", "FaTikTok", "FaPinterest",
  "FaSnapchat", "FaWhatsapp", "FaTelegram", "FaReddit", "FaMedium", "FaTwitch",
  "FaSpotify",
  // Other common AI hallucinations
  "BrandIcon", "SocialIcon", "PlatformIcon",
];

// Local app/page/section component names that AI models sometimes hallucinate as
// lucide-react icons. Remove these from lucide imports WITHOUT replacing JSX with
// Globe, because <Header /> / <Hero /> etc. are real local components.
export const FORBIDDEN_LUCIDE_COMPONENT_IMPORTS = [
  "Header", "Footer", "Hero", "Services", "About", "Portfolio", "Testimonials", "Contact",
  "App", "Home", "Layout", "Button", "Card", "Input", "Form", "Modal", "Section", "Container",
];

/**
 * Clean forbidden icons from lucide-react imports.
 * Replaces them with Globe as a safe fallback.
 */
export function cleanForbiddenIconImports(code: string): string {
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]\s*;?/g,
    (_match: string, imports: string) => {
      const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
      const cleaned = iconList.filter((icon: string) => {
        const baseName = icon.split(/\s+as\s+/i)[0].trim();
        return !FORBIDDEN_ICONS.includes(baseName) && !FORBIDDEN_LUCIDE_COMPONENT_IMPORTS.includes(baseName);
      });
      const hadMissingIcon = iconList.some((icon: string) => {
        const baseName = icon.split(/\s+as\s+/i)[0].trim();
        return FORBIDDEN_ICONS.includes(baseName);
      });
      if (hadMissingIcon && !cleaned.some((icon: string) => icon.split(/\s+as\s+/i).pop()?.trim() === "Globe")) cleaned.push("Globe");
      if (cleaned.length === 0) return ``;
      return `import { ${cleaned.join(", ")} } from 'lucide-react';`;
    }
  );
  return code;
}

/**
 * Replace forbidden icon JSX usage with Globe.
 */
export function cleanForbiddenIconJsx(code: string): string {
  for (const icon of FORBIDDEN_ICONS) {
    code = code.replace(new RegExp(`<${icon}(?=[\\s/>])([^>]*?)\\s*\\/>`, "g"), `<Globe$1 />`);
    code = code.replace(new RegExp(`<${icon}(?=[\\s>])([^>]*)?>`, "g"), `<Globe$1>`);
    code = code.replace(new RegExp(`<\\/${icon}>`, "g"), `</Globe>`);
  }
  return code;
}

/**
 * Replace react-icons and heroicons imports with lucide Globe.
 */
export function cleanOtherIconLibraries(code: string): string {
  code = code.replace(
    /import\s*\{[^}]+\}\s*from\s*['"]react-icons\/[^'"]+['"]\s*;?/g,
    `import { Globe } from 'lucide-react';`
  );
  code = code.replace(
    /import\s*\{[^}]+\}\s*from\s*['"]@heroicons\/[^'"]+['"]\s*;?/g,
    `import { Globe } from 'lucide-react';`
  );
  return code;
}

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

