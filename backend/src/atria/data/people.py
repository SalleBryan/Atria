"""Person, staff membership and clinician profile records.

A person is one human being. A patient profile and any staff memberships hang
off the person, which is what lets a staff member be a patient of the clinic
they work at without the two ever being the same record (ADR 0010).

The person item also carries a short summary of its memberships and patient
profiles. That summary is a duplicate of what the membership records hold, kept
because the sign-in path needs the whole picture in one read: the pre-token
trigger resolves the caller from the person item alone, so no request pays for a
second query (ADR 0017). Both are written in one transaction, so they cannot
drift.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any

from atria.core import staff as rules
from atria.core.errors import Conflict, Invalid
from atria.data import keys
from atria.data.repository import Item, Repository

PERSON_INDEX = "PersonIndex"
DIRECTORY_INDEX = "DirectoryIndex"

# Statuses a clinician is listed in the directory under. The same two the
# booking service will accept, so the directory cannot offer somebody booking
# would refuse.
LISTED_STATUSES = ("INVITED", "ACTIVE")


def new_id(prefix: str) -> str:
    """A short, opaque identifier. Not derived from anything about the person."""
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def now() -> str:
    return dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds")


@dataclass(frozen=True, slots=True)
class ResolvedPerson:
    """What the sign-in path needs to know about whoever is signing in."""

    person_id: str
    tenant_id: str | None
    roles: tuple[str, ...]
    staff_id: str | None = None
    clinic_id: str | None = None
    patient_profile_id: str | None = None
    phone_verified: bool = False
    languages: tuple[str, ...] = ()


def person_item(
    *,
    person_id: str,
    cognito_sub: str | None,
    given_name: str,
    family_name: str,
    phone_e164: str,
    email: str | None = None,
    preferred_language: str | None = None,
) -> Item:
    """The person record. Age is never stored, only date of birth (ADR 0009)."""
    item: Item = {
        "type": "PERSON",
        "personId": person_id,
        "givenName": given_name,
        "familyName": family_name,
        "phoneE164": phone_e164,
        "createdAt": now(),
        "memberships": [],
        "patientProfiles": [],
    }
    if cognito_sub:
        # The PersonIndex hash. Absent until the account exists in the pool.
        item["cognitoSub"] = cognito_sub
    if email:
        item["email"] = email
    if preferred_language:
        item["preferredLanguage"] = preferred_language
    return item


def membership_item(
    *,
    staff_id: str,
    person_id: str,
    tenant_id: str,
    clinic_id: str | None,
    account: rules.StaffAccount,
) -> Item:
    return {
        "type": "STAFF_MEMBERSHIP",
        "staffMembershipId": staff_id,
        "personId": person_id,
        "tenantId": tenant_id,
        "clinicId": clinic_id,
        "roles": list(account.roles),
        "employeeNumber": account.employee_number,
        "status": "INVITED",
        "createdAt": now(),
    }


def directory_key(tenant_id: str) -> str:
    """The DirectoryIndex partition: every bookable clinician of one tenant."""
    return f"{keys.TENANT}{tenant_id}#CLINICIAN"


def directory_sort(*, registration_year: int, family_name: str, staff_id: str) -> str:
    """Sorts most senior first.

    The year rather than the seniority band, because the band is derived at
    creation and would say the wrong thing a decade later, while the year on
    the Order's roll never changes. Ascending year is descending seniority.
    """
    return f"{registration_year}#{family_name}#{staff_id}"


def clinician_item(
    *,
    staff_id: str,
    tenant_id: str,
    account: rules.StaffAccount,
    current_year: int,
    listed: bool = True,
) -> Item:
    """The bookable part of a membership: only facts a listing may carry.

    `listed` controls membership of the sparse DirectoryIndex. A suspended
    clinician has to leave the directory, or a patient is offered somebody the
    booking service will then refuse.
    """
    if account.registration_year is None:
        raise Invalid("registrationYear is required for a clinician")
    item: Item = {
        "type": "CLINICIAN_PROFILE",
        "clinicianProfileId": staff_id,
        "staffMembershipId": staff_id,
        "tenantId": tenant_id,
        # Carried here as well as on the membership so the directory can filter
        # by clinic in one read. An account's clinic is set at creation and
        # there is no path that moves it, so the two cannot drift.
        "clinicId": account.clinic_id,
        "familyName": account.family_name,
        "givenName": account.given_name,
        "specialty": account.specialty,
        "qualifications": list(account.qualifications),
        "registrationYear": account.registration_year,
        "ordreNumber": account.ordre_number,
        "languages": list(account.languages),
        "seniorityBand": rules.seniority_band(account.registration_year, current_year=current_year),
    }
    if listed:
        item["directoryKey"] = directory_key(tenant_id)
        item["directorySort"] = directory_sort(
            registration_year=account.registration_year,
            family_name=account.family_name,
            staff_id=staff_id,
        )
    return item


def patient_profile_item(
    *, patient_profile_id: str, person_id: str, tenant_id: str
) -> Item:
    """A person as a patient of one tenant.

    Nothing here is asked for at sign-up: names, date of birth and the
    notification preferences arrive at profile completion. What matters at this
    point is that the profile exists, because it is what "own" means for a
    patient and nothing the patient may do resolves without it.
    """
    return {
        "type": "PATIENT_PROFILE",
        "patientProfileId": patient_profile_id,
        "personId": person_id,
        "tenantId": tenant_id,
        "noShowCount": 0,
        "createdAt": now(),
    }


def patient_profile_summary(item: Item) -> Item:
    """The part of a patient profile the sign-in path needs."""
    return {
        "tenantId": item["tenantId"],
        "patientProfileId": item["patientProfileId"],
    }


def membership_summary(item: Item) -> Item:
    """The part of a membership the sign-in path needs."""
    return {
        "tenantId": item["tenantId"],
        "staffMembershipId": item["staffMembershipId"],
        "clinicId": item.get("clinicId"),
        "roles": list(item.get("roles", [])),
        "status": item.get("status", "INVITED"),
    }


class People:
    """Reads and writes of people, memberships and clinician profiles."""

    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    @property
    def current_year(self) -> int:
        return int(self._clock().year)

    # ------------------------------------------------------------------ reads
    def by_cognito_sub(self, cognito_sub: str) -> Item | None:
        found = self._repo.query_index(PERSON_INDEX, "cognitoSub", cognito_sub, limit=2)
        if not found:
            return None
        if len(found) > 1:
            # Two people cannot share an identity provider subject. Refusing is
            # safer than picking one, because picking one picks a tenant.
            raise Conflict("that sign-in is linked to more than one person")
        return found[0]

    def resolve(self, cognito_sub: str) -> ResolvedPerson | None:
        """Everything the token needs about the person behind a sign-in."""
        person = self.by_cognito_sub(cognito_sub)
        if person is None:
            return None

        active = [
            m for m in person.get("memberships", []) if m.get("status") in ("INVITED", "ACTIVE")
        ]
        membership = active[0] if active else None
        profiles = person.get("patientProfiles", [])
        profile = profiles[0] if profiles else None

        tenant_id = None
        if membership is not None:
            tenant_id = membership.get("tenantId")
        elif profile is not None:
            tenant_id = profile.get("tenantId")

        return ResolvedPerson(
            person_id=str(person["personId"]),
            tenant_id=tenant_id,
            roles=tuple(membership.get("roles", []))
            if membership
            else ("PATIENT",)
            if profile
            else (),
            staff_id=membership.get("staffMembershipId") if membership else None,
            clinic_id=membership.get("clinicId") if membership else None,
            patient_profile_id=profile.get("patientProfileId") if profile else None,
            phone_verified=bool(person.get("phoneVerifiedAt")),
            languages=tuple(
                [person["preferredLanguage"]] if person.get("preferredLanguage") else []
            ),
        )

    def clinicians(
        self,
        tenant_id: str,
        *,
        specialty: str | None = None,
        clinic_id: str | None = None,
        name: str | None = None,
    ) -> list[Item]:
        """The tenant's bookable clinicians, most senior first (FR-DIR-01).

        The index is already ordered and already excludes suspended accounts,
        so the filters are applied here rather than in the query: a tenant's
        clinician list is small, and a filter expression would cost the same
        read while making the ordering harder to reason about.
        """
        found = self._repo.query_index(
            DIRECTORY_INDEX, "directoryKey", directory_key(tenant_id)
        )
        if specialty:
            wanted = specialty.casefold()
            found = [c for c in found if str(c.get("specialty", "")).casefold() == wanted]
        if clinic_id:
            found = [c for c in found if c.get("clinicId") == clinic_id]
        if name:
            needle = name.casefold()
            found = [
                c
                for c in found
                if needle in f"{c.get('givenName', '')} {c.get('familyName', '')}".casefold()
            ]
        return found

    def clinician(self, tenant_id: str, clinician_profile_id: str) -> Item:
        return self._repo.require(
            keys.clinician_profile(tenant_id, clinician_profile_id), what="clinician"
        )

    def person_record(self, person_id: str) -> Item:
        return self._repo.require(keys.person(person_id), what="person")

    def staff(self, tenant_id: str, staff_id: str) -> Item:
        return self._repo.require(keys.staff_membership(tenant_id, staff_id), what="staff account")

    # ----------------------------------------------------------------- writes
    def create_staff_account(
        self, *, tenant_id: str, account: rules.StaffAccount, cognito_sub: str | None = None
    ) -> tuple[Item, Item]:
        """Write the person, the membership and any clinician profile at once.

        A membership without its person, or a clinician profile without its
        membership, would be a half provisioned account that the sign-in path
        cannot resolve, so all of them go in one transaction.
        """
        person_id = new_id("p")
        staff_id = new_id("s")

        person = person_item(
            person_id=person_id,
            cognito_sub=cognito_sub,
            given_name=account.given_name,
            family_name=account.family_name,
            phone_e164=account.phone_e164,
            email=account.email,
            preferred_language=account.languages[0] if account.languages else None,
        )
        membership = membership_item(
            staff_id=staff_id,
            person_id=person_id,
            tenant_id=tenant_id,
            clinic_id=account.clinic_id,
            account=account,
        )
        person["memberships"] = [membership_summary(membership)]

        writes = [
            (keys.person(person_id), person),
            (keys.staff_membership(tenant_id, staff_id), membership),
        ]
        if account.is_clinician:
            writes.append(
                (
                    keys.clinician_profile(tenant_id, staff_id),
                    clinician_item(
                        staff_id=staff_id,
                        tenant_id=tenant_id,
                        account=account,
                        current_year=self.current_year,
                    ),
                )
            )
        self._repo.write_together(writes)
        return person, membership

    def create_patient_account(
        self,
        *,
        tenant_id: str,
        cognito_sub: str,
        given_name: str = "",
        family_name: str = "",
        phone_e164: str = "",
        email: str | None = None,
    ) -> tuple[Item, Item]:
        """Write the person and their patient profile at once.

        Called from the post confirmation trigger, after Cognito has already
        confirmed the account. Cognito does not undo a confirmation if this
        fails, so a person who is confirmed but has no record here cannot sign
        in usefully: the trigger retries rather than swallowing the failure,
        and `patient_for` makes a retry harmless.
        """
        person_id = new_id("p")
        profile_id = new_id("pp")

        person = person_item(
            person_id=person_id,
            cognito_sub=cognito_sub,
            given_name=given_name,
            family_name=family_name,
            phone_e164=phone_e164,
            email=email,
        )
        profile = patient_profile_item(
            patient_profile_id=profile_id, person_id=person_id, tenant_id=tenant_id
        )
        person["patientProfiles"] = [patient_profile_summary(profile)]

        self._repo.write_together(
            [
                (keys.person(person_id), person),
                (keys.patient_profile(tenant_id, profile_id), profile),
            ]
        )
        return person, profile

    def patient_for(self, cognito_sub: str) -> Item | None:
        """The person behind a sign-in, if one was already written.

        The post confirmation trigger can be delivered more than once for the
        same sign-up, so it asks this first and does nothing the second time
        rather than writing a second person for one human being.
        """
        return self.by_cognito_sub(cognito_sub)

    def set_roles(self, *, tenant_id: str, staff_id: str, roles: tuple[str, ...]) -> Item:
        """Change the roles on an account. Effective at its next sign-in."""
        membership = self.staff(tenant_id, staff_id)
        updated = self._repo.update_existing(
            keys.staff_membership(tenant_id, staff_id),
            set_values={"roles": list(roles), "rolesChangedAt": now()},
            what="staff account",
        )
        self._sync_person(membership["personId"], updated)
        return updated

    def set_status(self, *, tenant_id: str, staff_id: str, status: str) -> Item:
        if status not in rules.MEMBERSHIP_STATUSES:
            raise Invalid("unknown status", detail={"allowed": list(rules.MEMBERSHIP_STATUSES)})
        membership = self.staff(tenant_id, staff_id)
        updated = self._repo.update_existing(
            keys.staff_membership(tenant_id, staff_id),
            set_values={"status": status, "statusChangedAt": now()},
            what="staff account",
        )
        self._sync_person(membership["personId"], updated)
        if "CLINICIAN" in membership.get("roles", []):
            self._sync_directory(tenant_id, staff_id, status=status)
        return updated

    def _sync_directory(self, tenant_id: str, staff_id: str, *, status: str) -> None:
        """Take a clinician in or out of the directory as their status changes.

        DirectoryIndex is sparse, so this is a matter of carrying its keys or
        not. A suspended clinician that stayed listed would be offered to a
        patient and then refused by the booking service.
        """
        profile = self._repo.get(keys.clinician_profile(tenant_id, staff_id))
        if profile is None:
            return
        listed = status in LISTED_STATUSES
        if listed:
            year = profile.get("registrationYear")
            if year is None:  # pragma: no cover  a profile always carries one
                return
            self._repo.update_existing(
                keys.clinician_profile(tenant_id, staff_id),
                set_values={
                    "directoryKey": directory_key(tenant_id),
                    "directorySort": directory_sort(
                        registration_year=int(year),
                        family_name=str(profile.get("familyName", "")),
                        staff_id=staff_id,
                    ),
                },
                what="clinician profile",
            )
            return
        self._repo.update_existing(
            keys.clinician_profile(tenant_id, staff_id),
            set_values={},
            remove=("directoryKey", "directorySort"),
            what="clinician profile",
        )

    def _sync_person(self, person_id: str, membership: Item) -> None:
        """Keep the person's summary in step with the membership record."""
        person = self._repo.require(keys.person(person_id), what="person")
        summaries = [
            membership_summary(membership)
            if m.get("staffMembershipId") == membership["staffMembershipId"]
            else m
            for m in person.get("memberships", [])
        ]
        if all(m.get("staffMembershipId") != membership["staffMembershipId"] for m in summaries):
            summaries.append(membership_summary(membership))
        self._repo.update_existing(
            keys.person(person_id), set_values={"memberships": summaries}, what="person"
        )
