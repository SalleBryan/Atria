"""The clinician directory lists who can actually be booked.

Verifies FR-DIR-01 (a patient lists the clinicians of their tenant, filtered by
specialty and clinic and searchable by name) and ADR 0011, which is why the
listing carries a seniority band and never a score.

DirectoryIndex is sparse, so the interesting cases here are about membership of
the index rather than about filtering: a suspended clinician has to leave the
listing, or a patient is offered somebody the booking service will refuse.
"""

from __future__ import annotations

import pytest

from atria.core import staff as rules
from atria.data import keys
from atria.data.people import People

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
YAOUNDE = "c-yaounde-01"


@pytest.fixture
def people(repository):
    return People(repository)


def account(
    *,
    family_name: str,
    year: int,
    specialty: str = "Paediatrics",
    clinic_id: str = DOUALA,
    roles: tuple[str, ...] = ("CLINICIAN",),
    phone: str = "+237600000001",
) -> rules.StaffAccount:
    return rules.StaffAccount(
        given_name="Paul",
        family_name=family_name,
        phone_e164=phone,
        roles=roles,
        clinic_id=clinic_id,
        specialty=specialty,
        registration_year=year,
        ordre_number=f"CM-ONMC-{family_name}",
        languages=("fr", "en"),
    )


@pytest.fixture
def seeded(people):
    """Three clinicians and a receptionist, registered in different years."""
    made = {}
    for family_name, year, specialty, clinic in (
        ("Etoa", 2012, "Paediatrics", DOUALA),
        ("Abena", 1998, "Cardiology", DOUALA),
        ("Manga", 2021, "Paediatrics", YAOUNDE),
    ):
        _person, membership = people.create_staff_account(
            tenant_id=TENANT,
            account=account(
                family_name=family_name,
                year=year,
                specialty=specialty,
                clinic_id=clinic,
                phone=f"+23760000{year}",
            ),
        )
        made[family_name] = membership["staffMembershipId"]
    people.create_staff_account(
        tenant_id=TENANT,
        account=rules.StaffAccount(
            given_name="Amina",
            family_name="Ngo",
            phone_e164="+237600009999",
            roles=("RECEPTIONIST",),
            clinic_id=DOUALA,
        ),
    )
    return made


class TestListing:
    def test_every_clinician_of_the_tenant_is_listed(self, people, seeded):
        assert len(people.clinicians(TENANT)) == 3

    def test_a_receptionist_is_not_in_the_clinician_directory(self, people, seeded):
        """Only a clinician profile carries the index keys."""
        listed = {c["familyName"] for c in people.clinicians(TENANT)}
        assert "Ngo" not in listed

    def test_the_listing_is_most_senior_first(self, people, seeded):
        """Earliest year on the Order's roll first, which never goes stale."""
        listed = [c["familyName"] for c in people.clinicians(TENANT)]
        assert listed == ["Abena", "Etoa", "Manga"]

    def test_another_tenant_sees_nothing_of_this_one(self, people, seeded):
        assert people.clinicians("t-other") == []

    def test_the_listing_carries_a_band_and_never_a_score(self, people, seeded):
        """ADR 0011: the directory orders clinicians without asserting quality."""
        for clinician in people.clinicians(TENANT):
            assert clinician["seniorityBand"]
            assert "score" not in clinician
            assert "rating" not in clinician


class TestFilters:
    def test_by_specialty(self, people, seeded):
        found = people.clinicians(TENANT, specialty="Cardiology")
        assert [c["familyName"] for c in found] == ["Abena"]

    def test_specialty_ignores_case(self, people, seeded):
        assert len(people.clinicians(TENANT, specialty="cardiology")) == 1

    def test_by_clinic(self, people, seeded):
        found = people.clinicians(TENANT, clinic_id=YAOUNDE)
        assert [c["familyName"] for c in found] == ["Manga"]

    def test_by_name(self, people, seeded):
        assert [c["familyName"] for c in people.clinicians(TENANT, name="eto")] == ["Etoa"]

    def test_by_given_name_too(self, people, seeded):
        assert len(people.clinicians(TENANT, name="Paul")) == 3

    def test_filters_combine(self, people, seeded):
        found = people.clinicians(TENANT, specialty="Paediatrics", clinic_id=DOUALA)
        assert [c["familyName"] for c in found] == ["Etoa"]

    def test_a_filter_matching_nothing_is_an_empty_list(self, people, seeded):
        assert people.clinicians(TENANT, specialty="Neurosurgery") == []


class TestSuspension:
    def test_a_suspended_clinician_leaves_the_directory(self, people, seeded):
        people.set_status(tenant_id=TENANT, staff_id=seeded["Etoa"], status="SUSPENDED")
        assert "Etoa" not in {c["familyName"] for c in people.clinicians(TENANT)}

    def test_the_profile_itself_is_kept(self, people, seeded, repository):
        """Leaving the listing is not the same as being deleted."""
        people.set_status(tenant_id=TENANT, staff_id=seeded["Etoa"], status="SUSPENDED")
        profile = repository.get(keys.clinician_profile(TENANT, seeded["Etoa"]))
        assert profile is not None
        assert "directoryKey" not in profile
        assert profile["registrationYear"] == 2012

    def test_reinstating_puts_them_back_in_order(self, people, seeded):
        people.set_status(tenant_id=TENANT, staff_id=seeded["Etoa"], status="SUSPENDED")
        people.set_status(tenant_id=TENANT, staff_id=seeded["Etoa"], status="ACTIVE")
        listed = [c["familyName"] for c in people.clinicians(TENANT)]
        assert listed == ["Abena", "Etoa", "Manga"]

    def test_an_ended_account_leaves_the_directory(self, people, seeded):
        people.set_status(tenant_id=TENANT, staff_id=seeded["Manga"], status="ENDED")
        assert "Manga" not in {c["familyName"] for c in people.clinicians(TENANT)}

    def test_suspending_a_receptionist_touches_no_profile(self, people, seeded):
        """Only a clinician has a profile to take out of the directory."""
        _person, membership = people.create_staff_account(
            tenant_id=TENANT,
            account=rules.StaffAccount(
                given_name="Ruth",
                family_name="Mba",
                phone_e164="+237600008888",
                roles=("RECEPTIONIST",),
                clinic_id=DOUALA,
            ),
        )
        people.set_status(
            tenant_id=TENANT, staff_id=membership["staffMembershipId"], status="SUSPENDED"
        )
        assert len(people.clinicians(TENANT)) == 3
