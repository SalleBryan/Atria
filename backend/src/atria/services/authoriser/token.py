"""Cognito token verification.

The pool's public keys are fetched once per container and cached, so a warm
invocation verifies without a network call. A token is accepted only when the
signature, the issuer, the audience, the token use and the expiry all hold.

Claims used: sub, the tenant, the person and the roles the account was created
with. They reach the access token through the pre-token generation trigger in
atria.services.identity.pre_token, because Cognito leaves custom attributes out
of the access token. Roles come from the token because they are fixed at
account creation and cannot change inside a session (ADR 0015).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient

from atria.core.errors import Unauthenticated

# Cognito puts custom attributes behind this prefix in the token.
CUSTOM = "custom:"


@dataclass(frozen=True, slots=True)
class Claims:
    """The parts of a verified token the services need."""

    subject: str
    tenant_id: str
    person_id: str
    roles: tuple[str, ...]
    client_id: str
    raw: dict[str, Any]


@lru_cache(maxsize=4)
def _jwks_client(issuer: str) -> PyJWKClient:
    """One client per pool, cached for the life of the container."""
    return PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True)


def verify(token: str, *, issuer: str, audiences: tuple[str, ...]) -> Claims:
    """Verify an access token and return its claims, or raise Unauthenticated."""
    if not token:
        raise Unauthenticated("no token")

    try:
        signing_key = _jwks_client(issuer).get_signing_key_from_jwt(token)
        payload: dict[str, Any] = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"require": ["exp", "iat", "sub", "token_use"], "verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        # The reason is logged by the caller, never returned: a caller learns
        # only that the token was not accepted.
        raise Unauthenticated("the token was not accepted") from exc

    # Cognito access tokens carry client_id rather than aud.
    if payload.get("token_use") != "access":
        raise Unauthenticated("an access token is required")
    client_id = str(payload.get("client_id", ""))
    if client_id not in audiences:
        raise Unauthenticated("the token was issued to another client")

    # The pre-token generation trigger writes plain claim names into the access
    # token. The custom: prefixed form is what an id token carries, and is read
    # as a fallback so a token from either source resolves the same caller.
    tenant_id = payload.get("tenantId") or payload.get(f"{CUSTOM}tenantId")
    person_id = payload.get("personId") or payload.get(f"{CUSTOM}personId")
    roles = payload.get("roles") or payload.get(f"{CUSTOM}roles")
    if not tenant_id or not person_id or not roles:
        # An account is not usable until the identity service has set these.
        raise Unauthenticated("the account is not provisioned")

    return Claims(
        subject=str(payload["sub"]),
        tenant_id=str(tenant_id),
        person_id=str(person_id),
        roles=tuple(r.strip() for r in str(roles).split(",") if r.strip()),
        client_id=client_id,
        raw=payload,
    )
