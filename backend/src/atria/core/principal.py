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

# The roles that act only after a second factor (FR-ACC-11).
SECOND_FACTOR_ROLES = frozenset({"TENANT_ADMIN"})


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

    second_factor: bool = True
    """Whether the sign-in behind this session passed a second factor.

    Only a tenant administrator needs one (FR-ACC-11), and the authoriser says
    so explicitly for them. For every other role it is irrelevant, so the
    default keeps a principal built without it acting on its roles."""

    def __post_init__(self) -> None:
        unknown = [r for r in self.roles if r not in spec.ROLES]
        if unknown:
            raise ValueError(f"unknown roles: {unknown}")

    @property
    def is_staff(self) -> bool:
        return any(r != "PATIENT" for r in self.roles)

    def has_role(self, role: Role) -> bool:
        return role in self.acting_roles

    @property
    def acting_roles(self) -> tuple[Role, ...]:
        """The roles this session may act on.

        An administrator who has not signed in with their authenticator holds
        the role but none of its powers until they do (FR-ACC-11). Any other
        role on the same account still acts."""
        if self.second_factor:
            return self.roles
        return tuple(r for r in self.roles if r not in SECOND_FACTOR_ROLES)

    @property
    def needs_second_factor(self) -> bool:
        return not self.second_factor and any(r in SECOND_FACTOR_ROLES for r in self.roles)

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
