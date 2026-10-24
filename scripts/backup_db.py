"""Create a consistent online SQLite backup before starting Architecture Hub.

Does not modify the source DB, even while another connection is open.
"""
from __future__ import annotations
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"backend"/"architecture_hub.db"
TARGET=ROOT/".runtime"/"backups"

def backup(source:Path=SOURCE,directory:Path=TARGET)->Path|None:
    if not source.is_file():
        return None
    directory.mkdir(parents=True,exist_ok=True)
    if directory.resolve()==source.parent.resolve():
        raise RuntimeError("Backup directory must not be the source directory")
    destination=directory/("architecture_hub_"+datetime.now().strftime("%Y%m%d_%H%M%S_%f")+".db")
    try:
        with sqlite3.connect(f"file:{source.as_posix()}?mode=ro",uri=True,timeout=15) as src:
            with sqlite3.connect(destination,timeout=15) as dst:
                src.backup(dst,pages=100,sleep=0.1)
                result=dst.execute("PRAGMA quick_check").fetchone()
                if not result or result[0]!="ok":
                    raise RuntimeError("SQLite backup integrity check failed")
        return destination
    except Exception:
        destination.unlink(missing_ok=True)
        raise

if __name__=="__main__":
    try:
        target=backup()
        print("No local SQLite database yet; backup skipped." if target is None else f"SQLite backup created: {target}")
    except Exception as exc:
        print(f"SQLite backup failed: {exc}",file=sys.stderr)
        sys.exit(1)
