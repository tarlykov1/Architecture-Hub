"""Add per-IS technology/version records without altering existing architecture facts.

Revision ID: 0016_system_technologies
Revises: 0015_system_commercial
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0016_system_technologies"
down_revision = "0015_system_commercial"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    # The transitional baseline may have created the table via metadata.
    # On an existing database, create only the missing table.
    if "system_technologies" not in inspect(conn).get_table_names():
        op.create_table(
            "system_technologies",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("system_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("objects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("component_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("infrastructure_items.id"), nullable=True),
            sa.Column("name", sa.String(250), nullable=False),
            sa.Column("category", sa.String(36), nullable=False),
            sa.Column("version", sa.String(120), nullable=False),
            sa.Column("environment", sa.String(24), nullable=False),
            sa.Column("vendor", sa.String(250), nullable=False),
            sa.Column("lifecycle", sa.String(24), nullable=False),
            sa.Column("support_end_date", sa.Date(), nullable=True),
            sa.Column("verification", sa.String(24), nullable=False),
            sa.Column("source", sa.String(500), nullable=False),
            sa.Column("notes", sa.String(2000), nullable=False),
        )
    existing = {item["name"] for item in inspect(conn).get_indexes("system_technologies")}
    for name, fields in [
        ("ix_system_technologies_system_id", ["system_id"]),
        ("ix_system_technologies_component_id", ["component_id"]),
    ]:
        if name not in existing:
            op.create_index(name, "system_technologies", fields)


def downgrade():
    raise RuntimeError(
        "Technology inventory downgrade disabled to protect recorded versions. "
        "Export and reconcile data before any destructive schema change."
    )
