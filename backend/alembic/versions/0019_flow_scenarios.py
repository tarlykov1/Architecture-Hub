"""Shared ordered scenarios for canonical technical data flows.

Revision ID: 0019_flow_scenarios
Revises: 0018_technical_decisions
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0019_flow_scenarios"
down_revision = "0018_technical_decisions"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    tables = set(inspect(conn).get_table_names())
    if "flow_scenarios" not in tables:
        op.create_table(
            "flow_scenarios",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False, unique=True),
            sa.Column("description", sa.String(2000), nullable=False),
            sa.Column("process_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("business_processes.id"), nullable=True),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "flow_scenario_steps" not in tables:
        op.create_table(
            "flow_scenario_steps",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("scenario_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("flow_scenarios.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("flow_id", sa.Uuid(as_uuid=True),
                      sa.ForeignKey("data_flows.id"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("reply", sa.Boolean(), nullable=False),
            sa.Column("note", sa.String(1000), nullable=False),
            sa.UniqueConstraint("scenario_id", "position",
                                name="uq_flow_scenario_step_position"),
        )
    for table, column, name in (
        ("flow_scenarios", "process_id", "ix_flow_scenarios_process_id"),
        ("flow_scenario_steps", "scenario_id", "ix_flow_scenario_steps_scenario_id"),
        ("flow_scenario_steps", "flow_id", "ix_flow_scenario_steps_flow_id"),
    ):
        current = {item["name"] for item in inspect(conn).get_indexes(table)}
        if name not in current:
            op.create_index(name, table, [column])


def downgrade():
    raise RuntimeError("Export architecture scenarios before downgrading")
