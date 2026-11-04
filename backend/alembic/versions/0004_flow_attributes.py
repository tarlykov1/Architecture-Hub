"""Create reusable data-attribute dictionary and scoped flow mappings.

Revision ID: 0004_flow_attributes
Revises: 0003_shared_views
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004_flow_attributes"
down_revision = "0003_shared_views"
branch_labels = None
depends_on = None


def upgrade():
    # Separate migration keeps existing infrastructure data untouched.
    connection = op.get_bind()
    if not inspect(connection).has_table('data_attributes'):
        op.create_table(
        "data_attributes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(160), nullable=False),
        sa.Column("name", sa.String(250), nullable=False),
        sa.Column("description", sa.String(4000), nullable=False),
        sa.Column("data_type", sa.String(80), nullable=False),
        sa.Column("sensitivity", sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    if 'ix_data_attributes_code' not in {idx['name'] for idx in inspect(connection).get_indexes('data_attributes')}:
        op.create_index("ix_data_attributes_code", "data_attributes", ["code"])
    if not inspect(connection).has_table('flow_data_uses'):
        op.create_table(
        "flow_data_uses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("flow_id", sa.Uuid(), nullable=False),
        sa.Column("attribute_id", sa.Uuid(), nullable=False),
        sa.Column("process_id", sa.Uuid(), nullable=True),
        sa.Column("consumer_system_id", sa.Uuid(), nullable=True),
        sa.Column("purpose", sa.String(2000), nullable=False),
        sa.Column("verification", sa.String(30), nullable=False),
        sa.ForeignKeyConstraint(["flow_id"], ["data_flows.id"]),
        sa.ForeignKeyConstraint(["attribute_id"], ["data_attributes.id"]),
        sa.ForeignKeyConstraint(["process_id"], ["business_processes.id"]),
        sa.ForeignKeyConstraint(["consumer_system_id"], ["objects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    if 'ix_flow_data_uses_flow_id' not in {idx['name'] for idx in inspect(connection).get_indexes('flow_data_uses')}:
        op.create_index("ix_flow_data_uses_flow_id", "flow_data_uses", ["flow_id"])
    if 'ix_flow_data_uses_attribute_id' not in {idx['name'] for idx in inspect(connection).get_indexes('flow_data_uses')}:
        op.create_index("ix_flow_data_uses_attribute_id", "flow_data_uses", ["attribute_id"])


def downgrade():
    op.drop_index("ix_flow_data_uses_attribute_id", table_name="flow_data_uses")
    op.drop_index("ix_flow_data_uses_flow_id", table_name="flow_data_uses")
    op.drop_table("flow_data_uses")
    op.drop_index("ix_data_attributes_code", table_name="data_attributes")
    op.drop_table("data_attributes")
