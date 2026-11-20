"""Upgrade a populated pre-inventory SQLite to the current schema without losing IS data."""
from pathlib import Path
from uuid import uuid4
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def test_technology_migrations_are_additive_on_populated_sqlite(tmp_path, monkeypatch):
    url="sqlite:///"+str(tmp_path/"qa-work-technology-migration.db")
    monkeypatch.setenv("DATABASE_URL",url)
    root=Path(__file__).resolve().parents[1]
    cfg=Config(str(root/"alembic.ini"))
    cfg.set_main_option("script_location",str(root/"alembic"))
    command.upgrade(cfg,"0015_system_commercial")
    engine=create_engine(url)
    original_id=uuid4().hex
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO objects(id, kind, name, description, status, attributes) "
                          "VALUES (:id,'system','QA-WORK-existing-stack-IS','','active','{}')"),
                     {"id":original_id})
        # Transitional baseline creates mapped tables prematurely on a fresh DB.
        # Drop only the new empty tables to emulate a real pre-0016 deployment.
        for table in ("system_technology_observations","system_technologies"):
            if table in inspect(conn).get_table_names():
                conn.exec_driver_sql("DROP TABLE "+table)
    command.upgrade(cfg,"head")
    with engine.connect() as conn:
        existing=inspect(conn).get_table_names()
        assert {"technical_decisions", "technical_decision_reviews", "technical_decision_comments"}.issubset(existing)
        assert "system_technologies" in existing
        assert "system_technology_observations" in existing
        assert conn.execute(text("SELECT name FROM objects WHERE id=:id"),
                            {"id":original_id}).scalar_one()=="QA-WORK-existing-stack-IS"
        assert conn.execute(text("SELECT count(*) FROM system_technologies")).scalar_one()==0
        assert conn.execute(text("SELECT count(*) FROM system_technology_observations")).scalar_one()==0
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == ScriptDirectory.from_config(cfg).get_current_head()
    engine.dispose()
