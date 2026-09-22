"""Domain errors, each with the status code the API returns for it.

The services raise these. The HTTP layer turns them into a response body, so no
service writes a status code by hand and no error text leaks a record the
caller is not entitled to see.
"""

from __future__ import annotations


class AtriaError(Exception):
    """Base class. `status` is the HTTP status, `code` is the machine readable reason."""

    status: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, detail: dict[str, object] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


class Invalid(AtriaError):
    """The request is malformed or fails a validation rule. 400."""

    status = 400
    code = "invalid_request"


class Unauthenticated(AtriaError):
    """No usable token. 401."""

    status = 401
    code = "unauthenticated"


class Forbidden(AtriaError):
    """Authenticated, but the permission matrix or a guard rule refuses it. 403."""

    status = 403
    code = "forbidden"


class NotFound(AtriaError):
    """No such record within the caller's scope. 404.

    Used for records that exist but are out of scope as well, so that a refusal
    cannot be used to discover that a record exists.
    """

    status = 404
    code = "not_found"


class Conflict(AtriaError):
    """The state no longer allows the action, or a slot unit is taken. 409."""

    status = 409
    code = "conflict"


class TooManyRequests(AtriaError):
    """A rate or quota limit was reached. 429."""

    status = 429
    code = "too_many_requests"
