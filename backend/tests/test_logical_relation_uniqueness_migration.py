"""Migration safety and race-proof uniqueness for canonical logical IS links.

These tests operate on disposable in-memory SQLite databases. They never
read or change the user's architecture database.
"""
from pathlib import Path
import runpy

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy.exc import IntegrityError


MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0013_logical_relation_unique.py"
INDEX = "ux_relations_active_logical_direction"


def _engine() -> sa.Engine:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TABLE relations (
                id TEXT PRIMARY KEY NOT NULL,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                kind TEXT NOT NULL
            )
        """)
    return engine


def _write(engine: sa.Engine, rid: str, source: str, target: str, kind: str):
    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO relations (id,source_id,target_id,kind) VALUES (:id,:source,:target,:kind)"),
            {"id": rid, "source": source, "target": target, "kind": kind},
        )


def _upgrade(engine: sa.Engine):
    migration = runpy.run_path(str(MIGRATION))
    upgrade = migration["upgrade"]
    with engine.begin() as connection:
        upgrade.__globals__["op"] = Operations(MigrationContext.configure(connection))
        upgrade()


def test_unique_partial_index_prevents_simultaneously_inserted_duplicate_logical_links():
    engine = _engine()
    try:
        _upgrade(engine)
        assert INDEX in {row["name"] for row in sa.inspect(engine).get_indexes("relations")}
        _write(engine, "a", "src", "dst", "integrates_with")
        with pytest.raises(IntegrityError):
            _write(engine, "b", "src", "dst", "integrates_with")
        _write(engine, "c", "dst", "src", "integrates_with")
        _write(engine, "d", "src", "dst", "depends_on")
        # Unknown/deprecated historical types are kept accessible; index does
        # not delete, rename or enforce new API rules retroactively.
        _write(engine, "e", "src", "dst", "data_flow")
        _write(engine, "f", "src", "dst", "data_flow")
        with engine.connect() as connection:
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM relations")) == 5
        # Upgrade is idempotent if deployment tries to resume.
        _upgrade(engine)
    finally:
        engine.dispose()


def test_migration_refuses_legacy_duplicate_without_touching_any_row():
    engine = _engine()
    try:
        _write(engine, "old-a", "same", "pair", "integrates_with")
        _write(engine, "old-b", "same", "pair", "integrates_with")
        _write(engine, "legacy-a", "same", "pair", "data_flow")
        before = None
        with engine.connect() as connection:
            before = connection.execute(sa.text(
                "SELECT id,source_id,target_id,kind FROM relations ORDER BY id"
            )).all()
        with pytest.raises(RuntimeError, match="reconcile manually.*No existing relation was modified"):
            _upgrade(engine)
        assert INDEX not in {item["name"] for item in sa.inspect(engine).get_indexes("relations")}
        with engine.connect() as connection:
            after = connection.execute(sa.text(
                "SELECT id,source_id,target_id,kind FROM relations ORDER BY id"
            )).all()
        assert before == after
    finally:
        engine.dispose()


def test_migration_preserves_historical_data_flow_duplicates():
    engine = _engine()
    try:
        _write(engine, "legacy-a", "A", "B", "data_flow")
        _write(engine, "legacy-b", "A", "B", "data_flow")
        _upgrade(engine)
        with engine.connect() as connection:
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM relations")) == 2
        _write(engine, "new-link", "A", "B", "integrates_with")
        with pytest.raises(IntegrityError):
            _write(engine, "new-duplicate", "A", "B", "integrates_with")
    finally:
        engine.dispose()
