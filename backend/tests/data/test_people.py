"""Provisioning writes a whole account or none of it, and sign-in can resolve it.

Verifies FR-ACC-04 (a tenant administrator creates the account with its roles),
FR-ACC-07 (the caller is resolved to a tenant, a person and roles), FR-ACC-17
(a person holds a patient profile and staff memberships separately) and
FR-ACC-18 (a role change takes effect at the next sign-in).

Runs against moto, on a table built from the specification's key design.
"""

from __future__ import annotations

import pytest

from atria.core import staff as rules
from atria.core.errors import Conflict, NotFound
from atria.data import keys
from atria.data.people import People, membership_summary

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
CLINIC = "c-douala-01"

RECEPTIONIST_BODY = {
    "givenName": "Amina",
    "familyName": "Ngo",
    "phoneE164": "+237600000001",
    "clinicId": CLINIC,
    "roles": ["RECEPTIONIST"],
}

CLINICIAN_BODY = {
    "givenName": "Paul",
    "familyName": "Etoa",
    "phoneE164": "+237600000002",
    "clinicId": CLINIC,
    "roles": ["CLINICIAN"],
    "specialty": "Paediatrics",
    "registrationYear": 2012,
    "ordreNumber": "CM-ONMC-12345",
    "languages": ["fr", "en"],
}


@pytest.fixture
def people(repository):
    return People(repository)


def account(body):
    return rules.validate(body, current_year=2026)


class TestCreate:
    def test_the_person_and_the_membership_are_both_written(self, people, repository):
        person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY), cognito_sub="sub-1"
        )
        assert repository.get(keys.person(person["personId"])) is not None
        assert (
            repository.get(keys.staff_membership(TENANT, membership["staffMembershipId"]))
            is not None
        )

    def test_a_new_account_starts_invited(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        assert membership["status"] == "INVITED"

    def test_the_person_summarises_the_membership(self, people):
        person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        assert person["memberships"] == [membership_summary(membership)]

    def test_a_clinician_gets_a_clinician_profile_with_a_derived_band(self, people, repository):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(CLINICIAN_BODY)
        )
        profile = repository.get(keys.clinician_profile(TENANT, membership["staffMembershipId"]))
        assert profile is not None
        assert profile["specialty"] == "Paediatrics"
        # ADR 0011: the band comes from the year on the roll, never a score.
        assert profile["seniorityBand"] == "EXPERIENCED"
        assert "rating" not in profile

    def test_a_receptionist_gets_no_clinician_profile(self, people, repository):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        assert (
            repository.get(keys.clinician_profile(TENANT, membership["staffMembershipId"])) is None
        )

    def test_two_accounts_do_not_share_identifiers(self, people):
        _p1, first = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        _p2, second = people.create_staff_account(tenant_id=TENANT, account=account(CLINICIAN_BODY))
        assert first["staffMembershipId"] != second["staffMembershipId"]
        assert first["personId"] != second["personId"]

    def test_the_account_belongs_to_the_administrator_s_tenant(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        assert membership["tenantId"] == TENANT


class TestResolve:
    def test_a_staff_account_resolves_to_its_roles_and_clinic(self, people):
        people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY), cognito_sub="sub-desk"
        )
        resolved = people.resolve("sub-desk")
        assert resolved is not None
        assert resolved.tenant_id == TENANT
        assert resolved.roles == ("RECEPTIONIST",)
        assert resolved.clinic_id == CLINIC
        assert resolved.staff_id is not None
        assert resolved.patient_profile_id is None

    def test_an_unknown_sign_in_resolves_to_nothing(self, people):
        assert people.resolve("sub-nobody") is None

    def test_a_person_with_a_patient_profile_resolves_as_a_patient(self, people, repository):
        # FR-ACC-17: the patient profile hangs off the person, separately.
        person, _membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY), cognito_sub="sub-both"
        )
        repository.update_existing(
            keys.person(person["personId"]),
            set_values={"patientProfiles": [{"tenantId": TENANT, "patientProfileId": "pp-1"}]},
            what="person",
        )
        resolved = people.resolve("sub-both")
        assert resolved is not None
        # Staff roles still apply; the patient profile is carried alongside, and
        # the guard rule drops staff scope only when the actor is the subject.
        assert resolved.roles == ("RECEPTIONIST",)
        assert resolved.patient_profile_id == "pp-1"

    def test_a_person_with_only_a_patient_profile_is_a_patient(self, people, repository):
        from atria.data.people import new_id, person_item

        person_id = new_id("p")
        item = person_item(
            person_id=person_id,
            cognito_sub="sub-patient",
            given_name="Sara",
            family_name="Kome",
            phone_e164="+237600000009",
        )
        item["patientProfiles"] = [{"tenantId": TENANT, "patientProfileId": "pp-9"}]
        repository.put_new(keys.person(person_id), item, what="person")
        resolved = people.resolve("sub-patient")
        assert resolved is not None
        assert resolved.roles == ("PATIENT",)
        assert resolved.tenant_id == TENANT

    def test_a_suspended_membership_is_not_resolved(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY), cognito_sub="sub-gone"
        )
        people.set_status(
            tenant_id=TENANT, staff_id=membership["staffMembershipId"], status="SUSPENDED"
        )
        resolved = people.resolve("sub-gone")
        assert resolved is not None
        assert resolved.roles == ()
        assert resolved.staff_id is None

    def test_one_sign_in_linked_to_two_people_is_refused(self, people, repository):
        from atria.data.people import new_id, person_item

        for _ in range(2):
            person_id = new_id("p")
            repository.put_new(
                keys.person(person_id),
                person_item(
                    person_id=person_id,
                    cognito_sub="sub-shared",
                    given_name="A",
                    family_name="B",
                    phone_e164="+237600000000",
                ),
                what="person",
            )
        with pytest.raises(Conflict, match="more than one person"):
            people.resolve("sub-shared")


class TestChanges:
    def test_roles_change_on_the_membership_and_the_person(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY), cognito_sub="sub-promote"
        )
        staff_id = membership["staffMembershipId"]
        updated = people.set_roles(
            tenant_id=TENANT, staff_id=staff_id, roles=("RECEPTIONIST", "CLINIC_MANAGER")
        )
        assert updated["roles"] == ["RECEPTIONIST", "CLINIC_MANAGER"]
        # FR-ACC-18: the next sign-in is what picks this up.
        resolved = people.resolve("sub-promote")
        assert resolved is not None
        assert resolved.roles == ("RECEPTIONIST", "CLINIC_MANAGER")

    def test_suspending_records_the_status_and_the_time(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        updated = people.set_status(
            tenant_id=TENANT, staff_id=membership["staffMembershipId"], status="SUSPENDED"
        )
        assert updated["status"] == "SUSPENDED"
        assert updated["statusChangedAt"]

    def test_an_unknown_status_is_refused(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        from atria.core.errors import Invalid

        with pytest.raises(Invalid, match="unknown status"):
            people.set_status(
                tenant_id=TENANT,
                staff_id=membership["staffMembershipId"],
                status="ON_HOLIDAY",
            )

    def test_changing_an_account_that_does_not_exist_is_not_found(self, people):
        with pytest.raises(NotFound, match="staff account"):
            people.set_roles(tenant_id=TENANT, staff_id="s-nobody", roles=("CLINICIAN",))

    def test_an_account_in_another_tenant_is_not_found(self, people):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT, account=account(RECEPTIONIST_BODY)
        )
        with pytest.raises(NotFound):
            people.set_roles(
                tenant_id="t-other",
                staff_id=membership["staffMembershipId"],
                roles=("CLINICIAN",),
            )
