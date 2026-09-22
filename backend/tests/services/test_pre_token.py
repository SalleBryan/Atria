"""The trigger puts the caller into the access token, and nothing else.

Cognito leaves custom attributes out of the access token, and the API
authorises on the access token, so without this trigger the authoriser has a
valid token it cannot resolve a caller from.

Verifies FR-ACC-11 and FR-ACC-12: an account carries the roles it was created
with, and nothing a client sends can change them. Also ADR 0017: the person
record is the preferred source, and the account's own attributes are the
fallback for a sign-in with no person record yet.
"""

from __future__ import annotations

from unittest.mock import Mock

from atria.data.people import ResolvedPerson
from atria.services.identity import pre_token


def event(**attributes: str) -> dict[str, object]:
    return {
        "triggerSource": "TokenGeneration_Authentication",
        "userPoolId": "us-east-1_test",
        "request": {"userAttributes": attributes},
    }


STAFF = {
    "custom:tenantId": "t-cm-001",
    "custom:personId": "p-1",
    "custom:roles": "RECEPTIONIST",
}


class TestClaimsFromAttributes:
    """The fallback path: an account with no person record yet."""

    def test_the_tenant_person_and_roles_are_added(self):
        assert pre_token.claims_from_attributes(STAFF) == {
            "tenantId": "t-cm-001",
            "personId": "p-1",
            "roles": "RECEPTIONIST",
        }

    def test_several_roles_survive(self):
        claims = pre_token.claims_from_attributes(
            {**STAFF, "custom:roles": "CLINICIAN,CLINIC_MANAGER"}
        )
        assert claims["roles"] == "CLINICIAN,CLINIC_MANAGER"

    def test_an_unknown_role_is_dropped(self):
        """A typo in an attribute must not become a permission."""
        claims = pre_token.claims_from_attributes(
            {**STAFF, "custom:roles": "RECEPTIONIST,SUPERUSER"}
        )
        assert claims["roles"] == "RECEPTIONIST"

    def test_a_wholly_unknown_role_list_leaves_no_roles_claim(self):
        claims = pre_token.claims_from_attributes({**STAFF, "custom:roles": "SUPERUSER"})
        assert "roles" not in claims

    def test_a_half_provisioned_account_gets_only_what_it_has(self):
        """The authoriser refuses such a token, which is the right answer."""
        claims = pre_token.claims_from_attributes({"custom:tenantId": "t-cm-001"})
        assert claims == {"tenantId": "t-cm-001"}

    def test_nothing_else_from_the_account_reaches_the_token(self):
        claims = pre_token.claims_from_attributes(
            {**STAFF, "email": "someone@example.test", "phone_number": "+237600000000"}
        )
        assert set(claims) == {"tenantId", "personId", "roles"}

    def test_an_empty_account_yields_no_claims(self):
        assert pre_token.claims_from_attributes({}) == {}


class TestClaimsFromPerson:
    """The preferred path: a resolved person record."""

    def test_a_staff_person_yields_the_full_set(self):
        resolved = ResolvedPerson(
            person_id="p-1",
            tenant_id="t-cm-001",
            roles=("RECEPTIONIST",),
            staff_id="s-1",
            clinic_id="c-douala-01",
            phone_verified=True,
            languages=("fr",),
        )
        claims = pre_token.claims_from_person(resolved)
        assert claims == {
            "personId": "p-1",
            "tenantId": "t-cm-001",
            "roles": "RECEPTIONIST",
            "staffId": "s-1",
            "clinicId": "c-douala-01",
            "phoneVerified": "true",
            "languages": "fr",
        }

    def test_a_patient_only_person_carries_no_staff_claims(self):
        resolved = ResolvedPerson(
            person_id="p-2",
            tenant_id="t-cm-001",
            roles=("PATIENT",),
            patient_profile_id="pp-1",
        )
        claims = pre_token.claims_from_person(resolved)
        assert claims == {
            "personId": "p-2",
            "tenantId": "t-cm-001",
            "roles": "PATIENT",
            "patientProfileId": "pp-1",
        }

    def test_a_suspended_membership_yields_no_roles_claim(self):
        resolved = ResolvedPerson(person_id="p-3", tenant_id=None, roles=())
        claims = pre_token.claims_from_person(resolved)
        assert claims == {"personId": "p-3"}


class TestResolveClaims:
    def test_a_subject_that_resolves_uses_the_person_record(self, monkeypatch):
        resolved = ResolvedPerson(
            person_id="p-1", tenant_id="t-cm-001", roles=("RECEPTIONIST",), staff_id="s-1"
        )
        fake = Mock()
        fake.resolve.return_value = resolved
        monkeypatch.setattr(pre_token, "people", lambda: fake)

        claims = pre_token.resolve_claims(event(sub="sub-1", **STAFF))
        assert claims["staffId"] == "s-1"
        fake.resolve.assert_called_once_with("sub-1")

    def test_a_subject_with_no_person_record_falls_back_to_attributes(self, monkeypatch):
        fake = Mock()
        fake.resolve.return_value = None
        monkeypatch.setattr(pre_token, "people", lambda: fake)

        claims = pre_token.resolve_claims(event(sub="sub-2", **STAFF))
        assert claims == {"tenantId": "t-cm-001", "personId": "p-1", "roles": "RECEPTIONIST"}

    def test_a_lookup_failure_falls_back_to_attributes_rather_than_failing_sign_in(self, monkeypatch):
        fake = Mock()
        fake.resolve.side_effect = RuntimeError("table unavailable")
        monkeypatch.setattr(pre_token, "people", lambda: fake)

        claims = pre_token.resolve_claims(event(sub="sub-3", **STAFF))
        assert claims["roles"] == "RECEPTIONIST"

    def test_no_subject_at_all_uses_attributes(self, monkeypatch):
        fake = Mock()
        monkeypatch.setattr(pre_token, "people", lambda: fake)

        claims = pre_token.resolve_claims(event(**STAFF))
        assert claims["roles"] == "RECEPTIONIST"
        fake.resolve.assert_not_called()


class TestHandler:
    def test_the_claims_go_on_both_tokens(self, monkeypatch):
        fake = Mock()
        fake.resolve.return_value = None
        monkeypatch.setattr(pre_token, "people", lambda: fake)

        result = pre_token.handler(event(**STAFF), None)
        override = result["response"]["claimsAndScopeOverrideDetails"]
        for section in ("accessTokenGeneration", "idTokenGeneration"):
            assert override[section]["claimsToAddOrOverride"]["roles"] == "RECEPTIONIST"

    def test_the_event_is_returned_for_cognito(self, monkeypatch):
        fake = Mock()
        fake.resolve.return_value = None
        monkeypatch.setattr(pre_token, "people", lambda: fake)

        given = event(**STAFF)
        result = pre_token.handler(given, None)
        assert result["userPoolId"] == "us-east-1_test"
        assert "response" in result
