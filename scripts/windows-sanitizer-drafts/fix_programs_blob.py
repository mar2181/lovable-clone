"""Fix the hallucinated 'Glove' icon in the existing R2 blob."""
import json, os

r2_dir = '/home/mario/lovable-clone/worker/.wrangler/state/v3/r2/lovable-projects/blobs'
blob_id = 'd9a0bf5c90d9a039c9297c4d055711953dd930a2b7d9da4d8f1bbf22e25dd1e60000019e0ed68196'
blob_path = os.path.join(r2_dir, blob_id)

# Read current data
with open(blob_path, 'rb') as f:
    data = json.loads(f.read())

files = data.get('files', {})
fixed_count = 0

for filepath, content in list(files.items()):
    if not isinstance(content, str):
        continue

    new_content = content

    # Fix: replace 'Glove' (non-existent icon) with 'Swords' (valid icon, fits combat sports theme)
    # Only in lucide-react imports and JSX usage
    if 'Glove' in new_content:
        # Replace in imports
        new_content = new_content.replace(
            "import { Glove, BadgeCheck, Flame, User, Users } from 'lucide-react';",
            "import { Swords, BadgeCheck, Flame, User, Users } from 'lucide-react';"
        )
        # Also replace standalone import
        new_content = new_content.replace(
            "import { Glove } from 'lucide-react'",
            "import { Swords } from 'lucide-react'"
        )
        # Replace JSX usage
        new_content = new_content.replace('<Glove ', '<Swords ')
        new_content = new_content.replace('</Glove>', '</Swords>')
        new_content = new_content.replace('icon: Glove', 'icon: Swords')

        files[filepath] = new_content
        fixed_count += 1
        print(f'Fixed {filepath}')
        print(f'  Before: {content[:200]}...')
        print(f'  After:  {new_content[:200]}...')

if fixed_count > 0:
    data['files'] = files
    # Write back
    with open(blob_path, 'wb') as f:
        f.write(json.dumps(data, indent=2).encode('utf-8'))
    print(f'\nFixed {fixed_count} file(s) in blob {blob_id}')
else:
    print('No Glove references found.')
