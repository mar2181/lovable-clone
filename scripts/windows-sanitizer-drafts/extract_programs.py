import json, os

r2_dir = '/home/mario/lovable-clone/worker/.wrangler/state/v3/r2/lovable-projects/blobs'
blob_id = 'd9a0bf5c90d9a039c9297c4d055711953dd930a2b7d9da4d8f1bbf22e25dd1e60000019e0ed68196'

with open(os.path.join(r2_dir, blob_id), 'rb') as f:
    data = json.loads(f.read())

files = data.get('files', {})

# Find Programs component
for fp, content in files.items():
    if 'Programs' in fp or (isinstance(content, str) and 'function Programs' in content):
        print(f'=== {fp} ===')
        print(content)
        print('=== END ===\n')

# Also list all files
print('\nAll files in this version:')
for fp in sorted(files.keys()):
    print(f'  {fp}')
