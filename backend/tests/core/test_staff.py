"""A staff account cannot exist without what its roles require.

Verifies FR-ACC-03 (self-registration is for patients only, so no staff account
carries the patient role), FR-ACC-04 (a tenant administrator creates each
account with its roles, and the required fields depend on the role) and
FR-ACC-18 (roles change only at the next sign-in).
"""

from __future__ import annotations

import pytest
from atria_spec import roles as spec

from atria.core import staff
from atria.core.errors import Invalid

YEAR = 2026

RECEPTIONIST = {
    "givenName": "Amina",
    "familyName": "Ngo",
    "phoneE164": "+237600000001",
    "clinicId": "c-douala-01",
    "roles": ["RECEPTIONIST"],
}

CLINICIAN = {
    "givenName": "Paul",
    "familyName": "Etoa",
    "phoneE164": "+237600000002",
    "clinicId": "c-douala-01",
    "roles": ["CLINICIAN"],
    "specialty": "Paediatrics",
    "registrationYear": 2012,
    "ordreNumber": "CM-ONMC-12345",
    "languages": ["fr", "en"],
}

ADMIN = {
    "givenName": "Ruth",
    "familyName": "Mbah",
    "phoneE164": "+237600000003",
    "email": "ruth@clinic.test",
    "roles": ["TENANT_ADMIN"],
}


class TestRoles:
    def test_the_staff_roles_are_every_role_except_patient(self):
        assert set(staff.STAFF_ROLES) == set(spec.ROLES) - {"PATIENT"}

    def test_a_staff_account_cannot_carry_the_patient_role(self):
        # FR-ACC-03. A person who is also a patient uses the patient app.
        with pytest.raises(Invalid, match="non staff role"):
            staff.validate({**RECEPTIONIST, "roles": ["PATIENT"]}, current_year=YEAR)

    def test_an_invented_role_is_refused(self):
        with pytest.raises(Invalid) as raised:
            staff.validate({**RECEPTIONIST, "roles": ["SUPERUSER"]}, current_year=YEAR)
        assert raised.value.detail["roles"] == ["SUPERUSER"]

    def test_no_roles_is_refused(self):
        with pytest.raises(Invalid, match="at least one role"):
            staff.validate({**RECEPTIONIST, "roles": []}, current_year=YEAR)

    def test_a_repeated_role_is_refused(self):
        with pytest.raises(Invalid, match="listed twice"):
            staff.validate(
                {**RECEPTIONIST, "roles": ["RECEPTIONIST", "RECEPTIONIST"]}, current_year=YEAR
            )

    def test_two_roles_on_one_account_are_allowed(self):
        account = staff.validate(
            {**RECEPTIONIST, "roles": ["RECEPTIONIST", "CLINIC_MANAGER"]}, current_year=YEAR
        )
        assert account.roles == ("RECEPTIONIST", "CLINIC_MANAGER")


class TestRequiredFields:
    def test_the_requirements_come_from_the_specification(self):
        assert staff.required_fields(("RECEPTIONIST",)) == spec.REQUIRED_ON_CREATE["RECEPTIONIST"]

    def test_two_roles_require_the_union_of_their_fields(self):
        needed = staff.required_fields(("RECEPTIONIST", "CLINICIAN"))
        assert set(needed) == set(spec.REQUIRED_ON_CREATE["RECEPTIONIST"]) | set(
            spec.REQUIRED_ON_CREATE["CLINICIAN"]
        )

    @pytest.mark.parametrize("missing", ["givenName", "familyName", "phoneE164", "clinicId"])
    def test_a_receptionist_needs_every_one_of_its_fields(self, missing):
        body = {**RECEPTIONIST}
        del body[missing]
        with pytest.raises(Invalid) as raised:
            staff.validate(body, current_year=YEAR)
        assert missing in raised.value.detail["missing"]

    @pytest.mark.parametrize(
        "missing", ["specialty", "registrationYear", "ordreNumber", "languages"]
    )
    def test_a_clinician_needs_the_listing_fields_too(self, missing):
        body = {**CLINICIAN}
        del body[missing]
        with pytest.raises(Invalid) as raised:
            staff.validate(body, current_year=YEAR)
        assert missing in raised.value.detail["missing"]

    def test_a_tenant_administrator_needs_an_email_and_no_clinic(self):
        account = staff.validate(ADMIN, current_year=YEAR)
        assert account.email == "ruth@clinic.test"
        assert account.clinic_id is None

    def test_a_clinic_scoped_role_without_a_clinic_is_refused(self):
        body = {**ADMIN, "roles": ["CLINIC_MANAGER"], "email": None}
        with pytest.raises(Invalid) as raised:
            staff.validate(body, current_year=YEAR)
        assert "clinicId" in str(raised.value.detail.get("missing", raised.value.message))

    def test_blank_text_counts_as_missing(self):
        with pytest.raises(Invalid) as raised:
            staff.validate({**RECEPTIONIST, "givenName": "   "}, current_year=YEAR)
        assert "givenName" in raised.value.detail["missing"]


