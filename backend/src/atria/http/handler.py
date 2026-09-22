"""The wrapper every service handler is written inside.

It turns a domain error into the right status code, keeps unexpected failures
from leaking a stack trace to the caller, and logs with the request id so a
report from a clinic can be traced to one invocation.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aws_lambda_powertools import Logger

from atria.core.errors import AtriaError
from atria.http import responses

Event = dict[str, Any]
Handler = Callable[[Event, Any], dict[str, Any]]

logger = Logger(service="atria")


def api(func: Handler) -> Handler:
    """Wrap an API Gateway handler."""

    def wrapper(event: Event, context: Any) -> dict[str, Any]:
        request_id = getattr(context, "aws_request_id", None)
        try:
            return func(event, context)
        except AtriaError as exc:
            # Expected: the caller asked for something the rules refuse.
            # "reason" rather than "message": the log record reserves that name.
            logger.info(
                "refused",
                extra={"code": exc.code, "status": exc.status, "reason": exc.message},
            )
            return responses.error(exc, request_id=request_id)
        except Exception:
            # Unexpected: log it in full, tell the caller nothing.
            logger.exception("unhandled failure")
            return responses.internal_error(request_id)

    wrapper.__name__ = getattr(func, "__name__", "handler")
    wrapper.__doc__ = func.__doc__
    return wrapper
