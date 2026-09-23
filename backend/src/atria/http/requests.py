"""Reading an API Gateway request.

The authoriser has already verified the token and resolved the person, the
tenant and the roles; it passes them to the service in the request context.
This module rebuilds the Principal from that context and refuses a request that
arrives without one, so no service ever parses a token itself.
"""

from __future__ import annotations

import json
from typing import Any

from atria.core.errors import Invalid, Unauthenticated
from atria.core.principal import Principal


def principal_from(event: dict[str, Any]) -> Principal:
    """Rebuild the caller from the authoriser context.

    API Gateway flattens authoriser context to strings, so the roles arrive as
    a comma separated list and the booleans as "true" or "false".
    """
    context = (event.get("requestContext") or {}).get("authorizer") or {}
    person_id = context.get("personId")
    tenant_id = context.get("tenantId")
    roles = context.get("roles")
    if not person_id or not tenant_id or not roles:
        raise Unauthenticated("the request carries no resolved caller")

    return Principal(
        person_id=str(person_id),
        tenant_id=str(tenant_id),
        roles=tuple(r for r in str(roles).split(",") if r),
        patient_profile_id=_optional(context.get("patientProfileId")),
        staff_id=_optional(context.get("staffId")),
        clinic_id=_optional(context.get("clinicId")),
        phone_verified=str(context.get("phoneVerified", "")).lower() == "true",
        languages=tuple(x for x in str(context.get("languages", "")).split(",") if x),
    )


def json_body(event: dict[str, Any]) -> dict[str, Any]:
    """Parse a JSON object body, or raise Invalid."""
    raw = event.get("body")
    if not raw:
        raise Invalid("a JSON body is required")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise Invalid("the body is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise Invalid("the body must be a JSON object")
    return parsed


def path_parameter(event: dict[str, Any], name: str) -> str:
    value = (event.get("pathParameters") or {}).get(name)
    if not value:
        raise Invalid(f"the path parameter {name} is required")
    return str(value)


def query_parameter(event: dict[str, Any], name: str, default: str | None = None) -> str | None:
    return (event.get("queryStringParameters") or {}).get(name, default)


def header(event: dict[str, Any], name: str) -> str | None:
    """One request header, found whatever case the client sent it in.

    HTTP header names are case insensitive and API Gateway passes through
    whatever arrived, so matching on an exact spelling would work with one
    client and quietly fail with the next.

    Returns the value even when it is empty, so a caller can tell a header
    that arrived blank from one that never arrived. A client that sends an
    empty Idempotency-Key meant to send a key, and treating that as absent
    would quietly book without the protection it asked for.
    """
    wanted = name.lower()
    for key, value in (event.get("headers") or {}).items():
        if str(key).lower() == wanted:
            return str(value) if value is not None else ""
    return None


def _optional(value: object) -> str | None:
    """Authoriser context cannot carry null, so an empty string means absent."""
    text = str(value) if value is not None else ""
    return text or None
