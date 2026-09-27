# ruff: noqa: F401, F811  the key fixtures are imported, and pytest passes them by name
"""An administrator acts only after a second factor, and not for ever.

Verifies FR-ACC-11 (a tenant administrator signs in with an authenticator:
without one the role grants nothing and the console asks for one) and
FR-ACC-10 (an administrator's session ends a day after they signed in, however
often it refreshed).
"""

from __future__ import annotations

import time
from unittest.mock import Mock

import pytest
from test_authoriser import (
    AUDIENCES,
    ISSUER,
    _stub_key_lookup,
    make_token,
    request_event,
    signing_key,
)

from atria.core import permissions
from atria.core.principal import Principal
from atria.services.authoriser import handler
from atria.services.identity import handler as identity
from atria.services.identity import pre_token

ADMIN_CLAIMS = {"custom:roles": "TENANT_ADMIN"}


def admin(**extra) -> Principal:
    return Principal(person_id="p-1", tenant_id="t-1", roles=("TENANT_ADMIN",), **extra)


class TestActingRoles:
    def test_fr_acc_11_an_admin_without_a_second_factor_holds_no_powers(self):
        assert permissions.granted_to(admin(second_factor=False)) == {}
        assert admin(second_factor=False).needs_second_factor

    def test_with_one_the_role_acts(self):
        assert permissions.granted_to(admin())
        assert not admin().needs_second_factor

    def test_another_role_on_the_same_account_still_acts(self):
        both = Principal(
            person_id="p-1",
            tenant_id="t-1",
            roles=("TENANT_ADMIN", "CLINIC_MANAGER"),
            clinic_id="u-1",
            second_factor=False,
        )
        assert both.acting_roles == ("CLINIC_MANAGER",)
        assert permissions.granted_to(both)

    def test_other_roles_never_need_one(self):
        desk = Principal(
            person_id="p-1", tenant_id="t-1", roles=("RECEPTIONIST",), second_factor=False
        )
        assert not desk.needs_second_factor


class TestAuthoriser:
    @pytest.fixture(autouse=True)
    def _configure(self, monkeypatch):
        monkeypatch.setattr(handler, "ISSUER", ISSUER)
        monkeypatch.setattr(handler, "AUDIENCES", AUDIENCES)

    def call(self, key, **claims):
        return handler.handler(request_event(f"Bearer {make_token(key, **claims)}"), None)

    def test_an_admin_without_the_claim_is_allowed_in_but_holds_nothing(self, signing_key):
        """Allowed, so GET /me can tell the console to set up an authenticator."""
        result = self.call(signing_key, **ADMIN_CLAIMS)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Allow"
        assert result["context"]["secondFactor"] == "false"
        assert result["context"]["permissions"] == ""

    def test_the_claim_restores_the_role(self, signing_key):
        result = self.call(signing_key, secondFactor="true", **ADMIN_CLAIMS)
        assert result["context"]["secondFactor"] == "true"
        assert "staff.create" in result["context"]["permissions"].split(",")

    def test_a_desk_account_is_never_asked(self, signing_key):
        assert self.call(signing_key)["context"]["secondFactor"] == "true"

    def test_fr_acc_10_an_admin_session_ends_after_a_day(self, signing_key):
        stale = int(time.time()) - handler.ADMIN_SESSION_SECONDS - 60
        result = self.call(signing_key, secondFactor="true", auth_time=stale, **ADMIN_CLAIMS)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"

    def test_a_fresh_admin_session_is_allowed(self, signing_key):
        fresh = int(time.time()) - 3600
        result = self.call(signing_key, secondFactor="true", auth_time=fresh, **ADMIN_CLAIMS)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Allow"

    def test_a_desk_session_is_not_held_to_it(self, signing_key):
        stale = int(time.time()) - handler.ADMIN_SESSION_SECONDS - 60
        result = self.call(signing_key, auth_time=stale)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Allow"


class TestPreToken:
    def event(self, roles: str) -> dict[str, object]:
        return {
            "triggerSource": "TokenGeneration_RefreshTokens",
            "userPoolId": "us-east-1_test",
            "userName": "admin@example.test",
            "request": {
                "userAttributes": {
                    "custom:tenantId": "t-1",
                    "custom:personId": "p-1",
                    "custom:roles": roles,
                }
            },
        }

    def claims(self, result):
        return result["response"]["claimsAndScopeOverrideDetails"]["accessTokenGeneration"][
            "claimsToAddOrOverride"
        ]

    @pytest.fixture
    def cognito(self, monkeypatch):
        client = Mock()
        monkeypatch.setattr(pre_token, "_cognito", client)
        monkeypatch.setattr(pre_token, "resolve_claims", pre_token.resolve_claims)
        monkeypatch.setattr(pre_token, "_people", Mock(resolve=Mock(return_value=None)))
        return client

    def test_an_enabled_authenticator_is_claimed(self, cognito):
        cognito.admin_get_user.return_value = {"UserMFASettingList": ["SOFTWARE_TOKEN_MFA"]}
        claims = self.claims(pre_token.handler(self.event("TENANT_ADMIN"), None))
        assert claims["secondFactor"] == "true"
        cognito.admin_get_user.assert_called_once_with(
            UserPoolId="us-east-1_test", Username="admin@example.test"
        )

    def test_an_account_without_one_is_not(self, cognito):
        cognito.admin_get_user.return_value = {}
        assert "secondFactor" not in self.claims(
            pre_token.handler(self.event("TENANT_ADMIN"), None)
        )

    def test_a_failed_lookup_says_no(self, cognito):
        cognito.admin_get_user.side_effect = RuntimeError("throttled")
        assert "secondFactor" not in self.claims(
            pre_token.handler(self.event("TENANT_ADMIN"), None)
        )

    def test_other_roles_are_not_looked_up(self, cognito):
        pre_token.handler(self.event("RECEPTIONIST"), None)
        cognito.admin_get_user.assert_not_called()


class TestMe:
    def test_the_console_is_told_to_ask(self):
        assert identity.me(admin(second_factor=False))["secondFactorRequired"] is True
        assert identity.me(admin())["secondFactorRequired"] is False
