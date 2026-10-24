"""Team-shared workspace views."""
from alembic import op
from app.views import SharedView
revision="0003_shared_views"
down_revision="0002_incidents"
branch_labels=None
depends_on=None
def upgrade():
    SharedView.__table__.create(bind=op.get_bind(),checkfirst=True)
def downgrade():
    raise RuntimeError("Shared views must be exported before downgrade")
