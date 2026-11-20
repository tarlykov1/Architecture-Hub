"""Technical decisions, contextual comments and independent service reviews.

Revision ID: 0018_technical_decisions
Revises: 0017_technology_observations
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0018_technical_decisions"
down_revision = "0017_technology_observations"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    names = set(inspect(bind).get_table_names())
    if "technical_decisions" not in names:
        op.create_table("technical_decisions",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("title", sa.String(250), nullable=False),
            sa.Column("description", sa.String(4000), nullable=False),
            sa.Column("system_id", sa.Uuid(as_uuid=True), sa.ForeignKey("objects.id"), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("author", sa.String(120), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("base_hash", sa.String(64), nullable=False),
            sa.Column("proposed_vms", sa.JSON(), nullable=False),
            sa.Column("proposed_flows", sa.JSON(), nullable=False),
            sa.Column("required_services", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "technical_decision_comments" not in names:
        op.create_table("technical_decision_comments",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("decision_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("technical_decisions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("actor", sa.String(120), nullable=False),
            sa.Column("body", sa.String(2000), nullable=False),
            sa.Column("anchor_kind", sa.String(20), nullable=False),
            sa.Column("anchor_id", sa.String(100), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "technical_decision_reviews" not in names:
        op.create_table("technical_decision_reviews",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("decision_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("technical_decisions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("service", sa.String(30), nullable=False),
            sa.Column("actor", sa.String(120), nullable=False),
            sa.Column("verdict", sa.String(30), nullable=False),
            sa.Column("note", sa.String(2000), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    for table, field, index in [
        ("technical_decisions", "system_id", "ix_technical_decisions_system_id"),
        ("technical_decision_comments", "decision_id", "ix_technical_decision_comments_decision_id"),
        ("technical_decision_reviews", "decision_id", "ix_technical_decision_reviews_decision_id"),
    ]:
        existing={x["name"] for x in inspect(bind).get_indexes(table)}
        if index not in existing:
            op.create_index(index, table, [field])


def downgrade():
    raise RuntimeError("Technical-decision history must be exported before downgrade")
