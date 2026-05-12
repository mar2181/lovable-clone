import sqlite3, json, os

r2_dir = '/home/mario/lovable-clone/worker/.wrangler/state/v3/r2/lovable-projects'
r2_db = os.path.join(r2_dir, '2800fca79e5b7dc9fd55cbceb5cea5d9e167a1aa92de49b12d9b5bfdad41400a.sqlite')
# Actually, the lovable-projects bucket might use a different sqlite file
# Let's check
for f in os.listdir(r2_dir):
    if f.endswith('.sqlite'):
        print(f'Found: {f}')

# Check if the lovable-projects dir has its own sqlite
db_candidates = [f for f in os.listdir(r2_dir) if f.endswith('.sqlite')]
print(f'SQLite files: {db_candidates}')

# Try reading the blobs directly
blobs_dir = os.path.join(r2_dir, 'blobs')
# Search through recent blobs for Programs
import glob
blob_files = sorted(glob.glob(os.path.join(blobs_dir, '*')), key=os.path.getmtime, reverse=True)
print(f'Total blobs: {len(blob_files)}')

for bf in blob_files[:50]:
    try:
        with open(bf, 'rb') as f:
            data = f.read()
            # Try to parse as JSON
            obj = json.loads(data)
            files = obj.get('files', {})
            for fp, content in files.items():
                if isinstance(content, str) and 'Programs' in content:
                    print(f'\n=== FOUND Programs in blob {os.path.basename(bf)} ===')
                    print(f'File: {fp}')
                    print(content[:1500])
                    print('...')
                    raise StopIteration
    except StopIteration:
        break
    except:
        pass
else:
    print('No Programs found in recent 50 blobs.')
