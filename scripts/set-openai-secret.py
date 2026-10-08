"""Compatibility command: sync the fixed Infisical production key to its Worker."""
from pathlib import Path
import subprocess,sys
raise SystemExit(subprocess.call([sys.executable,str(Path(__file__).parent/"infisical/sync_production.py"),*sys.argv[1:]]))
