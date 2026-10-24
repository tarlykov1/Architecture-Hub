"""Baseline of the current Architecture Hub schema.

This baseline creates missing tables without destroying existing SQLite data.
For databases created by older local builds, inspect the schema first: this
revision is NOT a substitute for column-level drift remediation.
"""
from alembic import op
from app.main import Base
from app import knowledge  # register knowledge_links

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)

def downgrade():
    raise RuntimeError("Baseline downgrade disabled to protect architecture records")
