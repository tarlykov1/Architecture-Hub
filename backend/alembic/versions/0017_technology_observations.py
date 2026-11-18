"""Append-only monitoring evidence for technology/version and reachability inventory.

Revision ID: 0017_technology_observations
Revises: 0016_system_technologies
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0017_technology_observations"
down_revision = "0016_system_technologies"
branch_labels = None
depends_on = None


def upgrade():
    existing=set(inspect(op.get_bind()).get_table_names())
    if "system_technology_observations" not in existing:
        op.create_table(
            "system_technology_observations",
            sa.Column("id",sa.Uuid(as_uuid=True),primary_key=True),
            sa.Column("system_id",sa.Uuid(as_uuid=True),
                      sa.ForeignKey("objects.id",ondelete="CASCADE"),nullable=False),
            sa.Column("technology_id",sa.Uuid(as_uuid=True),
                      sa.ForeignKey("system_technologies.id",ondelete="CASCADE"),nullable=False),
            sa.Column("source_id",sa.Uuid(as_uuid=True),
                      sa.ForeignKey("monitoring_sources.id"),nullable=False),
            sa.Column("observed_at",sa.DateTime(timezone=True),nullable=False),
            sa.Column("observed_version",sa.String(120),nullable=False),
            sa.Column("reachable",sa.Boolean(),nullable=True),
            sa.Column("notes",sa.String(1000),nullable=False),
        )
    indexes={i["name"] for i in inspect(op.get_bind()).get_indexes("system_technology_observations")}
    for name,field in [
        ("ix_system_technology_observations_system_id","system_id"),
        ("ix_system_technology_observations_technology_id","technology_id"),
        ("ix_system_technology_observations_source_id","source_id"),
    ]:
        if name not in indexes:op.create_index(name,"system_technology_observations",[field])


def downgrade():
    raise RuntimeError("Technology evidence downgrade disabled: export and review audit history first")
