# Vercel Python entrypoint — serves the ASGI app defined in apps/api/app/main.py.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402, F401
