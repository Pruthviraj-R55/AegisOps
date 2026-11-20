"""Password, session-cookie, CSRF, and login-throttle primitives for dashboard users."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import os
import re
import secrets
import uuid

from fastapi import Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from saas.api.errors import ProblemException
from saas.config import Settings, get_settings
from saas.database.models import DashboardLoginThrottle, DashboardSession, DashboardUser

SESSION_COOKIE = "aegisops_session"
CSRF_COOKIE = "aegisops_csrf"
CSRF_HEADER = "x-csrf-token"
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_SCRYPT_N = 1 << 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_LEN = 64


@dataclass(frozen=True)
class DashboardContext:
    tenant_id: str
    user_id: str
    session_id: str


def normalize_email(value: str) -> str:
    email = value.strip().casefold()
    if len(email) > 320 or not _EMAIL_RE.fullmatch(email):
        raise ValueError("email address is invalid")
    return email


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 12 or len(password) > 1024:
        raise ValueError("password must contain between 12 and 1024 characters")
    salt = os.urandom(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P,
        dklen=_SCRYPT_LEN, maxmem=64 * 1024 * 1024,
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N, _SCRYPT_R, _SCRYPT_P,
        base64.urlsafe_b64encode(salt).decode("ascii").rstrip("="),
        base64.urlsafe_b64encode(derived).decode("ascii").rstrip("="),
    )


def _burn_password_work(password: str) -> None:
    hashlib.scrypt(
        password.encode("utf-8")[:1024], salt=b"aegisops-login-salt", n=_SCRYPT_N,
        r=_SCRYPT_R, p=_SCRYPT_P, dklen=_SCRYPT_LEN, maxmem=64 * 1024 * 1024,
    )


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        algorithm, n_raw, r_raw, p_raw, salt_raw, digest_raw = (stored_hash or "").split("$", 5)
        n, r, p = int(n_raw), int(r_raw), int(p_raw)
        if algorithm != "scrypt" or n < 2**14 or n > 2**18 or r < 1 or r > 16 or p < 1 or p > 4:
            raise ValueError("unsupported password hash")
        salt = base64.urlsafe_b64decode(salt_raw + "=" * (-len(salt_raw) % 4))
        expected = base64.urlsafe_b64decode(digest_raw + "=" * (-len(digest_raw) % 4))
        actual = hashlib.scrypt(
            password.encode("utf-8")[:1024], salt=salt, n=n, r=r, p=p,
            dklen=len(expected), maxmem=256 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeError):
        _burn_password_work(password)
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def make_login_attempt_keys(email: str, remote_host: str | None) -> tuple[str, str]:
    normalized = email.strip().casefold()[:320]
    host = (remote_host or "unknown")[:128]
    ip_key = hashlib.sha256(f"ip\0{host}".encode("utf-8")).hexdigest()
    account_key = hashlib.sha256(f"account\0{normalized}".encode("utf-8")).hexdigest()
    return ip_key, account_key


def login_is_throttled(db: Session, key_hash: str, settings: Settings, now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    row = db.query(DashboardLoginThrottle).filter_by(attempt_key_hash=key_hash).first()
    if row is None or row.blocked_until is None:
        return False
    blocked_until = _utc(row.blocked_until)
    return blocked_until > current


def record_failed_login(db: Session, key_hash: str, settings: Settings, now: datetime | None = None) -> None:
    current = now or datetime.now(timezone.utc)
    row = (
        db.query(DashboardLoginThrottle)
        .filter_by(attempt_key_hash=key_hash)
        .with_for_update()
        .first()
    )
    if row is None:
        row = DashboardLoginThrottle(
            attempt_key_hash=key_hash, failure_count=0,
            window_started_at=current, blocked_until=None,
        )
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            row = (
                db.query(DashboardLoginThrottle)
                .filter_by(attempt_key_hash=key_hash)
                .with_for_update()
                .first()
            )
    if row is None:
        raise RuntimeError("login throttle row could not be created")
    started_at = _utc(row.window_started_at)
    if current - started_at >= timedelta(seconds=settings.dashboard_login_window_seconds):
        row.failure_count = 0
        row.window_started_at = current
        row.blocked_until = None
    row.failure_count += 1
    if row.failure_count >= settings.dashboard_login_max_attempts:
        row.blocked_until = current + timedelta(seconds=settings.dashboard_login_lock_seconds)
    db.commit()


def clear_login_failures(db: Session, key_hash: str) -> None:
    db.query(DashboardLoginThrottle).filter_by(attempt_key_hash=key_hash).delete(synchronize_session=False)
    db.commit()


def new_session(db: Session, user: DashboardUser, settings: Settings) -> tuple[DashboardSession, str, str]:
    raw_session = secrets.token_urlsafe(32)
    raw_csrf = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    row = DashboardSession(
        session_id=str(uuid.uuid4()), token_hash=token_hash(raw_session), csrf_hash=token_hash(raw_csrf),
        user_id=user.user_id, tenant_id=user.tenant_id, created_at=now,
        expires_at=now + timedelta(seconds=settings.dashboard_session_ttl_seconds), revoked_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, raw_session, raw_csrf


def authenticate_dashboard_session(
    request: Request,
    db: Session,
    *,
    require_csrf: bool = True,
) -> tuple[DashboardContext, DashboardUser, DashboardSession]:
    settings = get_settings()
    if settings.aegisops_env.lower() == "production" and request.url.scheme != "https":
        raise ProblemException(400, "https_required", "HTTPS required", "Dashboard sessions require HTTPS.")
    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token:
        raise ProblemException(401, "unauthenticated", "Unauthorized", "Sign in is required.")
    now = datetime.now(timezone.utc)
    row = (
        db.query(DashboardSession)
        .filter_by(token_hash=token_hash(raw_token), revoked_at=None)
        .first()
    )
    if row is None or _utc(row.expires_at) <= now:
        raise ProblemException(401, "unauthenticated", "Unauthorized", "Session is invalid or expired.")
    user = db.query(DashboardUser).filter_by(user_id=row.user_id).first()
    if user is None or not user.is_active or user.tenant_id != row.tenant_id:
        raise ProblemException(401, "unauthenticated", "Unauthorized", "Session is invalid or expired.")
    if require_csrf and request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
        csrf_header = request.headers.get(CSRF_HEADER, "")
        if not csrf_cookie or not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
            raise ProblemException(403, "csrf_failed", "Forbidden", "CSRF validation failed.")
        if not hmac.compare_digest(token_hash(csrf_header), row.csrf_hash):
            raise ProblemException(403, "csrf_failed", "Forbidden", "CSRF validation failed.")
    return DashboardContext(tenant_id=user.tenant_id, user_id=user.user_id, session_id=row.session_id), user, row


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
