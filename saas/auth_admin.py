"""Explicit, interactive provisioning for dashboard identities."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import getpass
import uuid

from sqlalchemy.exc import IntegrityError

from saas.database.models import DashboardUser
from saas.database.session import SessionLocal
from saas.tenancy.dashboard_auth import hash_password, normalize_email


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision AEGISOPS dashboard identities.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-user", help="Create a dashboard user; password is prompted securely.")
    create.add_argument("--tenant-id", required=True)
    create.add_argument("--email", required=True)
    args = parser.parse_args()
    if args.command != "create-user":
        parser.error("unsupported command")
    if not args.tenant_id.strip() or len(args.tenant_id.strip()) > 128:
        parser.error("--tenant-id must contain 1 to 128 characters")
    try:
        email = normalize_email(args.email)
    except ValueError:
        parser.error("--email must be a valid email address")
    password = getpass.getpass("New dashboard password (minimum 12 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        parser.error("passwords do not match")
    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        parser.error(str(exc))
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        user = DashboardUser(
            user_id=str(uuid.uuid4()), tenant_id=args.tenant_id.strip(), email=email,
            password_hash=password_hash, is_active=True, created_at=now, updated_at=now,
        )
        db.add(user)
        db.commit()
        print(f"Dashboard user provisioned: {user.user_id} ({email})")
        return 0
    except IntegrityError:
        db.rollback()
        parser.error("a dashboard user with that email already exists")
    finally:
        db.close()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
