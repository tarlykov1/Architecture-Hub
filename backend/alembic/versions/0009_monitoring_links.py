"""Stage-one monitoring sources and dashboard links.

Revision ID: 0009_monitoring_links
Revises: 0008_cmdb_catalog
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0009_monitoring_links"
down_revision = "0008_cmdb_catalog"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(inspect(op.get_bind()).get_table_names())
    if "monitoring_sources" not in existing:
        op.create_table(
            "monitoring_sources",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("kind", sa.String(30), nullable=False),
            sa.Column("base_url", sa.String(2048), nullable=False),
            sa.Column("system_id", sa.Uuid(), sa.ForeignKey("objects.id"), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("description", sa.String(1000), nullable=False),
        )
    if "monitoring_links" not in existing:
        op.create_table(
            "monitoring_links",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("source_id", sa.Uuid(), sa.ForeignKey("monitoring_sources.id"), nullable=False),
            sa.Column("target_type", sa.String(20), nullable=False),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("relation_kind", sa.String(24), nullable=False),
            sa.Column("dashboard_url", sa.String(2048), nullable=False),
            sa.Column("external_ref", sa.String(250), nullable=False),
            sa.Column("notes", sa.String(1000), nullable=False),
            sa.UniqueConstraint("source_id", "target_type", "target_id", "relation_kind",
                                name="uq_monitoring_link"),
        )
        op.create_index("ix_monitoring_links_source_id", "monitoring_links", ["source_id"])
        op.create_index("ix_monitoring_links_target_id", "monitoring_links", ["target_id"])


def downgrade():
    op.drop_index("ix_monitoring_links_target_id", table_name="monitoring_links")
    op.drop_index("ix_monitoring_links_source_id", table_name="monitoring_links")
    op.drop_table("monitoring_links")
    op.drop_table("monitoring_sources")
