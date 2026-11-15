"""Release verification against synthetic copies of historical SQLite.

These tests never touch the VPS or any user data. The release verifier itself
must also fail closed on un-stamped and historically duplicated databases.
"""
import hashlib
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
VERIFY = ROOT / "scripts" / "verify_migration_copy.py"


def _alembic(db_path: Path, *arguments: str):
    env = os.environ.copy()
    env["DATABASE_URL"] = "sqlite:///" + db_path.as_posix()
    env["PYTHONPATH"] = str(BACKEND)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", *arguments],
        cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, "Synthetic Alembic baseline setup failed"


def _legacy_database(tmp_path: Path, baseline: str, duplicates: bool = False):
    database = tmp_path / "historical-architecture.sqlite"
    _alembic(database, "upgrade", baseline)
    source, target = uuid4().hex, uuid4().hex
    with sqlite3.connect(database) as db:
        # The repository's earliest bootstrap migration may create tables
        # directly from the *current* ORM metadata even when stamped at an
        # older Alembic revision. Normalize ONLY this disposable fixture to
        # the historical shape so the incremental migrations are really
        # exercised rather than all idempotently skipped.
        existing = {
            row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "architecture_layer_regions" in existing:
            if baseline == "0010_auth_users":
                db.execute("DROP TABLE architecture_layer_regions")
            else:
                columns = {
                    row[1] for row in db.execute(
                        "PRAGMA table_info(architecture_layer_regions)"
                    )
                }
                if baseline in ("0011_architecture_layer_regions",
                                "0012_layer_region_opacity",
                                "0013_logical_relation_unique") and "revision" in columns:
                    db.execute("ALTER TABLE architecture_layer_regions DROP COLUMN revision")
                if baseline == "0011_architecture_layer_regions" and "opacity" in columns:
                    db.execute("ALTER TABLE architecture_layer_regions DROP COLUMN opacity")
        for object_id, name in ((source, "QA-WORK-legacy-IS-one"),
                                (target, "QA-WORK-legacy-IS-two")):
            db.execute("""
                INSERT INTO objects
                (id,kind,name,description,status,attributes)
                VALUES (?,'system',?,'', 'active','{}')
            """, (object_id, name))
        rows = [
            (uuid4().hex, source, target, "integrates_with", "QA-WORK-valid"),
            (uuid4().hex, source, target, "data_flow", "QA-WORK-legacy"),
            (uuid4().hex, source, target, "data_flow", "QA-WORK-legacy-repeat"),
        ]
        if duplicates:
            rows.append((uuid4().hex, source, target, "integrates_with",
                         "QA-WORK-active-duplicate"))
        db.executemany("""
            INSERT INTO relations (id,source_id,target_id,kind,description)
            VALUES (?,?,?,?,?)
        """, rows)
        if baseline in ("0012_layer_region_opacity", "0013_logical_relation_unique"):
            db.execute("""
                INSERT INTO architecture_layer_regions
                (group_key,x,y,width,height,color,members,opacity,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, ("business:" + source, 70., 81., 600., 340., "#abcdef",
                  '["' + source + '"]', .41, "2026-11-15 00:00:00"))
        elif baseline == "0011_architecture_layer_regions":
            db.execute("""
                INSERT INTO architecture_layer_regions
                (group_key,x,y,width,height,color,members,updated_at)
                VALUES (?,?,?,?,?,?,?,?)
            """, ("business:" + source, 70., 81., 600., 340., "#abcdef",
                  '["' + source + '"]', "2026-11-15 00:00:00"))
        db.commit()
    return database


def _run_verifier(database: Path):
    return subprocess.run(
        [sys.executable, str(VERIFY), "--snapshot", str(database)],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )


@pytest.mark.parametrize("revision", [
    "0010_auth_users", "0011_architecture_layer_regions",
    "0012_layer_region_opacity", "0013_logical_relation_unique",
])
def test_release_verifier_preserves_historical_rows_and_never_touches_source(
    tmp_path, revision,
):
    source = _legacy_database(tmp_path, revision)
    original = hashlib.sha256(source.read_bytes()).digest()
    run = _run_verifier(source)
    assert run.returncode == 0, run.stderr
    assert "READY_FOR_ARCHHUB_MIGRATION_REVIEW=1" in run.stdout
    assert "source snapshot remained untouched" in run.stdout
    assert hashlib.sha256(source.read_bytes()).digest() == original
    with sqlite3.connect(source) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == revision
        assert db.execute("SELECT COUNT(*) FROM relations").fetchone()[0] == 3
        tables = {
            row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if revision == "0010_auth_users":
            assert "architecture_layer_regions" not in tables
        else:
            cols = {row[1] for row in db.execute(
                "PRAGMA table_info(architecture_layer_regions)"
            )}
            assert "revision" not in cols
            if revision == "0011_architecture_layer_regions":
                assert "opacity" not in cols


def test_release_verifier_blocks_historical_logical_duplicates_before_upgrade(tmp_path):
    source = _legacy_database(tmp_path, "0012_layer_region_opacity", duplicates=True)
    original = hashlib.sha256(source.read_bytes()).digest()
    run = _run_verifier(source)
    assert run.returncode == 2
    assert "BLOCKED" in run.stderr
    assert "duplicate" in run.stderr.lower()
    assert "READY_FOR_ARCHHUB_MIGRATION_REVIEW=1" not in run.stdout
    assert hashlib.sha256(source.read_bytes()).digest() == original


def test_release_verifier_blocks_unstamped_snapshot(tmp_path):
    source = tmp_path / "unstamped.sqlite"
    with sqlite3.connect(source) as db:
        for name in ("objects", "relations", "infrastructure_items",
                     "network_segments", "network_interfaces", "data_flows"):
            db.execute(f'CREATE TABLE "{name}" (id TEXT PRIMARY KEY)')
    original = hashlib.sha256(source.read_bytes()).digest()
    run = _run_verifier(source)
    assert run.returncode == 2
    assert "Alembic version" in run.stderr
    assert hashlib.sha256(source.read_bytes()).digest() == original


def test_release_verifier_rejects_missing_snapshot(tmp_path):
    run = _run_verifier(tmp_path / "no-db.sqlite")
    assert run.returncode == 2
    assert "BLOCKED" in run.stderr
