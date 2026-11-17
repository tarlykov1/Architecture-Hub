"""Add contract, support SLA and licence entitlement tables without changing existing IS rows.

Revision ID: 0015_system_commercial
Revises: 0014_layer_region_revisions
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0015_system_commercial"
down_revision = "0014_layer_region_revisions"
branch_labels = None
depends_on = None


def upgrade():
    # 0001_baseline calls Base.metadata.create_all for brand-new DBs; avoid
    # duplicate CREATE TABLE while still adding absent tables to older DBs.
    existing = set(inspect(op.get_bind()).get_table_names())
    if "system_contracts" not in existing:
        op.create_table(
        "system_contracts",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("system_id", sa.Uuid(as_uuid=True), sa.ForeignKey("objects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(250), nullable=False),
        sa.Column("contract_number", sa.String(120), nullable=False),
        sa.Column("agreement_type", sa.String(32), nullable=False),
        sa.Column("vendor", sa.String(250), nullable=False),
        sa.Column("contractor", sa.String(250), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("renewal_date", sa.Date(), nullable=True),
        sa.Column("automatic_renewal", sa.Boolean(), nullable=False),
        sa.Column("notice_days", sa.Integer(), nullable=True),
        sa.Column("support_level", sa.String(120), nullable=False),
        sa.Column("support_window", sa.String(120), nullable=False),
        sa.Column("sla_response_hours", sa.Float(), nullable=True),
        sa.Column("sla_availability_percent", sa.Float(), nullable=True),
        sa.Column("support_contact", sa.String(250), nullable=False),
        sa.Column("notes", sa.String(2000), nullable=False),
    )
        op.create_index("ix_system_contracts_system_id", "system_contracts", ["system_id"])
    if "system_licenses" not in existing:
        op.create_table(
        "system_licenses",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("system_id", sa.Uuid(as_uuid=True), sa.ForeignKey("objects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_id", sa.Uuid(as_uuid=True), sa.ForeignKey("system_contracts.id"), nullable=True),
        sa.Column("product", sa.String(250), nullable=False),
        sa.Column("license_type", sa.String(36), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("notes", sa.String(2000), nullable=False),
    )
        op.create_index("ix_system_licenses_system_id", "system_licenses", ["system_id"])
        op.create_index("ix_system_licenses_contract_id", "system_licenses", ["contract_id"])


def downgrade():
    # Never silently drop contract records or compliance-related licence history.
    raise RuntimeError("System commercial data downgrade disabled: export and review records manually")
