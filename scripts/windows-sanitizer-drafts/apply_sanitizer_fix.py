"""Apply the sanitizer fix to the WSL copy."""
wsl = '/home/mario/lovable-clone'

# Read the sanitizer
with open(f'{wsl}/worker/src/ai/code-sanitizer.ts', 'r') as f:
    content = f.read()

# 1. Add import after line 1
lines = content.split('\n')
lines.insert(1, '')
lines.insert(2, 'import { VALID_LUCIDE_ICONS } from "../data/lucide-valid-icons";')
content = '\n'.join(lines)

# 2. Read the new step 2.5
with open(f'{wsl}/scripts/sanitizer_step_2_5.txt', 'r') as f:
    new_step = f.read()

# 3. Insert before "    // 3. Kill any react-icons imports"
marker = '    // 3. Kill any react-icons imports entirely'
content = content.replace(marker, new_step + '\n' + marker)

# Write back
with open(f'{wsl}/worker/src/ai/code-sanitizer.ts', 'w') as f:
    f.write(content)

print(f'Done. New size: {len(content)} bytes')
