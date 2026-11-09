"""CMDB editable class schema, relationship policies and custom fields.

Revision ID: 0008_cmdb_catalog
Revises: 0007_cmdb_registry
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0008_cmdb_catalog"
down_revision = "0007_cmdb_registry"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "cmdb_records" in existing:
        columns = {column["name"] for column in inspect(bind).get_columns("cmdb_records")}
        if "custom_values" not in columns:
            with op.batch_alter_table("cmdb_records") as batch:
                batch.add_column(sa.Column("custom_values", sa.JSON(), nullable=False,
                                           server_default=sa.text("'{}'")))
    if "cmdb_class_policies" not in existing:
        op.create_table(
            "cmdb_class_policies",
            sa.Column("id", sa.String(50), primary_key=True),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("layer", sa.String(30), nullable=False),
            sa.Column("required", sa.JSON(), nullable=False),
            sa.Column("fields", sa.JSON(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "cmdb_relationship_rules" not in existing:
        op.create_table(
            "cmdb_relationship_rules",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("relation_kind", sa.String(60), nullable=False),
            sa.Column("source_class", sa.String(50), nullable=False),
            sa.Column("target_class", sa.String(50), nullable=False),
            sa.Column("mode", sa.String(20), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("description", sa.String(1000), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("relation_kind", "source_class", "target_class",
                                name="uq_cmdb_relation_classes"),
        )


def downgrade():
    op.drop_table("cmdb_relationship_rules")
    op.drop_table("cmdb_class_policies")
    with op.batch_alter_table("cmdb_records") as batch:
        batch.drop_column("custom_values")
