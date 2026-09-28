"""The daily purge: accounts whose 30 days are over are erased (2026-09-29).

Run once a day by an EventBridge schedule. For each deletion that is due
(atria.data.deletions):

    patient  the Cognito user is deleted; the person keeps no name, email,
             mobile, date of birth or sign-in; the register entries go; the
             profile is marked deleted. Visits stay, for the hospital's
             records and the fee ledger, with nobody named on them.
    staff    the membership is ENDED and the Cognito user deleted. The person
             is erased too, unless they are also a patient or hold another
             membership.

Each deletion is finished on its own; one that fails stays due and is tried
again the next day.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from aws_lambda_powertools import Logger

from atria.data import keys
from atria.data.deletions import Deletions
from atria.data.people import People
from atria.data.register import Register
from atria.data.repository import Repository
from atria.services.identity.deletion import USER_POOL_ID, cognito, username_of

logger = Logger(service="atria-purge")

# What an erased person keeps: who they were to the system, not who they were.
ERASED = ("givenName", "familyName", "email", "phoneE164", "dateOfBirth", "cognitoSub")

_people: People | None = None


def people() -> People:
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


def erase_sign_in(person: dict[str, Any]) -> None:
    username = username_of(person)
    if username:
        cognito().admin_delete_user(UserPoolId=USER_POOL_ID, Username=username)


def erase_person(person: dict[str, Any], *, at: str) -> None:
    kept = {k: v for k, v in person.items() if k not in ERASED and k != "deletion"}
    people().repository.put(
        keys.person(str(person["personId"])),
        {**kept, "givenName": "Deleted", "familyName": "account", "erasedAt": at},
    )


def purge_patient(entry: dict[str, Any], *, at: str) -> None:
    repo = people().repository
    tenant_id, profile_id = str(entry["tenantId"]), str(entry["subjectId"])
    person = people().person_record(str(entry["personId"]))
    erase_sign_in(person)
    Register(repo).remove(tenant_id, profile_id)
    profile = repo.get(keys.patient_profile(tenant_id, profile_id)) or {}
    if profile:
        repo.put(
            keys.patient_profile(tenant_id, profile_id),
            {
                **{k: v for k, v in profile.items() if k != "deletionPurgeAt"},
                "deletedAt": at,
            },
        )
    erase_person(person, at=at)


def purge_staff(entry: dict[str, Any], *, at: str) -> None:
    tenant_id, staff_id = str(entry["tenantId"]), str(entry["subjectId"])
    people().set_status(tenant_id=tenant_id, staff_id=staff_id, status="ENDED")
    person = people().person_record(str(entry["personId"]))
    others = [
        m
        for m in person.get("memberships", [])
        if m.get("staffMembershipId") != staff_id and m.get("status") not in ("ENDED",)
    ]
    if others or person.get("patientProfiles"):
        return
    erase_sign_in(person)
    erase_person(person, at=at)


def purge(now: dt.datetime) -> dict[str, int]:
    at = now.astimezone(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    store = Deletions(people().repository)
    done = failed = 0
    for entry in store.due(now):
        try:
            if entry.get("kind") == "PATIENT":
                purge_patient(entry, at=at)
            else:
                purge_staff(entry, at=at)
            store.withdraw(
                tenant_id=str(entry["tenantId"]),
                kind=str(entry["kind"]),
                subject_id=str(entry["subjectId"]),
                purge_at=str(entry["purgeAt"]),
            )
            done += 1
        except Exception:
            failed += 1
            logger.exception("could not purge", extra={"sk": entry.get("sk")})
    logger.info("purge finished", extra={"purged": done, "failed": failed})
    return {"purged": done, "failed": failed}


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    return purge(dt.datetime.now(tz=dt.UTC))
