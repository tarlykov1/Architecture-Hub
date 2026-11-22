"""Read-only diagnostics for the installed API and its migration stamp."""
from pathlib import Path
import os
import re

from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Connection

APP_DIR = Path(__file__).resolve().parent


def read_version(connection: Connection) -> dict:
    marker = APP_DIR / "BUILD_REVISION"
    revision = marker.read_text().strip() if marker.is_file() else os.getenv("BUILD_REVISION", "")
    return {
        "api_revision": revision if re.fullmatch(r"[0-9a-f]{40}", revision) else None,
        "database_heads": sorted(MigrationContext.configure(connection).get_current_heads()),
        "expected_heads": sorted(ScriptDirectory(str(APP_DIR.parent / "alembic")).get_heads()),
    }
