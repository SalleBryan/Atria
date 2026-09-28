"""Deleting an account, with 30 days to change one's mind (2026-09-29).

    DELETE /me                              a patient deletes their own account
    POST   /me/restore                      and takes it back within 30 days
    DELETE /admin/staff/{id}                an administrator deletes a staff account
    POST   /admin/staff/{id}/restore
    DELETE /admin/patients/{id}             an administrator deletes a patient account
    POST   /admin/patients/{id}/restore

The same rule holds whoever deletes: nothing is erased for GRACE_DAYS, and
within them the account can be restored whole. Then the daily purge
(purge.py) erases the sign-in and the personal details; the visits stay in
the hospital's records without the name.

What a deletion does at once:

    patient  upcoming visits are cancelled, so their time is free again; the
             desk's search stops finding them; signed-in devices are signed
             out. Deleted by an administrator, the sign-in is also disabled.
             Deleted by the patient, it is not, so that signing in again
             within the 30 days can offer to restore it.
    staff    the membership is DELETION_PENDING, which gives no roles, and
             the sign-in is disabled and signed out everywhere.

A restore undoes exactly that, except the cancelled visits: their times may
have gone to someone else, so they are not taken back.
"""

from __future__ import annotations

import os
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import permissions
from atria.core.errors import Conflict, Forbidden, Invalid, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.deletions import GRACE_DAYS, Deletions
from atria.data.people import People
from atria.data.register import Register
from atria.services.booking import appointments

logger = Logger(service="atria-deletion")

USER_POOL_ID = os.environ.get("USER_POOL_ID", "")


def cognito() -> Any:
    return boto3.client("cognito-idp")


def username_of(person: dict[str, Any]) -> str | None:
    """The account's Cognito username, found by its subject.

    A Google sign-in's username is not its email, and a staff account's may
    be its mobile, so the subject is the one thing always known.
    """
    if not USER_POOL_ID:
        return None
    sub = person.get("cognitoSub")
    if sub:
        found = cognito().list_users(UserPoolId=USER_POOL_ID, Filter=f'sub = "{sub}"', Limit=1)
        users = found.get("Users") or []
        if users:
            return str(users[0]["Username"])
    # A staff account made by an administrator signs in with its email or
    # mobile, which is its username (staff.py), before it has a subject here.
    alias = person.get("email") or person.get("phoneE164")
    return str(alias) if alias else None


def sign_in(person: dict[str, Any], *, enabled: bool | None = None, sign_out: bool = False) -> None:
    """Enable or disable the account's sign-in, and end its sessions. Best effort
    after the record is written: a failure is logged, and the purge retries."""
    try:
        username = username_of(person)
        if not username:
            return
        client = cognito()
        if enabled is False:
            client.admin_disable_user(UserPoolId=USER_POOL_ID, Username=username)
        if enabled is True:
            client.admin_enable_user(UserPoolId=USER_POOL_ID, Username=username)
        if sign_out:
            client.admin_user_global_sign_out(UserPoolId=USER_POOL_ID, Username=username)
    except Exception:
        logger.exception("could not change the sign-in", extra={"personId": person.get("personId")})


def pending_view(pending: dict[str, Any]) -> dict[str, Any]:
    return {
        "purgeAt": pending.get("purgeAt"),
        "requestedAt": pending.get("requestedAt"),
        "by": pending.get("by"),
        "graceDays": GRACE_DAYS,
    }


# ------------------------------------------------------------------ patients
def delete_patient(
    people: People,
    *,
    tenant_id: str,
    patient_profile_id: str,
    actor: Principal,
    by: str,
    now: Any,
) -> dict[str, Any]:
    repo = people.repository
    profile = repo.require(
        keys.patient_profile(tenant_id, patient_profile_id), what="patient profile"
    )
    person = people.person_record(str(profile["personId"]))
    if person.get("deletion"):
        raise Conflict("this account is already deleted", detail=pending_view(person["deletion"]))

    cancelled = appointments.cancel_ahead(
        tenant_id=tenant_id,
        patient_profile_id=patient_profile_id,
        cancelled_by="PATIENT" if by == "SELF" else "CLINIC",
        actor_person_id=actor.person_id,
        actor_role="PATIENT" if by == "SELF" else "TENANT_ADMIN",
        reason="Account deleted",
    )
    pending = Deletions(repo).schedule(
        tenant_id=tenant_id,
        kind="PATIENT",
        subject_id=patient_profile_id,
        person_id=str(person["personId"]),
        by=by,
        by_person_id=actor.person_id,
        now=now,
    )
    repo.put(keys.person(str(person["personId"])), {**person, "deletion": pending})
    repo.put(
        keys.patient_profile(tenant_id, patient_profile_id),
        {**profile, "deletionPurgeAt": pending["purgeAt"]},
    )
    Register(repo).mark_deletion(tenant_id, patient_profile_id, str(pending["purgeAt"]))
    # A patient who deleted their own account keeps a sign-in, to take it back.
    sign_in(person, enabled=False if by == "ADMIN" else None, sign_out=True)
    logger.info(
        "patient account deleted",
        extra={"patientProfileId": patient_profile_id, "by": by, "cancelled": cancelled},
    )
    return {**pending_view(pending), "cancelledVisits": cancelled}