class TestFormats:
    @pytest.mark.parametrize(
        "phone",
        ["600000001", "+237 600 000 001", "237600000001", "+0600000001", "+2376000000011111"],
    )
    def test_a_phone_that_is_not_e164_is_refused(self, phone):
        with pytest.raises(Invalid, match="E.164"):
            staff.validate({**RECEPTIONIST, "phoneE164": phone}, current_year=YEAR)

    def test_a_cameroon_mobile_is_accepted(self):
        assert staff.validate(RECEPTIONIST, current_year=YEAR).phone_e164 == "+237600000001"

    def test_a_malformed_email_is_refused(self):
        with pytest.raises(Invalid, match="email"):
            staff.validate({**ADMIN, "email": "ruth@clinic"}, current_year=YEAR)

    def test_a_registration_year_in_the_future_is_refused(self):
        with pytest.raises(Invalid, match="out of range"):
            staff.validate({**CLINICIAN, "registrationYear": YEAR + 1}, current_year=YEAR)

    def test_a_registration_year_before_the_roll_is_refused(self):
        with pytest.raises(Invalid, match="out of range"):
            staff.validate({**CLINICIAN, "registrationYear": 1900}, current_year=YEAR)

    def test_a_registration_year_that_is_text_is_refused(self):
        with pytest.raises(Invalid, match="whole number"):
            staff.validate({**CLINICIAN, "registrationYear": "2012"}, current_year=YEAR)

    def test_a_boolean_is_not_a_year(self):
        with pytest.raises(Invalid, match="whole number"):
            staff.validate({**CLINICIAN, "registrationYear": True}, current_year=YEAR)

    def test_a_non_list_language_field_is_refused(self):
        with pytest.raises(Invalid, match="list of text"):
            staff.validate({**CLINICIAN, "languages": "fr"}, current_year=YEAR)


class TestClinician:
    def test_a_clinician_keeps_its_listing_facts(self):
        account = staff.validate(CLINICIAN, current_year=YEAR)
        assert account.is_clinician
        assert account.specialty == "Paediatrics"
        assert account.registration_year == 2012
        assert account.languages == ("fr", "en")

    def test_a_receptionist_is_not_a_clinician(self):
        assert not staff.validate(RECEPTIONIST, current_year=YEAR).is_clinician


class TestSeniorityBand:
    @pytest.mark.parametrize(
        ("registered", "band"),
        [
            (2026, "RECENT"),
            (2024, "RECENT"),
            (2023, "ESTABLISHED"),
            (2016, "EXPERIENCED"),
            (2000, "SENIOR"),
        ],
    )
    def test_the_band_comes_from_the_year_on_the_roll(self, registered, band):
        # ADR 0011: the directory sorts by seniority, never by a score.
        assert staff.seniority_band(registered, current_year=YEAR) == band


class TestRolesChange:
    def test_the_new_roles_are_validated_the_same_way(self):
        assert staff.validate_roles_change({"roles": ["CLINICIAN"]}) == ("CLINICIAN",)
        with pytest.raises(Invalid):
            staff.validate_roles_change({"roles": ["PATIENT"]})
        with pytest.raises(Invalid):
            staff.validate_roles_change({"roles": []})
