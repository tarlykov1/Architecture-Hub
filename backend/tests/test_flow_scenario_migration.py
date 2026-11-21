"""Upgrade an existing populated Architecture Hub database to shared flow scenarios."""
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def test_flow_scenario_migration_keeps_existing_is_and_adds_only_scenario_tables(tmp_path,monkeypatch):
    url="sqlite:///"+str(tmp_path/"qa-work-upgrade-existing-architecture.db")
    monkeypatch.setenv("DATABASE_URL",url)
    root=Path(__file__).resolve().parents[1]
    cfg=Config(str(root/"alembic.ini"))
    cfg.set_main_option("script_location",str(root/"alembic"))
    command.upgrade(cfg,"0018_technical_decisions")
    engine=create_engine(url)
    item_id=uuid4().hex
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO objects (id,kind,name,description,status,attributes) "
            "VALUES (:id,'system','QA-WORK-Existing-Is','','active','{}')"
        ),{"id":item_id})
        # Bootstrap metadata from old migrations may include future model
        # tables. Remove only the new empty ones to simulate old production.
        for table in ("flow_scenario_steps","flow_scenarios"):
            if table in inspect(conn).get_table_names():
                conn.exec_driver_sql("DROP TABLE "+table)
    command.upgrade(cfg,"head")
    with engine.connect() as conn:
        assert {"flow_scenarios","flow_scenario_steps"}.issubset(inspect(conn).get_table_names())
        assert conn.execute(text("SELECT name FROM objects WHERE id=:id"),{"id":item_id}).scalar_one()=="QA-WORK-Existing-Is"
        assert conn.execute(text("SELECT count(*) FROM flow_scenarios")).scalar_one()==0
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()==ScriptDirectory.from_config(cfg).get_current_head()
    engine.dispose()
