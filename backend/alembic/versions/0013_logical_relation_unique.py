"""Enforce uniqueness of *new* logical IS relations without touching legacy data.

Revision ID: 0013_logical_relation_unique
Revises: 0012_layer_region_opacity

A preflight blocks deployment if historical active-kind duplicates already
exist. Nothing is deleted or merged automatically; the operator must review
/api/metamodel/relation-audit and resolve them separately.
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0013_logical_relation_unique"
down_revision = "0012_layer_region_opacity"
branch_labels = None
depends_on = None

INDEX_NAME = "ux_relations_active_logical_direction"
ACTIVE_TYPES = ("integrates_with", "depends_on")
ACTIVE_PREDICATE = "kind IN ('integrates_with', 'depends_on')"


def upgrade():
    connection = op.get_bind()
    if "relations" not in inspect(connection).get_table_names():
        raise RuntimeError("Missing relations table; apply the earlier Architecture Hub migrations first")
    if INDEX_NAME in {item["name"] for item in inspect(connection).get_indexes("relations")}:
        return

    # Verify BEFORE any schema modification. A unique index cannot be
    # constructed over old duplicates, and silently deleting them would
    # destroy architecture facts and audit history.
    duplicate = connection.execute(sa.text("""
        SELECT kind, source_id, target_id, COUNT(*) AS copies
        FROM relations
        WHERE kind IN ('integrates_with', 'depends_on')
        GROUP BY kind, source_id, target_id
        HAVING COUNT(*) > 1
        LIMIT 1
    """)).first()
    if duplicate is not None:
        raise RuntimeError(
            "Logical relation uniqueness migration stopped: duplicate "
            f"{duplicate.kind} source/target pair ({duplicate.copies} rows). "
            "Inspect GET /api/metamodel/relation-audit and reconcile manually "
            "on a backup. No existing relation was modified."
        )
    op.create_index(
        INDEX_NAME, "relations", ["source_id", "target_id", "kind"], unique=True,
        sqlite_where=sa.text(ACTIVE_PREDICATE),
        postgresql_where=sa.text(ACTIVE_PREDICATE),
    )


def downgrade():
    if INDEX_NAME in {item["name"] for item in inspect(op.get_bind()).get_indexes("relations")}:
        op.drop_index(INDEX_NAME, table_name="relations")
