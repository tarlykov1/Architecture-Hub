"""Infrastructure/security registry and declared per-flow passage.

Revision ID: 0004_network_paths
Revises: 0003_shared_views
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0004_network_paths"
down_revision = "0003_shared_views"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    # Existing baseline calls create_all, so allow tables already created there.
    if not inspect(bind).has_table("network_assets"):
        op.create_table(
            "network_assets",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("name", sa.String(250), nullable=False),
            sa.Column("kind", sa.String(40), nullable=False),
            sa.Column("description", sa.String(2000), nullable=False),
            sa.Column("address", sa.String(120), nullable=False),
            sa.Column("verification", sa.String(30), nullable=False),
        )
    if "ix_network_assets_name" not in {x["name"] for x in inspect(bind).get_indexes("network_assets")}:
        op.create_index("ix_network_assets_name", "network_assets", ["name"])
    if not inspect(bind).has_table("flow_network_hops"):
        op.create_table(
            "flow_network_hops",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("flow_id", sa.Uuid(), sa.ForeignKey("data_flows.id"), nullable=False),
            sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("network_assets.id"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("notes", sa.String(2000), nullable=False),
            sa.Column("verification", sa.String(30), nullable=False),
        )
    for column in ("flow_id", "asset_id"):
        name = "ix_flow_network_hops_" + column
        if name not in {x["name"] for x in inspect(bind).get_indexes("flow_network_hops")}:
            op.create_index(name, "flow_network_hops", [column])


def downgrade():
    op.drop_index("ix_flow_network_hops_asset_id", table_name="flow_network_hops")
    op.drop_index("ix_flow_network_hops_flow_id", table_name="flow_network_hops")
    op.drop_table("flow_network_hops")
    op.drop_index("ix_network_assets_name", table_name="network_assets")
    op.drop_table("network_assets")
