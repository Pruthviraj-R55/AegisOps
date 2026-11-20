"""Local secret detection helpers. Never log the input strings passed here."""

from __future__ import annotations

import re

_SENSITIVE_KEY = re.compile(
    r"(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth(?:orization)?|credential|private[_-]?key)",
    re.IGNORECASE,
)
_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(?:password|passwd|api[_-]?key|access[_-]?token|token|secret|authorization)\s*[:=].*$"),
    re.compile(r"(?i)\bauthorization\s+(?:bearer|basic)\s+\S+"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]+=*"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"(?is)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)


def is_sensitive_key(key: object) -> bool:
    """Return whether an input field name denotes credential material."""
    return isinstance(key, str) and bool(_SENSITIVE_KEY.search(key))


def scrub_string(value: str) -> tuple[str, bool]:
    """Replace recognized credential-like fragments without preserving values."""
    cleaned = value
    for pattern in _SECRET_PATTERNS:
        cleaned = pattern.sub("[REDACTED]", cleaned)
    return cleaned, cleaned != value


def contains_sensitive_key(value: object) -> bool:
    """Inspect structure only; never copy or stringify a raw value."""
    if isinstance(value, dict):
        for key, child in value.items():
            if is_sensitive_key(key) or contains_sensitive_key(child):
                return True
    elif isinstance(value, (list, tuple)):
        return any(contains_sensitive_key(child) for child in value)
    return False
