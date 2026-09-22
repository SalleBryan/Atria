"""The permission matrix, applied.

The matrix in the specification says what each role may do and over which
scope. This module is the only place that reads it, and the authoriser and the
services are the enforcement point: screens hide what a role cannot do, but
this is what refuses it (guard rule D-10).

Scopes:
    own      the actor's own records only
    clinic   every record in the actor's clinic
    tenant   every record in the actor's tenant
    none     refused
"""

from __future__ import annotations

from dataclasses import dataclass

from atria_spec import roles as spec

from atria.core.errors import Forbidden
from atria.core.principal import Principal

Permission = str
Scope = str

SCOPE_RANK = {"none": 0, "own": 1, "clinic": 2, "tenant": 3}

PERMISSIONS: frozenset[str] = frozenset(spec.MATRIX)
GUARD_RULES: dict[str, str] = dict(spec.GUARD_RULES)


@dataclass(frozen=True, slots=True)
class Subject:
    """The record an action is aimed at, reduced to what the matrix needs."""

    tenant_id: str
    patient_profile_id: str | None = None
    clinician_profile_id: str | None = None
    clinic_id: str | None = None


def scope_for(role: str, permission: Permission) -> Scope:
    if permission not in PERMISSIONS:
        raise ValueError(f"unknown permission: {permission}")
    return spec.scope_for(role, permission)


def widest_scope(principal: Principal, permission: Permission) -> Scope:
    """The widest scope any of the principal's roles grants for this permission."""
    scopes = [scope_for(role, permission) for role in principal.roles]
    return max(scopes, key=lambda s: SCOPE_RANK[s], default="none")


def permissions_for(role: str) -> dict[Permission, Scope]:
    """Everything a role may do, for the token claims and the client's own hiding."""
    return spec.permissions_for(role)


def granted_to(principal: Principal) -> dict[Permission, Scope]:
    """Every permission the principal's roles grant, widest scope winning."""
    granted: dict[Permission, Scope] = {}
    for role in principal.roles:
        for permission, scope in permissions_for(role).items():
            held = granted.get(permission)
            if held is None or SCOPE_RANK[scope] > SCOPE_RANK[held]:
                granted[permission] = scope
    return granted


def landing_for(role: str) -> str:
    """The screen a role lands on after signing in."""
    return spec.LANDING[role]


def allows(principal: Principal, permission: Permission, subject: Subject | None = None) -> bool:
    """True when the matrix grants the permission over this subject."""
    if subject is not None and subject.tenant_id != principal.tenant_id:
        return False

    scope = widest_scope(principal, permission)
    if scope == "none":
        return False
    if subject is None:
        # A collection request. The scope bounds the query rather than one record.
        return True
    if scope == "tenant":
        return True
    if scope == "clinic":
        return principal.clinic_id is not None and subject.clinic_id == principal.clinic_id
    return _is_own(principal, subject)


def require(principal: Principal, permission: Permission, subject: Subject | None = None) -> Scope:
    """Return the granted scope, or raise Forbidden.

    The scope is returned because the caller needs it: a receptionist reading
    appointments gets the clinic's, a patient gets their own, and the query is
    built from that.
    """
    if not allows(principal, permission, subject):
        raise Forbidden(
            "that action is not permitted for this account",
            detail={"permission": permission},
        )
    return widest_scope(principal, permission)


def _is_own(principal: Principal, subject: Subject) -> bool:
    """Own means the actor is the subject, as patient or as the assigned clinician."""
    if (
        principal.patient_profile_id is not None
        and subject.patient_profile_id == principal.patient_profile_id
    ):
        return True
    return principal.staff_id is not None and subject.clinician_profile_id == principal.staff_id


def actor_is_subject(principal: Principal, subject: Subject) -> bool:
    """Guard rule SELF_SUBJECT_DROPS_STAFF_SCOPE: staff acting on their own appointment.

    Such a request is handled with patient scope only, whatever staff roles the
    account holds, so staff tooling cannot be used on one's own record.
    """
    return (
        principal.patient_profile_id is not None
        and subject.patient_profile_id == principal.patient_profile_id
    )


def effective_principal(principal: Principal, subject: Subject) -> Principal:
    """Drop staff scope when the actor is the subject."""
    if principal.is_staff and actor_is_subject(principal, subject):
        return principal.as_patient()
    return principal
