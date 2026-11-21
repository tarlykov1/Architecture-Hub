"""Extend canonical business processes without replacing existing IDs or links.

Revision ID: 0020_business_process_passports
Revises: 0019_flow_scenarios
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0020_business_process_passports"
down_revision = "0019_flow_scenarios"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "business_process_passports" not in tables:
        op.create_table(
            "business_process_passports",
            sa.Column("process_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("business_processes.id", ondelete="CASCADE"),
                      primary_key=True),
            sa.Column("parent_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("business_processes.id"), nullable=True),
            sa.Column("owner", sa.String(200), nullable=False),
            sa.Column("participants", sa.String(1000), nullable=False),
            sa.Column("result", sa.String(2000), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "business_process_steps" not in tables:
        op.create_table(
            "business_process_steps",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("process_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("business_processes.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(250), nullable=False),
            sa.Column("description", sa.String(2000), nullable=False),
            sa.Column("responsible", sa.String(200), nullable=False),
            sa.Column("input", sa.String(2000), nullable=False),
            sa.Column("output", sa.String(2000), nullable=False),
            sa.Column("system_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("objects.id"), nullable=True),
            sa.Column("component_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("infrastructure_items.id"), nullable=True),
            sa.Column("flow_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("data_flows.id"), nullable=True),
            sa.Column("attribute_ids", sa.JSON(), nullable=False),
            sa.UniqueConstraint("process_id","position",
                                name="uq_business_process_step_position"),
        )
    for table, column, name in (
        ("business_process_passports", "parent_id", "ix_business_process_passports_parent_id"),
        ("business_process_steps", "process_id", "ix_business_process_steps_process_id"),
        ("business_process_steps", "system_id", "ix_business_process_steps_system_id"),
        ("business_process_steps", "component_id", "ix_business_process_steps_component_id"),
        ("business_process_steps", "flow_id", "ix_business_process_steps_flow_id"),
    ):
        if name not in {x["name"] for x in inspect(bind).get_indexes(table)}:
            op.create_index(name, table, [column])


def downgrade():
    raise RuntimeError("Business-process history must be exported before downgrade")
