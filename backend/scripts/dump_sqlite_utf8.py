import os
import subprocess

# Run manage.py dumpdata as subprocess with sqlite env and write UTF-8 file (no BOM)
env = os.environ.copy()
env['DB_ENGINE'] = 'django.db.backends.sqlite3'
env['DB_NAME'] = 'db.sqlite3'
cwd = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
out_path = os.path.abspath(os.path.join(cwd, '..', 'dump_sqlite.json'))

cmd = [
    'python',
    os.path.join(cwd, 'manage.py'),
    'dumpdata',
    '--natural-primary',
    '--natural-foreign',
    '--exclude', 'contenttypes',
    '--exclude', 'auth.permission',
    '--exclude', 'sessions',
    '--indent', '2'
]
proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=cwd)
if proc.returncode != 0:
    print('dumpdata failed:', proc.stderr.decode('utf-8', errors='ignore'))
    raise SystemExit(1)
# Write raw bytes to file, then ensure file is UTF-8 without BOM
with open(out_path, 'wb') as f:
    data = proc.stdout
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            # Fallback to latin-1 to preserve bytes then re-encode
            text = data.decode('latin-1')
    f.write(text.encode('utf-8'))
print('Wrote', out_path)
