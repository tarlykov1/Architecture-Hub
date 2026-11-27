"""Register physical locations, inventory details and component assignments."""
from alembic import op
import sqlalchemy as sa

revision = "0022_equipment_locations"
down_revision = "0021_technical_decision_change_plans"
branch_labels = None
depends_on = None


def upgrade():
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    fields = ("city", "site", "building", "room", "rack")
    if "equipment_locations" not in tables:
        op.create_table("equipment_locations", sa.Column("id", sa.Uuid(), primary_key=True),
                        *(sa.Column(name, sa.String(120), nullable=False) for name in fields),
                        sa.UniqueConstraint(*fields))
    if "equipment_profiles" not in tables:
        op.create_table("equipment_profiles",
                        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("network_assets.id"), primary_key=True),
                        sa.Column("location_id", sa.Uuid(), sa.ForeignKey("equipment_locations.id")),
                        sa.Column("inventory_number", sa.String(120), nullable=False),
                        sa.Column("serial_number", sa.String(120), nullable=False),
                        sa.Column("model", sa.String(200), nullable=False))
    if "equipment_components" not in tables:
        op.create_table("equipment_components",
                        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("network_assets.id", ondelete="CASCADE"), primary_key=True),
                        sa.Column("component_id", sa.Uuid(), sa.ForeignKey("infrastructure_items.id", ondelete="CASCADE"), primary_key=True))


def downgrade():
    raise RuntimeError("Export equipment inventory before downgrading")
