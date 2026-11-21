"""Read-only operations preflight detects out-of-sync Alembic revisions.

This test never reads or mutates the real Architecture Hub VPS database.
"""
from pathlib import Path
import importlib.util
import sqlite3

from alembic import command
from alembic.config import Config


def _checker():
    path=Path(__file__).resolve().parents[2]/"scripts"/"check_test_schema.py"
    spec=importlib.util.spec_from_file_location("archhub_test_schema_checker",path)
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_readonly_schema_check_passes_at_head_and_reports_outdated_revision(tmp_path,monkeypatch):
    checker=_checker()
    path=tmp_path/"QA-WORK-schema-preflight.sqlite"
    url="sqlite:///"+str(path)
    monkeypatch.setenv("DATABASE_URL",url)
    root=Path(__file__).resolve().parents[1]
    cfg=Config(str(root/"alembic.ini"))
    cfg.set_main_option("script_location",str(root/"alembic"))
    command.upgrade(cfg,"head")
    passed,code=checker.check(path)
    assert code==0,passed
    assert passed["status"]=="PASS"
    assert passed["actual_revision"]=="0020_business_process_passports"
    assert passed["broken_foreign_key_count"]==0
    assert not passed["missing_indexes"]
    assert not passed["missing_columns"]
    assert not passed["missing_tables"]
    with sqlite3.connect(path) as db:
        db.execute("UPDATE alembic_version SET version_num = ?",("0019_flow_scenarios",))
        db.commit()
    report,code=checker.check(path)
    assert code==2
    assert report["status"]=="BLOCKED"
    assert report["actual_revision"]=="0019_flow_scenarios"
    assert "test Alembic migration" in report["next_action"]
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0]=="0019_flow_scenarios"


def test_readonly_schema_check_never_creates_missing_database(tmp_path):
    checker=_checker()
    nonexistent=tmp_path/"QA-WORK-missing.sqlite"
    report,code=checker.check(nonexistent)
    assert code==3
    assert report["status"]=="BLOCKED"
    assert not nonexistent.exists()
