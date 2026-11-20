"""RFC 7807 Problem Details error definitions and responses."""

import uuid
from typing import Any, Optional
from fastapi.responses import JSONResponse


class ProblemException(Exception):
    """Exception that serializes to RFC 7807 application/problem+json."""

    def __init__(
        self,
        status_code: int,
        code: str,
        title: str,
        detail: str,
        type_: str = "about:blank",
        request_id: Optional[str] = None,
        extra: Optional[dict[str, Any]] = None,
    ):
        self.status_code = status_code
        self.code = code
        self.title = title
        self.detail = detail
        self.type_ = type_
        self.request_id = request_id or f"req-{uuid.uuid4().hex[:12]}"
        self.extra = extra or {}
        super().__init__(detail)


def problem_response(
    status_code: int,
    code: str,
    title: str,
    detail: str,
    type_: str = "about:blank",
    request_id: Optional[str] = None,
) -> JSONResponse:
    """Generate an RFC 7807 application/problem+json response."""
    content: dict[str, Any] = {
        "type": type_,
        "title": title,
        "status": status_code,
        "code": code,
        "detail": detail,
        "request_id": request_id or f"req-{uuid.uuid4().hex[:12]}",
    }
    return JSONResponse(
        status_code=status_code,
        content=content,
        media_type="application/problem+json",
    )
