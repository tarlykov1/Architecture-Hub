#!/usr/bin/env python3
"""Read-only SQLite/Alembic structure diagnostics for Architecture Hub.

Never prints records, endpoint addresses, credentials, or business data.
Never creates, stamps or modifies an existing SQLite database.

Example (test VPS, authorized operator):
  python3 scripts/check_test_schema.py --db /var/lib/architecture-hub/architecture_hub.db

Exit code 0: checked schema matches expected revision and required structures.
Exit code 2: missing/drifted schema; inspect + test migrations on a COPY.
Exit code 3: database inaccessible or unreadable.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote

EXPECTED_REVISION = "0021_technical_decision_change_plans"
REQUIRED_TABLES: dict[str, set[str]] = {
    "objects": {"id", "kind", "name"},
    "business_processes": {"id", "category_id", "name", "description"},
    "process_systems": {"id", "process_id", "system_id"},
    "data_flows": {"id", "source_id", "target_id"},
    "flow_scenarios": {"id", "name", "process_id", "revision"},
    "flow_scenario_steps": {"id", "scenario_id", "flow_id", "position"},
    "business_process_passports": {
        "process_id", "parent_id", "owner", "participants", "result",
        "status", "revision", "updated_at",
    },
    "technical_decision_change_plans": {"decision_id", "changes"},
    "business_process_steps": {
        "id", "process_id", "position", "name", "description",
        "responsible", "input", "output", "system_id", "component_id",
        "flow_id", "attribute_ids",
    },
}
REQUIRED_INDEXES = {
    ("business_process_passports", "ix_business_process_passports_parent_id"),
    ("business_process_steps", "ix_business_process_steps_process_id"),
    ("business_process_steps", "ix_business_process_steps_system_id"),
    ("business_process_steps", "ix_business_process_steps_component_id"),
    ("business_process_steps", "ix_business_process_steps_flow_id"),
    ("flow_scenarios", "ix_flow_scenarios_process_id"),
    ("flow_scenario_steps", "ix_flow_scenario_steps_scenario_id"),
    ("flow_scenario_steps", "ix_flow_scenario_steps_flow_id"),
}


def check(path: Path) -> tuple[dict, int]:
    if not path.is_file():
        return {"status": "BLOCKED", "reason": "SQLite file not found"}, 3
    # Use URI read-only mode to prevent SQLite creating the database file.
    uri = "file:" + quote(str(path.resolve()), safe="/") + "?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True, timeout=5) as db:
            db.execute("PRAGMA query_only=ON")
            integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
            names = {
                row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            missing_tables = sorted(REQUIRED_TABLES.keys() - names)
            missing_columns = {}
            for table, columns in REQUIRED_TABLES.items():
                if table not in names:
                    continue
                actual = {row[1] for row in db.execute(
                    'PRAGMA table_info("' + table + '")'
                )}
                if absent := columns - actual:
                    missing_columns[table] = sorted(absent)
            missing_indexes = []
            for table, index in sorted(REQUIRED_INDEXES):
                if table not in names:
                    continue
                actual = {row[1] for row in db.execute(
                    'PRAGMA index_list("' + table + '")'
                )}
                if index not in actual:
                    missing_indexes.append(index)
            revision = None
            if "alembic_version" in names:
                versions = [row[0] for row in db.execute(
                    "SELECT version_num FROM alembic_version"
                )]
                revision = versions[0] if len(versions) == 1 else "ambiguous"
            # Foreign-key structure is inspected without changing enforcement.
            broken_references = len(db.execute("PRAGMA foreign_key_check").fetchall())
    except (sqlite3.Error, OSError) as exc:
        return {
            "status": "BLOCKED",
            "reason": "SQLite could not be inspected read-only",
            "error_type": type(exc).__name__,
        }, 3
    passed = (
        integrity == "ok"
        and revision == EXPECTED_REVISION
        and not missing_tables
        and not missing_columns
        and not missing_indexes
        and broken_references == 0
    )
    report = {
        "status": "PASS" if passed else "BLOCKED",
        "expected_revision": EXPECTED_REVISION,
        "actual_revision": revision,
        "sqlite_integrity": integrity,
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
        "missing_indexes": missing_indexes,
        "broken_foreign_key_count": broken_references,
    }
    if revision != EXPECTED_REVISION:
        report["next_action"] = (
            "Verify a consistent SQLite backup and test Alembic migration on "
            "an isolated copy. Do not stamp or upgrade the live database."
        )
    return report, 0 if passed else 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Existing SQLite file; opened read-only")
    arguments = parser.parse_args()
    result, exit_code = check(arguments.db)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
