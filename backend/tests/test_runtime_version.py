from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.main import app
from app.runtime_version import read_version


def test_read_revision_without_modifying_database():
    with create_engine("sqlite://").begin() as conn:
        versions = read_version(conn)
        assert versions["database_heads"] == []
        assert versions["expected_heads"]
        assert not inspect(conn).has_table("alembic_version")
        conn.execute(text("create table alembic_version (version_num varchar(32))"))
        conn.execute(text("insert into alembic_version values ('previous')"))
        assert read_version(conn)["database_heads"] == ["previous"]


def test_runtime_version_requires_admin():
    with TestClient(app) as client:
        url = "/api/auth/runtime-version"
        assert client.get(url).status_code == 401
        for role, status in [("viewer", 403), ("admin", 200)]:
            headers = {"Authorization": f"Bearer ci-{role}-token-123456789012345678901234"}
            assert client.get(url, headers=headers).status_code == status
