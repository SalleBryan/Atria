"""Cognito pre-token generation trigger.

Cognito puts custom attributes in the id token but not in the access token, and
the API authorises on the access token. This trigger adds the tenant, the
person and the roles to the access token, so the authoriser can resolve the
caller from the token alone with no lookup on the request path.

Roles are read from the account, not from anything the client sends, and they
are fixed when the account is created (ADR 0015). A role change therefore
takes effect at the next sign-in, which is what the specification says.

Trigger version V2_0, which is what allows access token customisation.
"""

from __future__ import annotations

from typing import Any

from atria_spec import roles as spec
from aws_lambda_powertools import Logger

logger = Logger(service="atria-pre-token")

CUSTOM = "custom:"
CLAIMS = ("tenantId", "personId", "roles")


def claims_from(attributes: dict[str, Any]) -> dict[str, str]:
    """The claims to add, taken from the account's attributes.

    An attribute that is missing is left out rather than added empty: the
    authoriser refuses a token with no tenant, person or roles, which is the
    right answer for an account that is half provisioned.
    """
    claims: dict[str, str] = {}
    for name in CLAIMS:
        value = attributes.get(f"{CUSTOM}{name}") or attributes.get(name)
        if value:
            claims[name] = str(value)

    if "roles" in claims:
        # Drop anything that is not a role we know. A typo in an attribute must
        # not become a permission, and the authoriser refuses unknown roles
        # anyway; filtering here keeps the token itself honest.
        known = [r.strip() for r in claims["roles"].split(",") if r.strip() in spec.ROLES]
        if known:
            claims["roles"] = ",".join(known)
        else:
            del claims["roles"]
    return claims


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Add the tenant, person and role claims to the access token."""
    request = event.get("request") or {}
    attributes = request.get("userAttributes") or {}
    claims = claims_from(attributes)

    logger.info(
        "claims added",
        extra={"claims": sorted(claims), "trigger": event.get("triggerSource")},
    )

    event["response"] = {
        "claimsAndScopeOverrideDetails": {
            "accessTokenGeneration": {"claimsToAddOrOverride": claims},
            "idTokenGeneration": {"claimsToAddOrOverride": claims},
        }
    }
    return event
