"""Add provisioned dashboard identities, server sessions, and login throttles.

Revision ID: 0003_dashboard_auth
Revises: 0002_incident_analyses
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_dashboard_auth"
down_revision = "0002_incident_analyses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_users",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_dashboard_users_tenant_id", "dashboard_users", ["tenant_id"])

    op.create_table(
        "dashboard_sessions",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["dashboard_users.user_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("session_id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_dashboard_sessions_user_id", "dashboard_sessions", ["user_id"])
    op.create_index("ix_dashboard_sessions_expires_at", "dashboard_sessions", ["expires_at"])

    op.create_table(
        "dashboard_login_throttles",
        sa.Column("attempt_key_hash", sa.String(length=64), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("attempt_key_hash"),
    )


def downgrade() -> None:
    op.drop_table("dashboard_login_throttles")
    op.drop_index("ix_dashboard_sessions_expires_at", table_name="dashboard_sessions")
    op.drop_index("ix_dashboard_sessions_user_id", table_name="dashboard_sessions")
    op.drop_table("dashboard_sessions")
    op.drop_index("ix_dashboard_users_tenant_id", table_name="dashboard_users")
    op.drop_table("dashboard_users")
