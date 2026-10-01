"""Upload only OPENAI_API_KEY from the local .env to this project's Worker."""
from pathlib import Path
import subprocess

key = None
for line in Path('.env').read_text().splitlines():
    if line.strip().startswith('OPENAI_API_KEY='):
        key = line.split('=', 1)[1].strip().strip('"').strip("'")
if not key:
    raise SystemExit('OPENAI_API_KEY is missing from .env')
subprocess.run(['node_modules/.bin/wrangler', 'secret', 'put', 'OPENAI_API_KEY', '--config', 'worker/wrangler.jsonc'], input=key + '\n', text=True, check=True)
