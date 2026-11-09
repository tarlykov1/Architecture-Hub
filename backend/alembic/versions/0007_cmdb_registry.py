"""CMDB record overlay, verification and immutable audit history.

Revision ID: 0007_cmdb_registry
Revises: 0006_board_audit
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0007_cmdb_registry"
down_revision = "0006_board_audit"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "cmdb_records" not in existing:
        op.create_table(
            "cmdb_records",
            sa.Column("ci_id", sa.String(90), primary_key=True),
            sa.Column("lifecycle", sa.String(30), nullable=False),
            sa.Column("owner", sa.String(180), nullable=False),
            sa.Column("technical_owner", sa.String(180), nullable=False),
            sa.Column("criticality", sa.String(24), nullable=False),
            sa.Column("source_system", sa.String(120), nullable=False),
            sa.Column("source_record_id", sa.String(180), nullable=False),
            sa.Column("verification_status", sa.String(24), nullable=False),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("evidence", sa.String(2000), nullable=False),
            sa.Column("notes", sa.String(2000), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "cmdb_record_audit" not in existing:
        op.create_table(
            "cmdb_record_audit",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("ci_id", sa.String(90), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(24), nullable=False),
            sa.Column("actor_role", sa.String(40), nullable=False),
            sa.Column("reason", sa.String(1000), nullable=False),
            sa.Column("before", sa.JSON(), nullable=False),
            sa.Column("after", sa.JSON(), nullable=False),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_cmdb_record_audit_ci_id", "cmdb_record_audit", ["ci_id"])


def downgrade():
    op.drop_index("ix_cmdb_record_audit_ci_id", table_name="cmdb_record_audit")
    op.drop_table("cmdb_record_audit")
    op.drop_table("cmdb_records")
