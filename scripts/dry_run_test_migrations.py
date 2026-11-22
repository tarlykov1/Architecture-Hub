#!/usr/bin/env python3
"""Dry-run Architecture Hub Alembic upgrades ONLY on a temporary SQLite copy.

Original SQLite is opened in read-only mode and copied with sqlite3.backup;
it is never stamped, migrated, or modified. The temporary database is removed
after checking it. No database records or credentials are printed.

Usage (venv with Alembic installed):
  /opt/architecture-hub/backend/.venv/bin/python \
    scripts/dry_run_test_migrations.py --db /var/lib/architecture-hub/architecture_hub.db

Requires read access to the target SQLite file; no root privileges are needed
beyond what is strictly necessary to inspect it. A passing dry run is only a
preflight, NOT permission to migrate the live service.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from urllib.parse import quote


def _load_schema_checker():
    name = "archhub_readonly_schema_checker"
    path = Path(__file__).resolve().with_name("check_test_schema.py")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Read-only schema checker cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _read_only_connection(path: Path):
    return sqlite3.connect(
        "file:" + quote(str(path.resolve()), safe="/") + "?mode=ro",
        uri=True, timeout=30,
    )


def _version(connection: sqlite3.Connection):
    rows = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    if "alembic_version" not in rows:
        return None
    revisions = [
        row[0] for row in connection.execute(
            "SELECT version_num FROM alembic_version"
        )
    ]
    return revisions[0] if len(revisions) == 1 else None


def _counts(connection: sqlite3.Connection):
    names = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    protected = (
        "objects", "infrastructure_items", "data_flows",
        "flow_scenarios", "flow_scenario_steps",
        "technical_decisions", "business_processes", "business_process_steps",
        "network_segments", "auth_users", "board_audit",
    )
    return {
        name: connection.execute('SELECT COUNT(*) FROM "' + name + '"').fetchone()[0]
        for name in protected if name in names
    }


def dry_run(source: Path, backend_dir: Path | None = None) -> tuple[dict, int]:
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    root = (backend_dir or Path(__file__).resolve().parents[1] / "backend").resolve()
    config_file = root / "alembic.ini"
    migration_dir = root / "alembic"
    if not source.is_file() or not config_file.is_file() or not migration_dir.is_dir():
        return {"status": "BLOCKED", "reason": "SQLite or migration files are unavailable"}, 3

    cfg = Config(str(config_file))
    cfg.set_main_option("script_location", str(migration_dir))
    scripts = ScriptDirectory.from_config(cfg)
    head = scripts.get_current_head()
    checker = _load_schema_checker()
    if head != checker.EXPECTED_REVISION:
        return {
            "status": "BLOCKED", "reason": "Schema checker and migration head disagree",
            "head_revision": head, "checker_revision": checker.EXPECTED_REVISION,
        }, 2

    try:
        with tempfile.TemporaryDirectory(prefix="archhub-migration-copy-") as folder:
            dest = Path(folder) / "qa-work-migration-copy.sqlite"
            with _read_only_connection(source) as src, sqlite3.connect(dest) as dst:
                src.execute("PRAGMA query_only=ON")
                src.backup(dst, pages=200, sleep=0.1)
                integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
                if integrity != "ok":
                    return {"status": "BLOCKED", "reason": "SQLite snapshot failed integrity check"}, 2
                source_revision = _version(dst)
                before = _counts(dst)
                broken_before = len(dst.execute("PRAGMA foreign_key_check").fetchall())
            if source_revision is None or scripts.get_revision(source_revision) is None:
                return {
                    "status": "BLOCKED", "reason": "Alembic baseline is absent or unknown",
                    "source_revision": source_revision,
                    "next_action": "Reconcile the schema on an offline copy; never stamp live by guesswork.",
                }, 2
            # The environment file from the VPS is deliberately not loaded:
            # migrations get an explicit, isolated SQLite URL only.
            url = "sqlite:///" + str(dest)
            previous_url = os.environ.get("DATABASE_URL")
            try:
                os.environ["DATABASE_URL"] = url
                command.upgrade(cfg, "head")
            finally:
                if previous_url is None:
                    os.environ.pop("DATABASE_URL", None)
                else:
                    os.environ["DATABASE_URL"] = previous_url

            with _read_only_connection(dest) as upgraded:
                upgraded.execute("PRAGMA query_only=ON")
                after = _counts(upgraded)
                upgraded_revision = _version(upgraded)
                broken_after = len(upgraded.execute("PRAGMA foreign_key_check").fetchall())
            schema, schema_code = checker.check(dest)
            preserved = all(after.get(name, -1) == count for name, count in before.items())
            accepted = (
                schema_code == 0 and upgraded_revision == head
                and preserved and broken_after <= broken_before
            )
            report = {
                "status": "PASS" if accepted else "BLOCKED",
                "mode": "temporary_copy_only",
                "source_revision": source_revision,
                "target_revision": head,
                "copy_revision": upgraded_revision,
                "existing_table_row_counts_preserved": preserved,
                "foreign_key_issues_before": broken_before,
                "foreign_key_issues_after": broken_after,
                "schema_check": schema["status"],
                "next_action": (
                    "Preflight passed on a disposable copy. Plan a separate backed-up release."
                    if accepted else
                    "Inspect migration drift on the copy. Do not change live SQLite."
                ),
            }
            return report, 0 if accepted else 2
    except (OSError, sqlite3.Error, ValueError, Exception) as exc:
        # The exception may include private host paths or SQL values; report
        # the class only. Diagnostics can be reproduced on the isolated copy.
        return {
            "status": "BLOCKED", "reason": "Migration dry-run failed on isolated copy",
            "error_type": type(exc).__name__,
            "next_action": "Examine isolated migration logs; do not run upgrades on live SQLite.",
        }, 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--backend-dir", type=Path, default=None)
    args = parser.parse_args()
    report, code = dry_run(args.db, args.backend_dir)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
