"""Add isolated existing-infrastructure change plans for technical decisions.

This is an ADDITIVE table, not a new column on technical_decisions. The test
server can still use Base.metadata.create_all when Alembic migration flag is
disabled; the new table is created without altering existing production rows.

Revision ID: 0021_technical_decision_change_plans
Revises: 0020_business_process_passports
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0021_technical_decision_change_plans"
down_revision = "0020_business_process_passports"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if "technical_decision_change_plans" not in set(inspect(conn).get_table_names()):
        op.create_table(
            "technical_decision_change_plans",
            sa.Column("decision_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("technical_decisions.id", ondelete="CASCADE"),
                      primary_key=True),
            sa.Column("changes", sa.JSON(), nullable=False),
        )


def downgrade():
    raise RuntimeError(
        "Export existing technical decision change plans before downgrading"
    )
