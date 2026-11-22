"""Schema migration dry-runs never mutate the source Architecture Hub SQLite."""
from pathlib import Path
from uuid import uuid4
import importlib.util
import sqlite3

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine

from app.main import Base
from app import knowledge  # register all architecture tables before create_all


def _runner():
    source=Path(__file__).resolve().parents[2]/"scripts"/"dry_run_test_migrations.py"
    spec=importlib.util.spec_from_file_location("archhub_copy_dry_run",source)
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _config(url: str):
    root=Path(__file__).resolve().parents[1]
    cfg=Config(str(root/"alembic.ini"))
    cfg.set_main_option("script_location",str(root/"alembic"))
    return cfg


def _scenario_database(path:Path,monkeypatch):
    url="sqlite:///"+str(path)
    monkeypatch.setenv("DATABASE_URL",url)
    command.upgrade(_config(url),"0019_flow_scenarios")
    obj_id=uuid4().hex
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO objects(id,kind,name,description,status,attributes) "
            "VALUES (?,'system','QA-WORK-existing-before-copy','','active','{}')",(obj_id,)
        )
    return url,obj_id


def test_copy_migration_upgrades_old_revision_and_preserves_original(tmp_path,monkeypatch):
    path=tmp_path/"QA-WORK-upgrade-old.sqlite"
    _url,obj_id=_scenario_database(path,monkeypatch)
    run=_runner()
    report,code=run.dry_run(path)
    assert code==0,report
    assert report["status"]=="PASS"
    assert report["mode"]=="temporary_copy_only"
    assert report["source_revision"]=="0019_flow_scenarios"
    assert report["target_revision"]=="0021_technical_decision_change_plans"
    assert report["copy_revision"]==report["target_revision"]
    assert report["existing_table_row_counts_preserved"] is True
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0]=="0019_flow_scenarios"
        assert db.execute("SELECT name FROM objects WHERE id=?",(obj_id,)).fetchone()[0]=="QA-WORK-existing-before-copy"


def test_copy_migration_handles_bootstrap_created_future_tables(tmp_path,monkeypatch):
    path=tmp_path/"QA-WORK-bootstrap-before-Alembic.sqlite"
    url,obj_id=_scenario_database(path,monkeypatch)
    # Simulate actual test VPS: the application bootstrapped the latest schema
    # through create_all but Alembic remains at an earlier revision.
    engine=create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    report,code=_runner().dry_run(path)
    assert code==0,report
    assert report["status"]=="PASS"
    assert report["existing_table_row_counts_preserved"] is True
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0]=="0019_flow_scenarios"
        assert db.execute("SELECT name FROM objects WHERE id=?",(obj_id,)).fetchone()[0]=="QA-WORK-existing-before-copy"


def test_copy_migration_refuses_unversioned_database_without_stamping(tmp_path):
    path=tmp_path/"QA-WORK-unversioned.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE retained (id INTEGER PRIMARY KEY, note TEXT)")
        db.execute("INSERT INTO retained VALUES(1,'QA-WORK-unchanged')")
    report,code=_runner().dry_run(path)
    assert code==2,report
    assert report["status"]=="BLOCKED"
    assert "Alembic baseline" in report["reason"]
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT note FROM retained WHERE id=1").fetchone()[0]=="QA-WORK-unchanged"
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "alembic_version" not in tables


def test_copy_migration_never_creates_missing_source_file(tmp_path):
    missing=tmp_path/"QA-WORK-not-present.sqlite"
    report,code=_runner().dry_run(missing)
    assert code==3,report
    assert report["status"]=="BLOCKED"
    assert not missing.exists()
