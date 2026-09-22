"""The API authoriser.

A request authoriser on every route. It verifies the token, resolves the
tenant, the person and the roles, and returns an allow or deny policy with the
caller in the context, so no service parses a token itself.

It answers who the caller is. Whether this caller may act on this record is
answered in the service, where the subject of the action is known: a
receptionist may read appointments, but only the ones in their clinic. The
service calls core.permissions.require with the subject to decide that.
"""

from __future__ import annotations

import os
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import permissions
from atria.core.errors import Unauthenticated
from atria.core.principal import Principal
from atria.services.authoriser import token as token_module

logger = Logger(service="atria-authoriser")

ISSUER = os.environ.get("COGNITO_ISSUER", "")
AUDIENCES = tuple(a for a in os.environ.get("COGNITO_CLIENT_IDS", "").split(",") if a)


def bearer_token(event: dict[str, Any]) -> str:
    """Pull the token out of the Authorization header, whatever its casing."""
    headers = event.get("headers") or {}
    for name, value in headers.items():
        if name.lower() == "authorization":
            parts = str(value).split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                return parts[1]
            return str(value)
    return ""


def policy(
    *, allow: bool, principal_id: str, method_arn: str, context: dict[str, str]
) -> dict[str, Any]:
    """An API Gateway authoriser policy.

    The resource is the whole API rather than the one method, so the policy can
    be cached across routes for the caller. The permission check itself happens
    per request in the service, which is where the subject of the action is
    known.
    """
    api_arn = _api_wildcard(method_arn)
    return {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": "Allow" if allow else "Deny",
                    "Resource": api_arn,
                }
            ],
        },
        "context": context,
    }


def _api_wildcard(method_arn: str) -> str:
    """Turn one method ARN into every method on that stage."""
    parts = method_arn.split("/")
    if len(parts) < 2:
        return method_arn
    return "/".join(parts[:2]) + "/*"


def context_for(principal: Principal) -> dict[str, str]:
    """Authoriser context is string only, so everything is flattened."""
    return {
        "personId": principal.person_id,
        "tenantId": principal.tenant_id,
        "roles": ",".join(principal.roles),
        "patientProfileId": principal.patient_profile_id or "",
        "staffId": principal.staff_id or "",
        "clinicId": principal.clinic_id or "",
        "phoneVerified": "true" if principal.phone_verified else "false",
        "languages": ",".join(principal.languages),
        "permissions": ",".join(sorted(permissions.granted_to(principal))),
    }


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """API Gateway request authoriser."""
    method_arn = str(event.get("methodArn", ""))
    try:
        claims = token_module.verify(bearer_token(event), issuer=ISSUER, audiences=AUDIENCES)
        principal = Principal(
            person_id=claims.person_id,
            tenant_id=claims.tenant_id,
            roles=claims.roles,
        )
    except Unauthenticated as exc:
        logger.info("denied", extra={"reason": exc.message})
        # A deny policy rather than a raised Unauthorized, so the caller gets
        # 403 with no detail about which check failed.
        return policy(allow=False, principal_id="anonymous", method_arn=method_arn, context={})
    except ValueError as exc:
        # An unknown role in the token means the account is misprovisioned.
        logger.warning("denied", extra={"reason": str(exc)})
        return policy(allow=False, principal_id="anonymous", method_arn=method_arn, context={})

    logger.append_keys(tenant_id=principal.tenant_id, person_id=principal.person_id)
    logger.info("allowed", extra={"roles": list(principal.roles)})
    return policy(
        allow=True,
        principal_id=principal.person_id,
        method_arn=method_arn,
        context=context_for(principal),
    )
