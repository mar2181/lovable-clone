"""Update worker/src/ai/code-sanitizer.ts with VALID_LUCIDE_ICONS check."""
import re

path = '/home/mario/lovable-clone/worker/src/ai/code-sanitizer.ts'
with open(path, 'r') as f:
    content = f.read()

# 1. Add import after line 1
lines = content.split('\n')
lines.insert(1, '')
lines.insert(2, 'import { VALID_LUCIDE_ICONS } from "../data/lucide-valid-icons";')

# 2. Find step 2 (Replace JSX usage of forbidden icons with Globe) end
# Insert new step 2.5 after the loop `for (const icon of FORBIDDEN_ICONS) { ... }`
# Find the line "    // 3. Kill any react-icons imports"
marker = '    // 3. Kill any react-icons imports entirely'
new_step = '''    // 2.5 VALIDATE LUCIDE-REACT IMPORTS — replace hallucinated icon names.
    // The AI frequently invents icon names that don't exist in lucide-react
    // (e.g. "Glove", "BoxingGlove", "Treadmill"). Replace them with Circle.
    code = code.replace(
      /import\\s*\\{([^}]+)\\}\\s*from\\s*['"]lucide-react['"]\\s*;?/g,
      (_match: string, imports: string) => {
        const iconList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
        const cleaned: string[] = [];
        const replaced = new Map<string, string>();
        for (const icon of iconList) {
          const baseName = icon.split(/\\s+as\\s+/i)[0].trim();
          if (VALID_LUCIDE_ICONS.has(baseName)) {
            cleaned.push(icon);
          } else {
            if (!replaced.has(baseName)) {
              replaced.set(baseName, "Circle");
            }
          }
        }
        if (replaced.size > 0 && !cleaned.some((s: string) => s.split(/\\s+as\\s+/i).pop()?.trim() === "Circle")) {
          cleaned.push("Circle");
        }
        // Replace JSX usage of hallucinated icons
        for (const [bad] of replaced) {
          const selfCloseRe = new RegExp(\`<\${bad}(?=[\\\\s/>])([^>]*?)\\\\s*\\\\/>\`, "g");
          code = code.replace(selfCloseRe, "<Circle$1 />");
          const openRe = new RegExp(\`<\${bad}(?=[\\\\s>])([^>]*)?>\`, "g");
          code = code.replace(openRe, "<Circle$1>");
          const closeRe = new RegExp(\`<\\\\/\${bad}>\`, "g");
          code = code.replace(closeRe, "</Circle>");
          code = code.replace(new RegExp(\`\\\\bicon\\\\s*:\\\\s*\${bad}\\\\b\`, "g"), "icon: Circle");
          code = code.replace(new RegExp(\`\\\\bIcon\\\\s*:\\\\s*\${bad}\\\\b\`, "g"), "Icon: Circle");
        }
        if (cleaned.length === 0) return "";
        return \`import { \${cleaned.join(", ")} } from 'lucide-react';\`;
      }
    );

'''

content = '\n'.join(lines)
content = content.replace(marker, new_step + '\n' + marker)

with open(path, 'w') as f:
    f.write(content)

print(f'Updated {path}, size: {len(content)} bytes')
