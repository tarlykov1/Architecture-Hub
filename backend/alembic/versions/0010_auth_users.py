"""Add named Architecture Hub user accounts.

Revision ID: 0010_auth_users
Revises: 0009_monitoring_links
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0010_auth_users"
down_revision = "0009_monitoring_links"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(inspect(op.get_bind()).get_table_names())
    if "auth_users" not in existing:
        op.create_table(
            "auth_users",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("username", sa.String(64), nullable=False),
            sa.Column("display_name", sa.String(120), nullable=False),
            sa.Column("password_hash", sa.String(255), nullable=False),
            sa.Column("role", sa.String(32), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("session_version", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    indices = {idx["name"] for idx in inspect(op.get_bind()).get_indexes("auth_users")}
    if "ix_auth_users_username" not in indices:
        op.create_index("ix_auth_users_username", "auth_users", ["username"], unique=True)


def downgrade():
    op.drop_index("ix_auth_users_username", table_name="auth_users")
    op.drop_table("auth_users")
