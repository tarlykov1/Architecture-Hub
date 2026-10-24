"""Incidents registry, additive."""
from alembic import op
from app.incidents import Incident
revision="0002_incidents"
down_revision="0001_baseline"
branch_labels=None
depends_on=None
def upgrade():
    Incident.__table__.create(bind=op.get_bind(),checkfirst=True)
def downgrade():
    raise RuntimeError("Incident data must be archived before rollback")
