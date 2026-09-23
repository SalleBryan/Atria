"""A confirmed patient gets the records their sign-in needs.

Verifies FR-ACC-01 (a patient registers and confirms their email before first
sign-in) and FR-ACC-07 (the caller resolves to a tenant, a person and roles),
which is what the records written here make possible.

The failure this guards against is specific: Cognito does not undo a
confirmation when the trigger fails, so a confirmed account with no person
record can sign in and be refused by the authoriser with nothing to fix it.
"""

from __future__ import annotations

import pytest

from atria.data.people import People
from atria.services.identity import post_confirmation as trigger

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
SUBJECT = "sub-patient-1"


@pytest.fixture
def wired(monkeypatch, repository):
    monkeypatch.setattr(trigger, "_people", People(repository))
    monkeypatch.setattr(trigger, "DEFAULT_TENANT_ID", TENANT)
    return repository


def event(
    *, source: str = trigger.SIGN_UP_SOURCE, subject: str = SUBJECT, **attributes: str
) -> dict[str, object]:
    base = {
        "sub": subject,
        "email": "patient@atria.invalid",
        "phone_number": "+237600000001",
        "given_name": "Amina",
        "family_name": "Ngo",
    }
    base.update(attributes)
    return {
        "triggerSource": source,
        "userPoolId": "us-east-1_test",
        "request": {"userAttributes": base},
        "response": {},
    }


class TestSignUp:
    def test_the_person_and_the_profile_are_written(self, wired):
        trigger.handler(event(), None)
        resolved = People(wired).resolve(SUBJECT)
        assert resolved is not None
        assert resolved.tenant_id == TENANT
        assert resolved.patient_profile_id

    def test_the_account_resolves_to_the_patient_role(self, wired):
        """A patient profile and no membership is what PATIENT means."""
        trigger.handler(event(), None)
        resolved = People(wired).resolve(SUBJECT)
        assert resolved is not None
        assert resolved.roles == ("PATIENT",)

    def test_the_tenant_comes_from_configuration_not_the_account(self, wired):
        """A self-registering account cannot choose which clinic it joins."""
        trigger.handler(event(**{"custom:tenantId": "t-somebody-elses"}), None)
        resolved = People(wired).resolve(SUBJECT)
        assert resolved is not None
        assert resolved.tenant_id == TENANT

    def test_what_cognito_knows_is_carried_over(self, wired):
        trigger.handler(event(), None)
        person = People(wired).by_cognito_sub(SUBJECT)
        assert person is not None
        assert person["givenName"] == "Amina"
        assert person["email"] == "patient@atria.invalid"
        assert person["phoneE164"] == "+237600000001"

    def test_the_phone_is_not_treated_as_verified(self, wired):
        """FR-ACC-09 and the reminder path rely on a one time code for that."""
        trigger.handler(event(), None)
        resolved = People(wired).resolve(SUBJECT)
        assert resolved is not None
        assert resolved.phone_verified is False

    def test_the_event_is_returned_unchanged(self, wired):
        """Cognito requires the event back; altering it would break the flow."""
        given = event()
        assert trigger.handler(given, None) is given


class TestRepeatedDelivery:
    def test_a_second_delivery_writes_nothing_further(self, wired):
        """Cognito can deliver the same confirmation more than once."""
        trigger.handler(event(), None)
        first = People(wired).by_cognito_sub(SUBJECT)
        trigger.handler(event(), None)
        second = People(wired).by_cognito_sub(SUBJECT)
        assert first is not None
        assert second is not None
        assert first["personId"] == second["personId"]

    def test_a_password_reset_is_not_a_new_account(self, wired):
        """Cognito reuses this trigger for a confirmed forgotten password."""
        trigger.handler(event(source="PostConfirmation_ConfirmForgotPassword"), None)
        assert People(wired).by_cognito_sub(SUBJECT) is None

    def test_a_staff_account_is_not_given_a_patient_profile(self, wired, repository):
        """Staff are provisioned by an administrator and already have a person."""
        from atria.core import staff as rules

        People(repository).create_staff_account(
            tenant_id=TENANT,
            account=rules.StaffAccount(
                given_name="Amina",
                family_name="Ngo",
                phone_e164="+237600000002",
                roles=("RECEPTIONIST",),
                clinic_id="c-douala-01",
            ),
            cognito_sub="sub-staff-1",
        )
        trigger.handler(event(subject="sub-staff-1"), None)
        resolved = People(repository).resolve("sub-staff-1")
        assert resolved is not None
        assert resolved.roles == ("RECEPTIONIST",)
        assert resolved.patient_profile_id is None


class TestRefusals:
    def test_an_event_with_no_subject_is_raised_so_cognito_retries(self, wired):
        with pytest.raises(RuntimeError):
            trigger.handler(event(subject=""), None)

    def test_an_unconfigured_tenant_is_raised_rather_than_guessed(self, monkeypatch, wired):
        monkeypatch.setattr(trigger, "DEFAULT_TENANT_ID", "")
        with pytest.raises(RuntimeError):
            trigger.handler(event(), None)
        assert People(wired).by_cognito_sub(SUBJECT) is None
