"""Update lib/icon-sanitizer.ts to add hallucinated icon validation."""
import re

wsl_base = '/home/mario/lovable-clone'

# Read the current file
with open(f'{wsl_base}/lib/icon-sanitizer.ts', 'r') as f:
    content = f.read()

# Read the append file (the new functions we want to add)
with open(f'{wsl_base}/lib/icon-sanitizer-append.ts', 'r') as f:
    append_content = f.read()

# Add import at the top, after existing imports
import_line = "import { VALID_LUCIDE_ICONS } from './lucide-valid-icons';\n"

# Find the last import line
lines = content.split('\n')
last_import_idx = -1
for i, line in enumerate(lines):
    if line.strip().startswith('import ') or line.strip().startswith('export {'):
        last_import_idx = i

if last_import_idx >= 0:
    lines.insert(last_import_idx + 1, import_line)
else:
    lines.insert(0, import_line)

content = '\n'.join(lines)

# Remove the old sanitizeIcons function
old_func_start = content.rfind('/**\n * Full sanitization pipeline')
if old_func_start >= 0:
    # Find the closing brace of the function
    brace_start = content.find('export function sanitizeIcons', old_func_start)
    if brace_start < 0:
        brace_start = content.find('function sanitizeIcons', old_func_start)

    # Find the matching closing brace
    if brace_start >= 0:
        # Count braces to find the end
        depth = 0
        in_func = False
        func_end = brace_start
        for i in range(brace_start, len(content)):
            if content[i] == '{':
                depth += 1
                in_func = True
            elif content[i] == '}':
                depth -= 1
                if in_func and depth == 0:
                    func_end = i + 1
                    break

        content = content[:old_func_start] + append_content.strip() + '\n' + content[func_end:]

# Write back
with open(f'{wsl_base}/lib/icon-sanitizer.ts', 'w') as f:
    f.write(content)

print(f'Updated lib/icon-sanitizer.ts, new size: {len(content)} bytes')
