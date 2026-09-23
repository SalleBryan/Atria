"""Cognito post confirmation trigger.

A patient registers with Cognito directly and confirms their email with the
one time code Cognito sends (FR-ACC-01). That leaves an account in the pool and
nothing in the table, and the pre-token trigger has nothing to resolve: the
token carries no tenant, person or roles, and the authoriser correctly refuses
it. This trigger is what closes that gap, writing the person and the patient
profile the moment the account is confirmed.

The tenant comes from configuration rather than from the request. Phase 1 is
one pilot clinic, and a self-registering patient has no way to name a tenant
that could be trusted; letting the account choose its own tenancy would let
anyone join any clinic.

Two delivery details this has to respect, both of which would otherwise cause
real damage:

Cognito fires post confirmation for a confirmed sign-up and again for a
confirmed forgotten-password reset. Only the first is a new account, so the
trigger checks the source and leaves a password reset alone.

Cognito does not undo a confirmation when the trigger fails, and it may deliver
the same event more than once. So the write must be safe to repeat: the trigger
asks whether the person already exists and does nothing the second time, and
raises on a genuine failure so Cognito retries rather than leaving a confirmed
account with no record.
"""

from __future__ import annotations

import os
from typing import Any

from aws_lambda_powertools import Logger

from atria.data.people import People
from atria.data.repository import Repository

logger = Logger(service="atria-post-confirmation")

# The tenant a self-registering patient joins. Phase 1 is one pilot clinic.
DEFAULT_TENANT_ID = os.environ.get("DEFAULT_TENANT_ID", "")

# Cognito reuses post confirmation for a password reset, which is not a new
# account and must not be given a second person record.
SIGN_UP_SOURCE = "PostConfirmation_ConfirmSignUp"

_people: People | None = None


def people() -> People:
    """Built on first use, then reused for the life of the container."""
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Give a newly confirmed patient the records their sign-in needs."""
    source = str(event.get("triggerSource") or "")
    if source != SIGN_UP_SOURCE:
        logger.info("not a sign-up, nothing to write", extra={"trigger": source})
        return event

    attributes = (event.get("request") or {}).get("userAttributes") or {}
    subject = str(attributes.get("sub") or "")
    if not subject:
        # Without the subject there is no way to link the record to the
        # account, and a person nobody can resolve is worse than none.
        logger.error("no subject on the confirmation event", extra={"trigger": source})
        raise RuntimeError("the confirmation event carries no subject")

    if not DEFAULT_TENANT_ID:
        logger.error("DEFAULT_TENANT_ID is not set, refusing to guess a tenant")
        raise RuntimeError("DEFAULT_TENANT_ID is not set")

    # A staff account is created by an administrator, which has already written
    # its person and membership. It should never reach here, because staff do
    # not sign themselves up, but if one does it must not be given a patient
    # profile on top of its membership.
    existing = people().patient_for(subject)
    if existing is not None:
        logger.info(
            "person already exists, nothing to write",
            extra={"personId": existing.get("personId")},
        )
        return event

    person, profile = people().create_patient_account(
        tenant_id=DEFAULT_TENANT_ID,
        cognito_sub=subject,
        given_name=str(attributes.get("given_name") or ""),
        family_name=str(attributes.get("family_name") or ""),
        phone_e164=str(attributes.get("phone_number") or ""),
        email=str(attributes.get("email") or "") or None,
    )
    logger.info(
        "patient registered",
        extra={
            "personId": person["personId"],
            "patientProfileId": profile["patientProfileId"],
            "tenantId": DEFAULT_TENANT_ID,
        },
    )
    return event
