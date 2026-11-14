"""Anonymous daily processing budgets, retained after guest deletion."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "daily_budgets",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False),
    )


def downgrade():
    op.drop_table("daily_budgets")
