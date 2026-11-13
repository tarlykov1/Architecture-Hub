"""Persistent architecture layer area geometry and visual memberships.

Revision ID: 0011_architecture_layer_regions
Revises: 0010_auth_users
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0011_architecture_layer_regions"
down_revision = "0010_auth_users"
branch_labels = None
depends_on = None

def upgrade():
    if "architecture_layer_regions" in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "architecture_layer_regions",
        sa.Column("group_key", sa.String(130), primary_key=True),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("width", sa.Float(), nullable=False),
        sa.Column("height", sa.Float(), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("members", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

def downgrade():
    op.drop_table("architecture_layer_regions")
