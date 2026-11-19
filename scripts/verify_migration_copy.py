#!/usr/bin/env python3
"""Proof of Alembic upgrade safety on a disposable SQLite COPY, never the source.

Usage (with backend requirements installed):
  python scripts/verify_migration_copy.py --snapshot /path/to/backup.db

The input file is opened read-only. Alembic receives ONLY a private temporary
copy via a forced DATABASE_URL and must reach revision 0014. Every original
table's pre-existing column values are compared after migration; no passwords,
architecture names, network coordinates or source row values are printed.
This is a readiness check, not permission to deploy to a live database.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
HEAD = "0014_layer_region_revisions"
SUPPORTED_BASELINES = {
    "0009_monitoring_links", "0010_auth_users",
    "0011_architecture_layer_regions", "0012_layer_region_opacity",
    "0013_logical_relation_unique", HEAD,
}
REQUIRED_TABLES = {
    "objects", "relations", "infrastructure_items",
    "network_segments", "network_interfaces", "data_flows",
}


class ReadinessFailure(Exception):
    """Actionable failure without printing sensitive data."""


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _tables(db: sqlite3.Connection) -> set[str]:
    return {
        name for (name,) in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'"
        )
    }


def _revision(db: sqlite3.Connection) -> str:
    if "alembic_version" not in _tables(db):
        raise ReadinessFailure(
            "No Alembic version found: do NOT stamp a live database automatically"
        )
    rows = list(db.execute("SELECT version_num FROM alembic_version"))
    if len(rows) != 1 or rows[0][0] not in SUPPORTED_BASELINES:
        raise ReadinessFailure(
            "Unknown or ambiguous Alembic baseline: manual schema review required"
        )
    return str(rows[0][0])


def _ensure_integrity(db: sqlite3.Connection):
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ReadinessFailure("SQLite integrity_check failed")


def _active_duplicates(db: sqlite3.Connection) -> int:
    return int(db.execute("""
        SELECT COUNT(*) FROM (
          SELECT kind, source_id, target_id
          FROM relations
          WHERE kind IN ('integrates_with', 'depends_on')
          GROUP BY kind, source_id, target_id
          HAVING COUNT(*) > 1
        )
    """).fetchone()[0])


def _fingerprint(db: sqlite3.Connection, table: str, columns: list[str]) -> tuple[int, str]:
    """Hash all original column values, including historical JSON and BLOBs."""
    cols = ", ".join(_quote(name) for name in columns)
    # Ordering by *all original columns* does not depend on rowids surviving
    # Alembic's SQLite batch table recreation.
    query = f"SELECT {cols} FROM {_quote(table)} ORDER BY {cols}"
    digest = hashlib.sha256()
    count = 0
    for row in db.execute(query):
        # repr bytes are stable in both source and migrated snapshot. Hash
        # only; never emit actual private values to CI or release logs.
        digest.update(repr(tuple(row)).encode("utf-8"))
        digest.update(b"\\n")
        count += 1
    return count, digest.hexdigest()


def _capture(db: sqlite3.Connection) -> dict[str, tuple[list[str], int, str]]:
    result = {}
    for table in sorted(_tables(db) - {"alembic_version"}):
        columns = [
            row[1] for row in db.execute(f"PRAGMA table_info({_quote(table)})")
        ]
        if not columns:
            raise ReadinessFailure("Existing table has no readable column definitions")
        count, digest = _fingerprint(db, table, columns)
        result[table] = (columns, count, digest)
    return result


def verify(snapshot: Path) -> dict[str, object]:
    if not snapshot.is_file():
        raise ReadinessFailure("SQLite snapshot not found")
    # Never create a connection with write access to the supplied path.
    with sqlite3.connect(f"file:{snapshot.resolve().as_posix()}?mode=ro",
                         uri=True, timeout=30) as source:
        _ensure_integrity(source)
        missing = REQUIRED_TABLES - _tables(source)
        if missing:
            raise ReadinessFailure("Required legacy architecture tables are missing")
        before_revision = _revision(source)
        if _active_duplicates(source):
            raise ReadinessFailure(
                "Historical duplicate active IS relations: migration 0013 "
                "must not proceed until records are reviewed manually"
            )
        before = _capture(source)
        with TemporaryDirectory(prefix="archhub-migration-proof-") as directory:
            scratch = Path(directory) / "isolated.sqlite3"
            with sqlite3.connect(scratch) as copy:
                source.backup(copy, pages=100, sleep=0.1)
            env = os.environ.copy()
            env["DATABASE_URL"] = "sqlite:///" + scratch.as_posix()
            env["PYTHONPATH"] = str(BACKEND)
            # No access to the service EnvironmentFile or live DB is needed.
            process = subprocess.run(
                [sys.executable, "-m", "alembic", "-c", "alembic.ini",
                 "upgrade", "head"],
                cwd=BACKEND, env=env, text=True, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=180, check=False,
            )
            if process.returncode != 0:
                # Alembic logs may echo values from a failed SQL statement.
                # Never leak its raw output into a CI or user-visible log.
                raise ReadinessFailure(
                    "Alembic dry-run on the isolated COPY failed; "
                    "inspect details locally in a protected environment"
                )
            with sqlite3.connect(f"file:{scratch.as_posix()}?mode=ro",
                                 uri=True) as upgraded:
                _ensure_integrity(upgraded)
                if _revision(upgraded) != HEAD:
                    raise ReadinessFailure("Alembic did not reach the expected head")
                for table, (columns, old_count, old_digest) in before.items():
                    if table not in _tables(upgraded):
                        raise ReadinessFailure("Migration removed an original table")
                    present = {
                        row[1] for row in upgraded.execute(
                            f"PRAGMA table_info({_quote(table)})"
                        )
                    }
                    if not set(columns) <= present:
                        raise ReadinessFailure(
                            "Migration removed a pre-existing table column"
                        )
                    count, digest = _fingerprint(upgraded, table, columns)
                    if (count, digest) != (old_count, old_digest):
                        raise ReadinessFailure(
                            "Migration changed pre-existing architecture records"
                        )
                if _active_duplicates(upgraded):
                    raise ReadinessFailure("Duplicate logical relations after migration")
                index_names = {
                    row[1] for row in upgraded.execute("PRAGMA index_list(relations)")
                }
                if "ux_relations_active_logical_direction" not in index_names:
                    raise ReadinessFailure("Active logical relation unique index missing")
                regions = {
                    row[1] for row in upgraded.execute(
                        "PRAGMA table_info(architecture_layer_regions)"
                    )
                }
                if not {"opacity", "revision"} <= regions:
                    raise ReadinessFailure(
                        "Layer opacity/revision migration is incomplete"
                    )
    return {
        "source_revision": before_revision,
        "target_revision": HEAD,
        "preserved_existing_tables": len(before),
        "source_modified": False,
        "readiness": "isolated_copy_passed",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.snapshot)
    except (ReadinessFailure, sqlite3.Error, OSError,
            subprocess.TimeoutExpired) as exc:
        # Never include SQL, credentials, URLs or records from exceptions.
        if isinstance(exc, ReadinessFailure):
            message = str(exc)
        else:
            message = "Snapshot or migration check failed; inspect locally"
        print("BLOCKED:", message, file=sys.stderr)
        return 2
    print("PASS: disposable SQLite copy upgraded to", result["target_revision"])
    print("PASS: all existing rows preserved in",
          result["preserved_existing_tables"], "tables")
    print("PASS: source snapshot remained untouched")
    print("READY_FOR_ARCHHUB_MIGRATION_REVIEW=1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
