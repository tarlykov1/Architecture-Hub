"""Reproduce additive migration on a disposable, populated pre-0015 SQLite DB."""
from pathlib import Path
from uuid import uuid4
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def test_commercial_migration_preserves_existing_systems(tmp_path, monkeypatch):
    db_path=tmp_path/"architecture-existing.sqlite"
    url="sqlite:///"+str(db_path)
    monkeypatch.setenv("DATABASE_URL",url)
    backend_root=Path(__file__).resolve().parents[1]
    config=Config(str(backend_root/"alembic.ini"))
    config.set_main_option("script_location",str(backend_root/"alembic"))
    # Simulate a database currently on the previous schema revision.
    command.upgrade(config,"0014_layer_region_revisions")
    engine=create_engine(url)
    existing_id=uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO objects (id, kind, name, description, status, attributes) "
                          "VALUES (:id, 'system', 'QA-WORK-existing IS', '', 'active', '{}')"),
                     {"id":existing_id.hex})
        # The transitionary baseline creates all mapped tables. Remove only
        # the new, still-empty tables to reproduce an older populated deployment.
        conn.exec_driver_sql("DROP TABLE system_licenses")
        conn.exec_driver_sql("DROP TABLE system_contracts")
    command.upgrade(config,"head")
    with engine.connect() as conn:
        assert "system_contracts" in inspect(conn).get_table_names()
        assert "system_licenses" in inspect(conn).get_table_names()
        assert conn.execute(text("SELECT name FROM objects WHERE id=:id"),
                            {"id":existing_id.hex}).scalar_one()=="QA-WORK-existing IS"
        assert conn.execute(text("SELECT count(*) FROM system_contracts")).scalar_one()==0
        assert conn.execute(text("SELECT count(*) FROM system_licenses")).scalar_one()==0
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == ScriptDirectory.from_config(config).get_current_head()
    engine.dispose()
