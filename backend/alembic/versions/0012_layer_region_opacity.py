"""Store the opacity of each editable architecture layer.

Revision ID: 0012_layer_region_opacity
Revises: 0011_architecture_layer_regions
"""
from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "0012_layer_region_opacity"
down_revision = "0011_architecture_layer_regions"
branch_labels = None
depends_on = None

def upgrade():
    cols = {column["name"] for column in inspect(op.get_bind()).get_columns("architecture_layer_regions")}
    if "opacity" not in cols:
        with op.batch_alter_table("architecture_layer_regions") as batch:
            batch.add_column(sa.Column("opacity", sa.Float(), nullable=False, server_default="0.22"))

def downgrade():
    with op.batch_alter_table("architecture_layer_regions") as batch:
        batch.drop_column("opacity")
