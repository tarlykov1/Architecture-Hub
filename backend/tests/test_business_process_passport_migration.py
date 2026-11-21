"""Additive Alembic upgrade for the canonical BP register on populated SQLite."""
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def _setup(tmp_path,monkeypatch):
    url="sqlite:///"+str(tmp_path/"qa-work-process-migration.db")
    monkeypatch.setenv("DATABASE_URL",url)
    root=Path(__file__).resolve().parents[1]
    cfg=Config(str(root/"alembic.ini"))
    cfg.set_main_option("script_location",str(root/"alembic"))
    command.upgrade(cfg,"0019_flow_scenarios")
    return url,cfg


def test_upgrade_legacy_business_model_preserves_process_and_system_links(tmp_path,monkeypatch):
    url,cfg=_setup(tmp_path,monkeypatch)
    db=create_engine(url)
    ids={kind:uuid4().hex for kind in ("category","process","system","link")}
    with db.begin() as connection:
        connection.execute(text("INSERT INTO business_categories(id,name) VALUES (:id,'QA-WORK-Category')"),
                           {"id":ids["category"]})
        connection.execute(text(
            "INSERT INTO business_processes(id,category_id,name,description) "
            "VALUES (:id,:category,'QA-WORK-ExistingProcess','Existing definition')"
        ),{"id":ids["process"],"category":ids["category"]})
        connection.execute(text(
            "INSERT INTO objects(id,kind,name,description,status,attributes) "
            "VALUES (:id,'system','QA-WORK-ExistingSystem','','active','{}')"
        ),{"id":ids["system"]})
        connection.execute(text(
            "INSERT INTO process_systems(id,process_id,system_id,role) "
            "VALUES (:id,:process,:system,'supporting')"
        ),{"id":ids["link"],"process":ids["process"],"system":ids["system"]})
        # Older versions have no passport or steps. Transitional baseline
        # may pre-create them, so drop only empty future tables on this copy.
        for table in ("business_process_steps","business_process_passports"):
            if table in inspect(connection).get_table_names():
                assert connection.execute(text("SELECT count(*) FROM "+table)).scalar_one()==0
                connection.exec_driver_sql("DROP TABLE "+table)
    command.upgrade(cfg,"head")
    with db.connect() as connection:
        names=set(inspect(connection).get_table_names())
        assert {"business_process_passports","business_process_steps"}.issubset(names)
        assert connection.execute(text("SELECT name FROM business_processes WHERE id=:id"),{
            "id":ids["process"]}).scalar_one()=="QA-WORK-ExistingProcess"
        assert connection.execute(text("SELECT count(*) FROM process_systems WHERE id=:id"),{
            "id":ids["link"]}).scalar_one()==1
        assert connection.execute(text("SELECT count(*) FROM business_process_passports")).scalar_one()==0
        assert connection.execute(text("PRAGMA integrity_check")).scalar_one()=="ok"
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()==ScriptDirectory.from_config(cfg).get_current_head()
    db.dispose()


def test_upgrade_when_orm_created_new_tables_first_is_idempotent(tmp_path,monkeypatch):
    url,cfg=_setup(tmp_path,monkeypatch)
    db=create_engine(url)
    with db.connect() as connection:
        names=set(inspect(connection).get_table_names())
        # Database may already contain future ORM-created tables; migration
        # must inspect and reuse them without deleting existing user data.
        assert "business_process_passports" in names
    command.upgrade(cfg,"head")
    with db.connect() as connection:
        assert connection.execute(text("PRAGMA integrity_check")).scalar_one()=="ok"
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()==ScriptDirectory.from_config(cfg).get_current_head()
    db.dispose()
