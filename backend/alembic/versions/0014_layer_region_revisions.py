"""Revision counters for compare-and-swap editing of architecture regions.

Revision ID: 0014_layer_region_revisions
Revises: 0013_logical_relation_unique
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0014_layer_region_revisions"
down_revision = "0013_logical_relation_unique"
branch_labels = None
depends_on = None


def upgrade():
    cols = {
        column["name"]
        for column in inspect(op.get_bind()).get_columns("architecture_layer_regions")
    }
    if "revision" not in cols:
        with op.batch_alter_table("architecture_layer_regions") as batch:
            # All earlier rows start at revision 1; migration changes no
            # geometry, color, opacity or memberships.
            batch.add_column(sa.Column(
                "revision", sa.Integer(), nullable=False, server_default="1"
            ))


def downgrade():
    cols = {
        column["name"]
        for column in inspect(op.get_bind()).get_columns("architecture_layer_regions")
    }
    if "revision" in cols:
        with op.batch_alter_table("architecture_layer_regions") as batch:
            batch.drop_column("revision")
