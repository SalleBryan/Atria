"""The authoriser accepts a good token and denies everything else.

Verifies FR-ACC-11 (an account carries only its own roles), FR-ACC-12 (no role
switching in a session) and NFR-SEC: a refusal says nothing about why.

Tokens here are signed with a throwaway key pair generated in the test, and the
key lookup is stubbed, so nothing reaches Cognito.
"""

from __future__ import annotations

import datetime as dt

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from atria.core.errors import Unauthenticated
from atria.services.authoriser import handler
from atria.services.authoriser import token as token_module

ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test"
CLIENT = "patient-client-id"
AUDIENCES = (CLIENT, "staff-client-id")


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _stub_key_lookup(monkeypatch, signing_key):
    """Return the test public key instead of fetching the pool's JWKS."""

    class _Key:
        key = signing_key.public_key()

    class _Client:
        def get_signing_key_from_jwt(self, _token):
            return _Key()

    token_module._jwks_client.cache_clear()
    monkeypatch.setattr(token_module, "_jwks_client", lambda _issuer: _Client())


def make_token(signing_key, **overrides) -> str:
    now = dt.datetime.now(tz=dt.UTC)
    payload = {
        "sub": "cognito-sub-1",
        "token_use": "access",
        "client_id": CLIENT,
        "iss": ISSUER,
        "iat": now,
        "exp": now + dt.timedelta(hours=1),
        "custom:tenantId": "t-cm-001",
        "custom:personId": "p-1",
        "custom:roles": "RECEPTIONIST",
    }
    payload.update(overrides)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, signing_key, algorithm="RS256")


class TestVerify:
    def test_a_valid_access_token_resolves_the_caller(self, signing_key):
        claims = token_module.verify(make_token(signing_key), issuer=ISSUER, audiences=AUDIENCES)
        assert claims.person_id == "p-1"
        assert claims.tenant_id == "t-cm-001"
        assert claims.roles == ("RECEPTIONIST",)

    def test_several_roles_are_split(self, signing_key):
        claims = token_module.verify(
            make_token(signing_key, **{"custom:roles": "CLINICIAN,CLINIC_MANAGER"}),
            issuer=ISSUER,
            audiences=AUDIENCES,
        )
        assert claims.roles == ("CLINICIAN", "CLINIC_MANAGER")

    def test_an_expired_token_is_refused(self, signing_key):
        past = dt.datetime.now(tz=dt.UTC) - dt.timedelta(hours=2)
        with pytest.raises(Unauthenticated):
            token_module.verify(
                make_token(signing_key, iat=past, exp=past + dt.timedelta(minutes=5)),
                issuer=ISSUER,
                audiences=AUDIENCES,
            )

    def test_an_id_token_is_refused(self, signing_key):
        with pytest.raises(Unauthenticated, match="access token"):
            token_module.verify(
                make_token(signing_key, token_use="id"), issuer=ISSUER, audiences=AUDIENCES
            )

    def test_a_token_for_another_client_is_refused(self, signing_key):
        with pytest.raises(Unauthenticated, match="another client"):
            token_module.verify(
                make_token(signing_key, client_id="someone-elses-app"),
                issuer=ISSUER,
                audiences=AUDIENCES,
            )

    def test_a_token_from_another_issuer_is_refused(self, signing_key):
        with pytest.raises(Unauthenticated):
            token_module.verify(
                make_token(signing_key, iss="https://example.test/other"),
                issuer=ISSUER,
                audiences=AUDIENCES,
            )

    def test_an_unprovisioned_account_is_refused(self, signing_key):
        # No tenant or person attribute yet: the account cannot be used.
        with pytest.raises(Unauthenticated, match="not provisioned"):
            token_module.verify(
                make_token(signing_key, **{"custom:tenantId": None}),
                issuer=ISSUER,
                audiences=AUDIENCES,
            )

    def test_an_empty_token_is_refused(self):
        with pytest.raises(Unauthenticated):
            token_module.verify("", issuer=ISSUER, audiences=AUDIENCES)


METHOD_ARN = "arn:aws:execute-api:us-east-1:340752829171:abc123/dev/GET/me"


def request_event(authorization: str | None) -> dict[str, object]:
    headers = {"Authorization": authorization} if authorization is not None else {}
    return {"type": "REQUEST", "methodArn": METHOD_ARN, "headers": headers}


class TestHandler:
    @pytest.fixture(autouse=True)
    def _configure(self, monkeypatch):
        monkeypatch.setattr(handler, "ISSUER", ISSUER)
        monkeypatch.setattr(handler, "AUDIENCES", AUDIENCES)

    def test_a_good_token_is_allowed_with_the_caller_in_the_context(self, signing_key):
        result = handler.handler(request_event(f"Bearer {make_token(signing_key)}"), None)
        statement = result["policyDocument"]["Statement"][0]
        assert statement["Effect"] == "Allow"
        assert result["principalId"] == "p-1"
        assert result["context"]["tenantId"] == "t-cm-001"
        assert result["context"]["roles"] == "RECEPTIONIST"
        # The context carries what the account may do, for the client's own hiding.
        assert "appointment.read" in result["context"]["permissions"].split(",")

    def test_the_policy_covers_the_whole_stage_so_it_can_be_cached(self, signing_key):
        result = handler.handler(request_event(f"Bearer {make_token(signing_key)}"), None)
        resource = result["policyDocument"]["Statement"][0]["Resource"]
        assert resource == "arn:aws:execute-api:us-east-1:340752829171:abc123/dev/*"

    def test_no_token_is_denied(self):
        result = handler.handler(request_event(None), None)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"
        assert result["context"] == {}

    def test_a_denial_says_nothing_about_why(self, signing_key):
        result = handler.handler(request_event("Bearer not-a-token"), None)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"
        assert result["principalId"] == "anonymous"
        assert result["context"] == {}

    def test_an_unknown_role_in_the_token_is_denied(self, signing_key):
        # A misprovisioned account must not be treated as having no permissions;
        # it is refused outright.
        token = make_token(signing_key, **{"custom:roles": "SUPERUSER"})
        result = handler.handler(request_event(f"Bearer {token}"), None)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Deny"

    def test_a_bare_token_without_the_bearer_prefix_is_accepted(self, signing_key):
        result = handler.handler(request_event(make_token(signing_key)), None)
        assert result["policyDocument"]["Statement"][0]["Effect"] == "Allow"

    def test_a_lowercase_header_name_is_read(self, signing_key):
        event = {
            "methodArn": METHOD_ARN,
            "headers": {"authorization": f"Bearer {make_token(signing_key)}"},
        }
        assert handler.handler(event, None)["policyDocument"]["Statement"][0]["Effect"] == "Allow"
