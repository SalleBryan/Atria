"""GET /clinics and GET /appointment-types.

What a patient needs to book on their own: where the clinics are, and which
appointment types they may book and for how long (FR-DIR-01, FR-BKG-01).
Both are listed through DirectoryIndex (atria.data.catalogue).
"""

from __future__ import annotations

import json

import pytest

from atria.data import keys
from atria.data.booking import Booking
from atria.data.catalogue import Catalogue, appointment_type_listing, clinic_listing
from atria.services.directory import clinicians as service

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
OTHER = "t-other"


def put_clinic(repository, tenant: str, clinic_id: str, name: str) -> None:
    repository.put(
        keys.clinic(tenant, clinic_id),
        {
            "type": "CLINIC",
            "clinicId": clinic_id,
            "tenantId": tenant,
            "name": name,
            "address": "Douala, Littoral",
            "openingHours": {"0": {"start": "08:00", "end": "17:00"}},
            "internalNote": "not for patients",
            **clinic_listing(tenant, clinic_id, name),
        },
    )


def put_type(
    repository, tenant: str, type_id: str, name: str, *, bookable_by="BOTH", active=True
) -> None:
    repository.put(
        keys.appointment_type(tenant, type_id),
        {
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": type_id,
            "tenantId": tenant,
            "name": name,
            "serviceLine": "SPECIALIST",
            "durationUnits": 3,
            "bufferUnits": 1,
            "bookableBy": bookable_by,
            "active": active,
            "feeBandId": "fb-internal",
            **appointment_type_listing(tenant, type_id, name, active=active),
        },
    )


@pytest.fixture
def wired(monkeypatch, repository):
    monkeypatch.setattr(service, "_catalogue", Catalogue(repository))
    monkeypatch.setattr(service, "_booking", Booking(repository))
    repository.put(
        keys.tenant(TENANT), {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10}
    )
    put_clinic(repository, TENANT, "c-yaounde", "Centre medical de Bastos")
    put_clinic(repository, TENANT, "c-douala", "Clinique d'Akwa")
    put_clinic(repository, OTHER, "c-elsewhere", "Another tenant's clinic")
    put_type(repository, TENANT, "at-spec", "Premiere consultation specialisee")
    put_type(repository, TENANT, "at-proc", "Petite intervention", bookable_by="STAFF")
    put_type(repository, TENANT, "at-retired", "Ancienne consultation", active=False)
    put_type(repository, OTHER, "at-elsewhere", "Another tenant's type")
    return repository


def call(resource: str, **context: str) -> dict:
    authoriser = {
        "personId": "p-1",
        "tenantId": TENANT,
        "roles": "PATIENT",
        "patientProfileId": "pp-1",
    }
    authoriser.update(context)
    result = service.handler(
        {"httpMethod": "GET", "resource": resource, "requestContext": {"authorizer": authoriser}},
        None,
    )
    assert result["statusCode"] == 200, result["body"]
    return json.loads(str(result["body"]))


class TestClinics:
    def test_a_patient_lists_their_tenants_clinics_by_name(self, wired):
        body = call("/clinics")
        assert [c["name"] for c in body["clinics"]] == [
            "Centre medical de Bastos",
            "Clinique d'Akwa",
        ]

    def test_a_clinic_carries_only_what_a_patient_needs(self, wired):
        clinic = call("/clinics")["clinics"][0]
        assert set(clinic) == set(service.CLINIC_FIELDS)
        assert "internalNote" not in clinic

    def test_another_tenants_clinics_are_never_listed(self, wired):
        names = [c["name"] for c in call("/clinics")["clinics"]]
        assert "Another tenant's clinic" not in names


class TestAppointmentTypes:
    def test_a_patient_sees_what_a_patient_may_book(self, wired):
        body = call("/appointment-types")
        assert [t["appointmentTypeId"] for t in body["appointmentTypes"]] == ["at-spec"]

    def test_staff_also_see_what_only_staff_may_book(self, wired):
        body = call("/appointment-types", roles="RECEPTIONIST", staffId="s-1", clinicId="c-douala")
        assert sorted(t["appointmentTypeId"] for t in body["appointmentTypes"]) == [
            "at-proc",
            "at-spec",
        ]

    def test_a_retired_type_is_not_offered(self, wired):
        body = call("/appointment-types", roles="RECEPTIONIST", staffId="s-1", clinicId="c-douala")
        assert "at-retired" not in [t["appointmentTypeId"] for t in body["appointmentTypes"]]

    def test_lengths_come_with_the_grid_they_are_counted_in(self, wired):
        body = call("/appointment-types")
        assert body["gridUnitMinutes"] == 10
        assert body["appointmentTypes"][0]["durationUnits"] == 3

    def test_no_fee_band_or_internal_field_leaks(self, wired):
        listed = call("/appointment-types")["appointmentTypes"][0]
        assert set(listed) == set(service.TYPE_FIELDS)
        assert "feeBandId" not in listed
