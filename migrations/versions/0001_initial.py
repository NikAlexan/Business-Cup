"""Guest-owned aggregates, durable jobs and idempotency ledger.

Revision ID: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "guest_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("subject_id", sa.String(36), nullable=False, unique=True),
        sa.Column("creation_key", sa.String(64), nullable=False, unique=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "resources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "guest_id", sa.String(36), sa.ForeignKey("guest_sessions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_resource_owner_kind_created", "resources", ["guest_id", "kind", "created_at", "id"])
    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "guest_id", sa.String(36), sa.ForeignKey("guest_sessions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("lease_until", sa.Float()),
        sa.Column("lease_token", sa.String(36)),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_analysis_jobs_guest_id", "analysis_jobs", ["guest_id"])
    op.create_index("ix_analysis_jobs_status", "analysis_jobs", ["status"])
    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "guest_id", sa.String(36), sa.ForeignKey("guest_sessions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(32), nullable=False),
    )
    op.create_index("ix_idempotency_keys_guest_id", "idempotency_keys", ["guest_id"])


def downgrade():
    for table in ("idempotency_keys", "analysis_jobs", "resources", "guest_sessions"):
        op.drop_table(table)
