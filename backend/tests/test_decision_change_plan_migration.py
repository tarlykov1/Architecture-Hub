"""AH-05: additive migration of isolated decision plans on populated SQLite."""
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


def test_existing_decisions_survive_additive_plan_table_migration(tmp_path, monkeypatch):
    url = "sqlite:///" + str(tmp_path / "qa-work-decision-before-plans.db")
    monkeypatch.setenv("DATABASE_URL", url)
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "0020_business_process_passports")
    engine = create_engine(url)
    ids = {x: uuid4().hex for x in ("system", "decision")}
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO objects(id,kind,name,description,status,attributes) "
            "VALUES (:id,'system','QA-WORK-ExistingIS','','active','{}')"
        ), {"id": ids["system"]})
        conn.execute(text(
            "INSERT INTO technical_decisions("
            "id,title,description,system_id,status,author,revision,base_hash,"
            "proposed_vms,proposed_flows,required_services,created_at,updated_at,published_at"
            ") VALUES ("
            ":id,'QA-WORK-LegacyDecision','',:system,'draft','legacy-admin',"
            "1,'','[]','[]','[\"engineer\",\"security\"]',"
            "'2026-11-01 00:00:00','2026-11-01 00:00:00',NULL)"
        ), {"id": ids["decision"], "system": ids["system"]})
        if "technical_decision_change_plans" in inspect(conn).get_table_names():
            assert conn.execute(text(
                "SELECT count(*) FROM technical_decision_change_plans"
            )).scalar_one() == 0
            conn.exec_driver_sql("DROP TABLE technical_decision_change_plans")
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert "technical_decision_change_plans" in inspect(conn).get_table_names()
        assert conn.execute(text(
            "SELECT title FROM technical_decisions WHERE id=:id"
        ), {"id": ids["decision"]}).scalar_one() == "QA-WORK-LegacyDecision"
        assert conn.execute(text(
            "SELECT count(*) FROM technical_decision_change_plans"
        )).scalar_one() == 0
        assert conn.execute(text("PRAGMA integrity_check")).scalar_one() == "ok"
        assert conn.execute(text(
            "SELECT version_num FROM alembic_version"
        )).scalar_one() == ScriptDirectory.from_config(cfg).get_current_head()
    engine.dispose()


def test_migration_does_not_destroy_a_table_already_created_by_orm(tmp_path, monkeypatch):
    url = "sqlite:///" + str(tmp_path / "qa-work-decision-precreated.db")
    monkeypatch.setenv("DATABASE_URL", url)
    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "0020_business_process_passports")
    engine = create_engine(url)
    with engine.begin() as conn:
        assert "technical_decision_change_plans" in inspect(conn).get_table_names()
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA integrity_check")).scalar_one() == "ok"
    engine.dispose()