def restore_patient(
    people: People, *, tenant_id: str, patient_profile_id: str, by: str
) -> dict[str, Any]:
    repo = people.repository
    profile = repo.require(
        keys.patient_profile(tenant_id, patient_profile_id), what="patient profile"
    )
    person = people.person_record(str(profile["personId"]))
    pending = person.get("deletion")
    if not pending:
        raise Conflict("this account is not deleted")
    if by == "SELF" and pending.get("by") != "SELF":
        # The hospital deleted it; the hospital restores it.
        raise Conflict("the hospital deleted this account; ask the front desk to restore it")
    Deletions(repo).withdraw(
        tenant_id=tenant_id,
        kind="PATIENT",
        subject_id=patient_profile_id,
        purge_at=str(pending["purgeAt"]),
    )
    repo.put(
        keys.person(str(person["personId"])),
        {k: v for k, v in person.items() if k != "deletion"},
    )
    repo.put(
        keys.patient_profile(tenant_id, patient_profile_id),
        {k: v for k, v in profile.items() if k != "deletionPurgeAt"},
    )
    Register(repo).mark_deletion(tenant_id, patient_profile_id, None)
    sign_in(person, enabled=True)
    logger.info("patient account restored", extra={"patientProfileId": patient_profile_id})
    return {"restored": True}


# --------------------------------------------------------------------- staff
def delete_staff(people: People, *, actor: Principal, staff_id: str, now: Any) -> dict[str, Any]:
    membership = people.staff(actor.tenant_id, staff_id)
    permissions.require(
        actor,
        "staff.suspend",
        Subject(tenant_id=membership["tenantId"], clinic_id=membership.get("clinicId")),
    )
    if staff_id == actor.staff_id:
        raise Invalid("an administrator cannot delete their own account")
    if membership.get("status") == "DELETION_PENDING":
        raise Conflict("this account is already deleted")
    repo = people.repository
    pending = Deletions(repo).schedule(
        tenant_id=actor.tenant_id,
        kind="STAFF",
        subject_id=staff_id,
        person_id=str(membership["personId"]),
        by="ADMIN",
        by_person_id=actor.person_id,
        now=now,
    )
    before = str(membership.get("status") or "ACTIVE")
    people.set_status(tenant_id=actor.tenant_id, staff_id=staff_id, status="DELETION_PENDING")
    repo.update_existing(
        keys.staff_membership(actor.tenant_id, staff_id),
        set_values={"deletion": {**pending, "statusBefore": before}},
        what="staff account",
    )
    person = people.person_record(str(membership["personId"]))
    sign_in(person, enabled=False, sign_out=True)
    logger.info("staff account deleted", extra={"staffId": staff_id})
    return pending_view(pending)


def restore_staff(people: People, *, actor: Principal, staff_id: str) -> dict[str, Any]:
    membership = people.staff(actor.tenant_id, staff_id)
    permissions.require(
        actor,
        "staff.suspend",
        Subject(tenant_id=membership["tenantId"], clinic_id=membership.get("clinicId")),
    )
    pending = membership.get("deletion")
    if membership.get("status") != "DELETION_PENDING" or not pending:
        raise Conflict("this account is not deleted")
    repo = people.repository
    Deletions(repo).withdraw(
        tenant_id=actor.tenant_id,
        kind="STAFF",
        subject_id=staff_id,
        purge_at=str(pending["purgeAt"]),
    )
    people.set_status(
        tenant_id=actor.tenant_id,
        staff_id=staff_id,
        status=str(pending.get("statusBefore") or "ACTIVE"),
    )
    repo.update_existing(
        keys.staff_membership(actor.tenant_id, staff_id),
        set_values={},
        remove=("deletion",),
        what="staff account",
    )
    person = people.person_record(str(membership["personId"]))
    sign_in(person, enabled=True)
    logger.info("staff account restored", extra={"staffId": staff_id})
    return {"restored": True}


# ------------------------------------------------------------ who may do what
def delete_own(people: People, principal: Principal, *, now: Any) -> dict[str, Any]:
    if not principal.patient_profile_id or not principal.tenant_id:
        raise Invalid("only a patient account is deleted from here; staff ask an administrator")
    permissions.require(
        principal,
        "patient.delete",
        Subject(tenant_id=principal.tenant_id, patient_profile_id=principal.patient_profile_id),
    )
    return delete_patient(
        people,
        tenant_id=principal.tenant_id,
        patient_profile_id=principal.patient_profile_id,
        actor=principal,
        by="SELF",
        now=now,
    )


def restore_own(people: People, principal: Principal) -> dict[str, Any]:
    if not principal.patient_profile_id or not principal.tenant_id:
        raise NotFound("no patient account to restore")
    return restore_patient(
        people,
        tenant_id=principal.tenant_id,
        patient_profile_id=principal.patient_profile_id,
        by="SELF",
    )


def delete_patient_as_admin(
    people: People, principal: Principal, patient_profile_id: str, *, now: Any
) -> dict[str, Any]:
    scope = permissions.require(principal, "patient.delete", Subject(tenant_id=principal.tenant_id))
    if scope != "tenant":
        raise Forbidden("only an administrator deletes a patient's account")
    return delete_patient(
        people,
        tenant_id=principal.tenant_id,
        patient_profile_id=patient_profile_id,
        actor=principal,
        by="ADMIN",
        now=now,
    )


def restore_patient_as_admin(
    people: People, principal: Principal, patient_profile_id: str
) -> dict[str, Any]:
    scope = permissions.require(principal, "patient.delete", Subject(tenant_id=principal.tenant_id))
    if scope != "tenant":
        raise Forbidden("only an administrator restores a patient's account")
    return restore_patient(
        people, tenant_id=principal.tenant_id, patient_profile_id=patient_profile_id, by="ADMIN"
    )
