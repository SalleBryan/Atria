"""API Gateway responses.

Every service returns through here, so status codes, headers and error shapes
are identical across the API. An error body carries a code and a message and
never the record that was refused: a 404 and a 403 must not be distinguishable
in a way that reveals whether a record exists (see core.errors.NotFound).
"""

from __future__ import annotations

import json
from typing import Any

from atria.core.errors import AtriaError

JSON_TYPE = "application/json"

SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def response(
    status: int,
    body: object | None = None,
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """An API Gateway proxy response."""
    out: dict[str, Any] = {
        "statusCode": status,
        "headers": {"Content-Type": JSON_TYPE, **SECURITY_HEADERS, **(headers or {})},
        "isBase64Encoded": False,
    }
    out["body"] = "" if body is None else json.dumps(body, separators=(",", ":"), default=str)
    return out


def ok(body: object) -> dict[str, Any]:
    return response(200, body)


def created(body: object, *, location: str | None = None) -> dict[str, Any]:
    return response(201, body, headers={"Location": location} if location else None)


def no_content() -> dict[str, Any]:
    return response(204)


def error(exc: AtriaError, *, request_id: str | None = None) -> dict[str, Any]:
    """Render a domain error. The detail is safe to return by construction."""
    body: dict[str, Any] = {"code": exc.code, "message": exc.message}
    if exc.detail:
        body["detail"] = exc.detail
    if request_id:
        body["requestId"] = request_id
    return response(exc.status, body)


def internal_error(request_id: str | None = None) -> dict[str, Any]:
    """For anything that is not an AtriaError. Says nothing about the cause."""
    body = {"code": "internal_error", "message": "the request could not be completed"}
    if request_id:
        body["requestId"] = request_id
    return response(500, body)
