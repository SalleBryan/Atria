"""Who is making the request.

A person holds at most one patient profile and, separately, staff memberships.
Roles are fixed on the account at creation and there is no role switching in a
session (ADR 0015), so a principal carries the roles of the one account it
signed in to.

When the actor is also the subject of the record, staff scope is dropped and the
actor is treated as a patient (ADR 0010, guard rule
SELF_SUBJECT_DROPS_STAFF_SCOPE).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from atria_spec import roles as spec

Role = str


@dataclass(frozen=True, slots=True)
class Principal:
    """The signed-in actor, resolved from the token by the authoriser."""

    person_id: str
    tenant_id: str
    roles: tuple[Role, ...]
    """Roles carried by the account that signed in. Fixed at account creation."""

    patient_profile_id: str | None = None
    staff_id: str | None = None
    clinic_id: str | None = None
    """The clinic a staff membership belongs to. Bounds every clinic scoped permission."""

    phone_verified: bool = False
    languages: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        unknown = [r for r in self.roles if r not in spec.ROLES]
        if unknown:
            raise ValueError(f"unknown roles: {unknown}")

    @property
    def is_staff(self) -> bool:
        return any(r != "PATIENT" for r in self.roles)

    def has_role(self, role: Role) -> bool:
        return role in self.roles

    def as_patient(self) -> Principal:
        """The same person with staff scope dropped, for acting on their own record."""
        if self.patient_profile_id is None:
            raise ValueError("this person holds no patient profile")
        return Principal(
            person_id=self.person_id,
            tenant_id=self.tenant_id,
            roles=("PATIENT",),
            patient_profile_id=self.patient_profile_id,
            phone_verified=self.phone_verified,
            languages=self.languages,
        )
