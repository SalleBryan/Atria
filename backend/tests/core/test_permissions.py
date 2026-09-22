"""The permission matrix refuses what the specification says it refuses.

Verifies FR-ACC-11 and FR-ACC-12 (roles fixed at creation, no switching),
FR-STF-07 (front desk never sees care context), FR-ADM-09 (a tenant
administrator never reads care context) and the guard rules in spec/roles.py.
"""

from __future__ import annotations

import pytest

from atria.core import permissions
from atria.core.errors import Forbidden
from atria.core.permissions import Subject
from atria.core.principal import Principal

TENANT = "t-cm-001"
CLINIC = "c-douala-01"
OTHER_CLINIC = "c-yaounde-02"


def patient(profile: str = "pp-1") -> Principal:
    return Principal(
        person_id="p-1", tenant_id=TENANT, roles=("PATIENT",), patient_profile_id=profile
    )


def staff(role: str, staff_id: str = "s-1", clinic: str = CLINIC) -> Principal:
    return Principal(
        person_id=f"p-{staff_id}",
        tenant_id=TENANT,
        roles=(role,),
        staff_id=staff_id,
        clinic_id=clinic,
    )


class TestScopes:
    def test_a_patient_reads_only_their_own_appointment(self):
        me = patient("pp-1")
        mine = Subject(tenant_id=TENANT, patient_profile_id="pp-1", clinic_id=CLINIC)
        theirs = Subject(tenant_id=TENANT, patient_profile_id="pp-2", clinic_id=CLINIC)
        assert permissions.allows(me, "appointment.read", mine)
        assert not permissions.allows(me, "appointment.read", theirs)

    def test_a_receptionist_reads_the_whole_clinic_but_not_another(self):
        desk = staff("RECEPTIONIST")
        here = Subject(tenant_id=TENANT, patient_profile_id="pp-9", clinic_id=CLINIC)
        elsewhere = Subject(tenant_id=TENANT, patient_profile_id="pp-9", clinic_id=OTHER_CLINIC)
        assert permissions.allows(desk, "appointment.read", here)
        assert not permissions.allows(desk, "appointment.read", elsewhere)

    def test_a_clinician_reads_their_own_patients(self):
        doctor = staff("CLINICIAN", staff_id="s-doc")
        mine = Subject(tenant_id=TENANT, clinician_profile_id="s-doc", clinic_id=CLINIC)
        colleagues = Subject(tenant_id=TENANT, clinician_profile_id="s-other", clinic_id=CLINIC)
        assert permissions.allows(doctor, "appointment.read", mine)
        assert not permissions.allows(doctor, "appointment.read", colleagues)

    def test_nothing_crosses_a_tenant_boundary(self):
        admin = staff("TENANT_ADMIN")
        other_tenant = Subject(tenant_id="t-other", patient_profile_id="pp-1")
        assert not permissions.allows(admin, "appointment.read", other_tenant)


class TestCareContext:
    def test_the_front_desk_never_sees_care_context(self):
        # FR-STF-07 and ADR 0006.
        subject = Subject(tenant_id=TENANT, patient_profile_id="pp-1", clinic_id=CLINIC)
        assert not permissions.allows(staff("RECEPTIONIST"), "care_context.read", subject)

    def test_a_tenant_administrator_never_sees_care_context(self):
        # Guard rule TENANT_ADMIN_NEVER_READS_CARE_CONTEXT. There is no override.
        subject = Subject(tenant_id=TENANT, patient_profile_id="pp-1", clinic_id=CLINIC)
        assert not permissions.allows(staff("TENANT_ADMIN"), "care_context.read", subject)
        assert permissions.scope_for("TENANT_ADMIN", "care_context.read") == "none"

    def test_a_clinic_manager_never_sees_care_context(self):
        subject = Subject(tenant_id=TENANT, patient_profile_id="pp-1", clinic_id=CLINIC)
        assert not permissions.allows(staff("CLINIC_MANAGER"), "care_context.read", subject)

    def test_the_assigned_clinician_does(self):
        doctor = staff("CLINICIAN", staff_id="s-doc")
        subject = Subject(tenant_id=TENANT, clinician_profile_id="s-doc", clinic_id=CLINIC)
        assert permissions.allows(doctor, "care_context.read", subject)


class TestSelfSubjectDropsStaffScope:
    """Guard rule SELF_SUBJECT_DROPS_STAFF_SCOPE, and ADR 0010."""

    def test_staff_acting_on_their_own_appointment_are_treated_as_a_patient(self):
        receptionist_who_is_also_a_patient = Principal(
            person_id="p-7",
            tenant_id=TENANT,
            roles=("RECEPTIONIST",),
            staff_id="s-7",
            clinic_id=CLINIC,
            patient_profile_id="pp-7",
        )
        own = Subject(tenant_id=TENANT, patient_profile_id="pp-7", clinic_id=CLINIC)
        effective = permissions.effective_principal(receptionist_who_is_also_a_patient, own)
        assert effective.roles == ("PATIENT",)
        assert effective.clinic_id is None

    def test_someone_elses_record_keeps_the_staff_scope(self):
        desk = Principal(
            person_id="p-7",
            tenant_id=TENANT,
            roles=("RECEPTIONIST",),
            staff_id="s-7",
            clinic_id=CLINIC,
            patient_profile_id="pp-7",
        )
        other = Subject(tenant_id=TENANT, patient_profile_id="pp-8", clinic_id=CLINIC)
        assert permissions.effective_principal(desk, other).roles == ("RECEPTIONIST",)


class TestRequire:
    def test_require_returns_the_granted_scope(self):
        assert permissions.require(staff("RECEPTIONIST"), "appointment.read") == "clinic"
        assert permissions.require(patient(), "appointment.read") == "own"

    def test_require_raises_forbidden_with_no_record_detail(self):
        subject = Subject(tenant_id=TENANT, patient_profile_id="pp-2", clinic_id=CLINIC)
        with pytest.raises(Forbidden) as raised:
            permissions.require(patient("pp-1"), "appointment.read", subject)
        assert raised.value.status == 403
        assert raised.value.detail == {"permission": "appointment.read"}

    def test_an_unknown_permission_is_a_programming_error(self):
        with pytest.raises(ValueError, match="unknown permission"):
            permissions.scope_for("PATIENT", "appointment.teleport")


class TestRoles:
    def test_an_unknown_role_cannot_be_constructed(self):
        with pytest.raises(ValueError, match="unknown roles"):
            Principal(person_id="p-1", tenant_id=TENANT, roles=("SUPERUSER",))

    def test_a_patient_principal_is_not_staff(self):
        assert not patient().is_staff
        assert staff("CLINICIAN").is_staff
