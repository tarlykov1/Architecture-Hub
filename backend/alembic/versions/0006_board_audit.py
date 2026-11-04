"""Persist audited Architecture Board change batches.

Revision ID: 0006_board_audit
Revises: 0005_network_paths
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0006_board_audit"
down_revision = "0005_network_paths"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if not inspect(bind).has_table("board_audit"):
        op.create_table(
            "board_audit",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
            sa.Column("reason", sa.String(1000), nullable=False),
            sa.Column("actor", sa.String(100), nullable=False),
            sa.Column("changes", sa.JSON(), nullable=False),
        )


def downgrade():
    op.drop_table("board_audit")
