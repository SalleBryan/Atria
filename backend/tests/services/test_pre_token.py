"""The trigger puts the caller into the access token, and nothing else.

Cognito leaves custom attributes out of the access token, and the API
authorises on the access token, so without this trigger the authoriser has a
valid token it cannot resolve a caller from.

Verifies FR-ACC-11 and FR-ACC-12: an account carries the roles it was created
with, and nothing a client sends can change them.
"""

from __future__ import annotations

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


class TestClaims:
    def test_the_tenant_person_and_roles_are_added(self):
        assert pre_token.claims_from(STAFF) == {
            "tenantId": "t-cm-001",
            "personId": "p-1",
            "roles": "RECEPTIONIST",
        }

    def test_several_roles_survive(self):
        claims = pre_token.claims_from({**STAFF, "custom:roles": "CLINICIAN,CLINIC_MANAGER"})
        assert claims["roles"] == "CLINICIAN,CLINIC_MANAGER"

    def test_an_unknown_role_is_dropped(self):
        """A typo in an attribute must not become a permission."""
        claims = pre_token.claims_from({**STAFF, "custom:roles": "RECEPTIONIST,SUPERUSER"})
        assert claims["roles"] == "RECEPTIONIST"

    def test_a_wholly_unknown_role_list_leaves_no_roles_claim(self):
        claims = pre_token.claims_from({**STAFF, "custom:roles": "SUPERUSER"})
        assert "roles" not in claims

    def test_a_half_provisioned_account_gets_only_what_it_has(self):
        """The authoriser refuses such a token, which is the right answer."""
        claims = pre_token.claims_from({"custom:tenantId": "t-cm-001"})
        assert claims == {"tenantId": "t-cm-001"}

    def test_nothing_else_from_the_account_reaches_the_token(self):
        claims = pre_token.claims_from(
            {**STAFF, "email": "someone@example.test", "phone_number": "+237600000000"}
        )
        assert set(claims) == {"tenantId", "personId", "roles"}

    def test_an_empty_account_yields_no_claims(self):
        assert pre_token.claims_from({}) == {}


class TestHandler:
    def test_the_claims_go_on_both_tokens(self):
        result = pre_token.handler(event(**STAFF), None)
        override = result["response"]["claimsAndScopeOverrideDetails"]
        for section in ("accessTokenGeneration", "idTokenGeneration"):
            assert override[section]["claimsToAddOrOverride"]["roles"] == "RECEPTIONIST"

    def test_the_event_is_returned_for_cognito(self):
        given = event(**STAFF)
        result = pre_token.handler(given, None)
        assert result["userPoolId"] == "us-east-1_test"
        assert "response" in result
