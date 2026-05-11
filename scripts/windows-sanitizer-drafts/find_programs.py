import sqlite3, json, os

r2_db = '/home/mario/lovable-clone/worker/.wrangler/state/v3/r2/miniflare-R2BucketObject/2800fca79e5b7dc9fd55cbceb5cea5d9e167a1aa92de49b12d9b5bfdad41400a.sqlite'
conn = sqlite3.connect(r2_db)

rows = conn.execute("SELECT key, blob_id FROM _mf_objects WHERE key LIKE '%/v%.json' ORDER BY key").fetchall()

found = []
for key, blob_id in rows:
    blob_rows = conn.execute("SELECT data FROM _mf_blobs WHERE id = ?", (blob_id,)).fetchall()
    if not blob_rows:
        continue
    data = blob_rows[0][0]
    try:
        obj = json.loads(data)
        files = obj.get('files', {})
        for filepath, content in files.items():
            if isinstance(content, str) and ('Programs' in content or 'Programs' in filepath):
                found.append((key, filepath, content))
                break
    except:
        pass

if found:
    for key, filepath, content in found:
        print(f'=== FOUND in {key} -> {filepath} ===')
        print(content[:1000])
        print('...')
else:
    print('No Programms component found in any version.')

conn.close()
