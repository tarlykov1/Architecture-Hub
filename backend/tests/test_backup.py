"""SQLite backup must preserve data without changing the source."""
import sqlite3
from pathlib import Path
from scripts.backup_db import backup

def test_consistent_sqlite_backup(tmp_path:Path):
    source=tmp_path/"source.db"
    with sqlite3.connect(source) as db:
        db.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, title TEXT)")
        db.execute("INSERT INTO records(title) VALUES ('important')")
    output=backup(source,tmp_path/"backups")
    assert output and output.exists()
    with sqlite3.connect(output) as db:
        assert db.execute("SELECT title FROM records").fetchone()[0]=="important"
        assert db.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    with sqlite3.connect(source) as db:
        assert db.execute("SELECT count(*) FROM records").fetchone()[0]==1

def test_missing_database_does_not_create_one(tmp_path:Path):
    source=tmp_path/"absent.db"
    assert backup(source,tmp_path/"backups") is None
    assert not source.exists()
