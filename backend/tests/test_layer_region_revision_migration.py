"""Revision migration preserves prior layer geometry and visual memberships."""
from pathlib import Path
import runpy

import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext


MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0014_layer_region_revisions.py"


def test_layer_region_revision_migration_is_additive_and_idempotent():
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("""
                CREATE TABLE architecture_layer_regions (
                    group_key VARCHAR(130) PRIMARY KEY,
                    x FLOAT NOT NULL,
                    y FLOAT NOT NULL,
                    width FLOAT NOT NULL,
                    height FLOAT NOT NULL,
                    color VARCHAR(7) NOT NULL,
                    opacity FLOAT NOT NULL,
                    members JSON NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            """)
            connection.execute(sa.text("""
                INSERT INTO architecture_layer_regions (
                    group_key,x,y,width,height,color,opacity,members,updated_at
                ) VALUES (
                    'business:test',120,190,540,370,'#2563eb',0.41,'["sys-A"]','2026-11-14'
                )
            """))
        migration = runpy.run_path(str(MIGRATION))
        upgrade = migration["upgrade"]
        with engine.begin() as connection:
            upgrade.__globals__["op"] = Operations(MigrationContext.configure(connection))
            upgrade()
        with engine.connect() as connection:
            result = connection.execute(sa.text("""
                SELECT x,y,width,height,color,opacity,members,revision
                FROM architecture_layer_regions WHERE group_key='business:test'
            """)).first()
            assert tuple(result) == (120,190,540,370,"#2563eb",0.41,'["sys-A"]',1)
        with engine.begin() as connection:
            upgrade.__globals__["op"] = Operations(MigrationContext.configure(connection))
            upgrade()
        assert "revision" in {
            col["name"] for col in sa.inspect(engine).get_columns("architecture_layer_regions")
        }
    finally:
        engine.dispose()
