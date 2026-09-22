"""Cognito pre-token generation trigger.

Cognito puts custom attributes in the id token but not in the access token, and
the API authorises on the access token. This trigger writes who the caller is
into both tokens, so the authoriser can resolve them from the token alone with
no query on the request path (ADR 0017).

Claims come from the person record where there is one: the staff membership is
the source of truth for roles, the clinic bounds every clinic scoped
permission, and the patient profile is what "own" means for a patient. Where
there is no person record yet, which is the case between sign-up and profile
completion, the account's own attributes are used instead, and a claim that
cannot be filled is left out. The authoriser refuses a token with no tenant,
person or roles, which is the right answer for an account that is not yet
provisioned.

Roles reaching the token here is what makes a role change take effect at the
next sign-in and not before (ADR 0015).

Trigger version V2_0, which is what allows access token customisation.
"""

from __future__ import annotations

from typing import Any

from atria_spec import roles as spec
from aws_lambda_powertools import Logger

from atria.data.people import People
from atria.data.repository import Repository

logger = Logger(service="atria-pre-token")

CUSTOM = "custom:"
ATTRIBUTE_CLAIMS = ("tenantId", "personId", "roles")

_people: People | None = None


def people() -> People:
    """Built on first use, then reused for the life of the container."""
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


def known_roles(value: str) -> list[str]:
    """Only roles the specification defines.

    A typo in an attribute or a stale record must not become a permission, and
    the authoriser refuses unknown roles anyway; filtering here keeps the token
    itself honest.
    """
    return [r.strip() for r in value.split(",") if r.strip() in spec.ROLES]


def claims_from_attributes(attributes: dict[str, Any]) -> dict[str, str]:
    """The fallback: whatever the account itself carries."""
    claims: dict[str, str] = {}
    for name in ATTRIBUTE_CLAIMS:
        value = attributes.get(f"{CUSTOM}{name}") or attributes.get(name)
        if value:
            claims[name] = str(value)
    if "roles" in claims:
        roles = known_roles(claims["roles"])
        if roles:
            claims["roles"] = ",".join(roles)
        else:
            del claims["roles"]
    return claims


def claims_from_person(resolved: Any) -> dict[str, str]:
    """The claims a resolved person yields. Empty values are left out."""
    claims: dict[str, str] = {"personId": resolved.person_id}
    if resolved.tenant_id:
        claims["tenantId"] = resolved.tenant_id
    roles = [r for r in resolved.roles if r in spec.ROLES]
    if roles:
        claims["roles"] = ",".join(roles)
    if resolved.staff_id:
        claims["staffId"] = resolved.staff_id
    if resolved.clinic_id:
        claims["clinicId"] = resolved.clinic_id
    if resolved.patient_profile_id:
        claims["patientProfileId"] = resolved.patient_profile_id
    if resolved.phone_verified:
        claims["phoneVerified"] = "true"
    if resolved.languages:
        claims["languages"] = ",".join(resolved.languages)
    return claims


def resolve_claims(event: dict[str, Any]) -> dict[str, str]:
    request = event.get("request") or {}
    attributes = request.get("userAttributes") or {}
    subject = str(attributes.get("sub") or "")

    if subject:
        try:
            resolved = people().resolve(subject)
        except Exception:
            # A lookup failure must not stop a sign-in that the account's own
            # attributes can already describe. It is logged in full.
            logger.exception("person lookup failed", extra={"subject": subject})
        else:
            if resolved is not None:
                return claims_from_person(resolved)
            logger.info("no person record yet", extra={"subject": subject})

    return claims_from_attributes(attributes)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Write the caller into the access token and the id token."""
    claims = resolve_claims(event)
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
