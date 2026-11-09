"""Persist network-container geometry in per-system board layouts.

Revision ID: 0008_board_network_rectangles
Revises: 0007_cmdb_registry
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0008_board_network_rectangles"
down_revision = "0007_cmdb_registry"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {col["name"] for col in inspect(bind).get_columns("board_layouts")}
    if "network_rectangles" not in columns:
        op.add_column("board_layouts", sa.Column(
            "network_rectangles", sa.JSON(), nullable=False,
            server_default=sa.text("'{}'")))


def downgrade():
    bind = op.get_bind()
    columns = {col["name"] for col in inspect(bind).get_columns("board_layouts")}
    if "network_rectangles" in columns:
        op.drop_column("board_layouts", "network_rectangles")
