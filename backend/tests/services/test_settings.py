# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""Tenant and unit settings, appointment types and fee bands.

Verifies FR-ADM-03 (unit profile and hours, reminder lead, languages, senders),
FR-ADM-06 (appointment types and fee bands without a release), FR-TEN-02 (a
grid unit, and every type its own duration), FR-TEN-04 (no-show strikes, off
by default, never a lock-out), FR-TEN-05 (the quality switch, and the fee link
refused where the pack forbids it), FR-TEN-06 and FR-TEN-07 (the region pack
locks at the first appointment, and says why).

The wiring, the clinician and the booking helper are the cancellation tests'.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from test_appointment_cancel import (
    CLOCK,
    DOUALA,
    NOW,
    PATIENT,
    START,
    TENANT,
    TYPE_ID,
    body_of,
    book,
    patient_context,
    wired,
)

from atria.data import keys
from atria.data.catalogue import Catalogue, appointment_type_listing, clinic_listing
from atria.data.settings import Settings
from atria.services.admin import settings as service
from atria.services.booking import appointments as booking_service
from atria.services.directory import clinicians as directory

pytestmark = pytest.mark.usefixtures("table")

ADMIN = {"personId": "p-admin", "tenantId": TENANT, "roles": "TENANT_ADMIN", "staffId": "s-admin"}
MANAGER = {
    "personId": "p-mgr",
    "tenantId": TENANT,
    "roles": "CLINIC_MANAGER",
    "staffId": "s-mgr",
    "clinicId": DOUALA,
}


@pytest.fixture
def configured(wired, repository, monkeypatch):
    store = Settings(repository, clock=lambda: CLOCK["now"])
    monkeypatch.setattr(service, "_settings", store)
    monkeypatch.setattr(directory, "_catalogue", Catalogue(repository))
    repository.put(
        keys.region_pack("CM"),
        {
            "type": "REGION_PACK",
            "code": "CM",
            "timezone": "Africa/Douala",
            "currency": "XAF",
            "languages": ["fr", "en"],
            "allowsRatingFeeLink": False,
        },
    )
    for band, amount in (("fb-specialist-first", 5000), ("fb-general", 1500)):
        store.set_fee_band(
            TENANT, band, {"practice": band, "baseAmountMinor": amount, "scheduleReference": ""}
        )
    # The cancellation tests' type, as a created one would be: banded and listed.
    type_key = keys.appointment_type(TENANT, TYPE_ID)
    repository.put(
        type_key,
        {
            **repository.get(type_key),
            "name": "First specialist consultation",
            "serviceLine": "SPECIALIST",
            "feeBandId": "fb-specialist-first",
            **appointment_type_listing(TENANT, TYPE_ID, "First specialist consultation"),
        },
    )
    return wired


def call(method: str, resource: str, *, context=ADMIN, body=None, path=None):
    return service.handler(
        {
            "httpMethod": method,
            "resource": resource,
            "pathParameters": path,
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": context},
        },
        None,
    )


def patch_tenant(body, context=ADMIN):
    return call("PATCH", "/admin/settings", context=context, body=body)


class TestOverview:
    def test_an_administrator_reads_everything_in_one_call(self, configured):
        found = body_of(call("GET", "/admin/settings"))
        assert found["tenant"]["gridUnitMinutes"] == 10
        assert found["tenant"]["regionPackLocked"] is False
        assert found["regionPack"]["currency"] == "XAF"
        assert [b["feeBandId"] for b in found["feeBands"]] == ["fb-general", "fb-specialist-first"]

    def test_fr_adm_09_nobody_else_reads_it(self, configured):
        assert call("GET", "/admin/settings", context=MANAGER)["statusCode"] == 403


class TestTenantSettings:
    def test_fr_adm_03_reminder_lead_and_languages(self, configured):
        changed = body_of(patch_tenant({"reminderLeadHours": 48, "languages": ["en"]}))
        assert (changed["reminderLeadHours"], changed["languages"]) == (48, ["en"])

    def test_a_language_the_pack_lacks_is_refused(self, configured):
        assert patch_tenant({"languages": ["de"]})["statusCode"] == 400

    def test_a_second_reminder_comes_after_the_first(self, configured):
        assert patch_tenant({"secondReminderHours": 30})["statusCode"] == 400
        assert body_of(patch_tenant({"secondReminderHours": 2}))["secondReminderHours"] == 2

    def test_fr_ten_05_the_fee_link_is_refused_where_the_pack_forbids_it(self, configured):
        refused = patch_tenant({"ratingAffectsFee": True})
        assert refused["statusCode"] == 400
        assert "region pack" in body_of(refused)["message"]
        assert body_of(patch_tenant({"qualityProgrammeEnabled": True}))["qualityProgrammeEnabled"]

    def test_an_sms_sender_id_fits_what_networks_carry(self, configured):
        assert patch_tenant({"smsSenderId": "REGIONAL-HOSPITAL"})["statusCode"] == 400
        assert body_of(patch_tenant({"smsSenderId": "RHBUEA"}))["smsSenderId"] == "RHBUEA"

    def test_r4_the_invitation_defaults_are_set_and_checked(self, configured):
        changed = body_of(
            patch_tenant(
                {
                    "queueInviteLeadMinutes": 10,
                    "queueInviteFanout": 4,
                    "queueInviteOpenMinutes": 30,
                    "queueEarlyCallInvites": "auto",
                }
            )
        )
        assert changed["queueInviteLeadMinutes"] == 10
        assert changed["queueInviteFanout"] == 4
        assert changed["queueInviteOpenMinutes"] == 30
        assert changed["queueEarlyCallInvites"] == "auto"
        for bad in (
            {"queueInviteFanout": 11},
            {"queueInviteOpenMinutes": 4},
            {"queueInviteLeadMinutes": 31},
            {"queueEarlyCallInvites": "always"},
        ):
            assert patch_tenant(bad)["statusCode"] == 400

    def test_an_unknown_setting_is_refused(self, configured):
        assert patch_tenant({"colour": "blue"})["statusCode"] == 400

    def test_fr_ten_02_the_grid_unit_is_one_of_the_allowed(self, configured):
        assert patch_tenant({"gridUnitMinutes": 7})["statusCode"] == 400
        assert body_of(patch_tenant({"gridUnitMinutes": 15}))["gridUnitMinutes"] == 15


class TestRegionPackLock:
    def test_fr_ten_07_the_first_appointment_locks_pack_and_grid(self, configured):
        _repo, clinician = configured
        book(clinician)
        tenant = body_of(call("GET", "/admin/settings"))["tenant"]
        assert tenant["regionPackLocked"] is True
        assert "first appointment" in tenant["lockReason"]
        refused = patch_tenant({"gridUnitMinutes": 15})
        assert refused["statusCode"] == 400
        assert body_of(refused)["detail"]["locked"] is True
        assert patch_tenant({"regionPackCode": "XX"})["statusCode"] == 400

    def test_the_first_date_is_kept_by_later_bookings(self, configured, repository):
        _repo, clinician = configured
        book(clinician)
        first = repository.get(keys.tenant(TENANT))["firstAppointmentAt"]
        book(clinician, start="2026-03-05T08:00:00Z")
        assert repository.get(keys.tenant(TENANT))["firstAppointmentAt"] == first


class TestUnits:
    def test_fr_adm_03_a_unit_profile_and_hours(self, configured):
        changed = body_of(
            call(
                "PATCH",
                "/admin/clinics/{id}",
                path={"id": DOUALA},
                body={
                    "name": "Medical Unit",
                    "description": "Adult internal medicine.",
                    "services": ["Internal medicine", "Cardiology"],
                    "openingHours": {"0": {"start": "07:30", "end": "15:30"}, "6": None},
                },
            )
        )
        assert changed["name"] == "Medical Unit"
        assert changed["openingHours"] == {"0": {"start": "07:30", "end": "15:30"}}

    def test_hours_off_the_grid_are_refused(self, configured):
        result = call(
            "PATCH",
            "/admin/clinics/{id}",
            path={"id": DOUALA},
            body={"openingHours": {"0": {"start": "07:35", "end": "15:30"}}},
        )
        assert result["statusCode"] == 400

    def test_the_directory_shows_the_change(self, configured):
        call("PATCH", "/admin/clinics/{id}", path={"id": DOUALA}, body={"name": "Medical Unit"})
        listed = directory.handler(
            {
                "httpMethod": "GET",
                "resource": "/clinics",
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert "Medical Unit" in listed["body"]

    def test_a_unit_knows_where_its_door_is(self, configured):
        location = {
            "building": "Block B",
            "floor": "Ground floor",
            "directions": "Left of the main entrance, past the pharmacy.",
            "lat": 4.1527,
            "lng": 9.2410,
        }
        changed = body_of(
            call(
                "PATCH",
                "/admin/clinics/{id}",
                path={"id": DOUALA},
                body={"name": "Medical Unit", "location": location},
            )
        )
        assert changed["location"] == {**location, "lat": "4.1527", "lng": "9.241"}
        listed = directory.handler(
            {
                "httpMethod": "GET",
                "resource": "/clinics",
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert "Block B" in listed["body"]

    @pytest.mark.parametrize(
        "location",
        [
            {"lat": 4.15},
            {"lat": 95, "lng": 9.2},
            {"lat": "north", "lng": 9.2},
            {"room": "4"},
            "Block B",
        ],
    )
    def test_a_location_that_cannot_be_used_is_refused(self, configured, location):
        result = call(
            "PATCH", "/admin/clinics/{id}", path={"id": DOUALA}, body={"location": location}
        )
        assert result["statusCode"] == 400


TYPE = {
    "name": "Antenatal visit",
    "serviceLine": "SPECIALIST",
    "durationUnits": 2,
    "bufferUnits": 1,
    "bookableBy": "BOTH",
    "feeBandId": "fb-specialist-first",
}


class TestAppointmentTypes:
    def test_fr_adm_06_a_type_is_created_and_offered(self, configured):
        created = call("POST", "/admin/appointment-types", body=TYPE)
        assert created["statusCode"] == 201
        found = body_of(created)
        assert (found["durationUnits"], found["code"]) == (2, "ANTENATAL_VISIT")

    def test_a_general_consultation_has_no_duration(self, configured):
        body = {**TYPE, "serviceLine": "GENERAL", "feeBandId": "fb-general"}
        assert call("POST", "/admin/appointment-types", body=body)["statusCode"] == 400
        del body["durationUnits"]
        assert body_of(call("POST", "/admin/appointment-types", body=body))["durationUnits"] is None

    def test_a_procedure_is_booked_by_staff(self, configured):
        body = {**TYPE, "serviceLine": "PROCEDURE"}
        assert call("POST", "/admin/appointment-types", body=body)["statusCode"] == 400

    def test_the_fee_band_must_exist(self, configured):
        body = {**TYPE, "feeBandId": "fb-nowhere"}
        assert call("POST", "/admin/appointment-types", body=body)["statusCode"] == 400

    def test_a_retired_type_leaves_booking_but_not_the_list(self, configured):
        call("PATCH", "/admin/appointment-types/{id}", path={"id": TYPE_ID}, body={"active": False})
        listed = directory.handler(
            {
                "httpMethod": "GET",
                "resource": "/appointment-types",
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert TYPE_ID not in listed["body"]
        mine = body_of(call("GET", "/admin/settings"))["appointmentTypes"]
        assert [t["active"] for t in mine if t["appointmentTypeId"] == TYPE_ID] == [False]

    def test_a_type_limited_to_one_unit_is_not_booked_elsewhere(self, configured, repository):
        _repo, clinician = configured
        repository.put(
            keys.clinic(TENANT, "c-eye"),
            {
                "type": "CLINIC",
                "clinicId": "c-eye",
                "tenantId": TENANT,
                "name": "Eye Unit",
                **clinic_listing(TENANT, "c-eye", "Eye Unit"),
            },
        )
        limited = call(
            "PATCH",
            "/admin/appointment-types/{id}",
            path={"id": TYPE_ID},
            body={"clinicIds": ["c-eye"]},
        )
        assert limited["statusCode"] == 200
        refused = booking_service.handler(
            {
                "httpMethod": "POST",
                "resource": "/appointments",
                "body": json.dumps(
                    {
                        "appointmentTypeId": TYPE_ID,
                        "clinicianProfileId": clinician,
                        "startAt": START,
                    }
                ),
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert refused["statusCode"] == 400
        assert "not offered" in body_of(refused)["message"]


class TestFeeBands:
    def test_a_new_amount_is_a_new_version_and_the_old_one_stays(self, configured, repository):
        store = service.settings()
        CLOCK["now"] = NOW + dt.timedelta(days=10)
        changed = body_of(
            call(
                "PUT",
                "/admin/fee-bands/{id}",
                path={"id": "fb-general"},
                body={"practice": "General consultation", "baseAmountMinor": 2000},
            )
        )
        assert changed["baseAmountMinor"] == 2000
        assert len(store.fee_band_history(TENANT, "fb-general")) == 2
        assert (
            store.fee_band_on(TENANT, "fb-general", NOW.date().isoformat())["baseAmountMinor"]
            == 1500
        )
        listed = [b for b in store.fee_bands(TENANT) if b["feeBandId"] == "fb-general"]
        assert [b["baseAmountMinor"] for b in listed] == [2000]

    def test_an_unknown_band_is_not_found(self, configured):
        result = call(
            "PUT",
            "/admin/fee-bands/{id}",
            path={"id": "fb-new"},
            body={"practice": "x", "baseAmountMinor": 1},
        )
        assert result["statusCode"] == 404


class TestNoShowStrikes:
    def put_no_shows(self, repository, count: int):
        for n in range(count):
            repository.put(
                keys.appointment(TENANT, f"a-missed-{n}"),
                {
                    "type": "APPOINTMENT",
                    "appointmentId": f"a-missed-{n}",
                    "tenantId": TENANT,
                    "patientProfileId": PATIENT,
                    "startAt": (NOW - dt.timedelta(days=10 + n)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "state": "NO_SHOW",
                },
            )

    def test_fr_ten_04_off_by_default(self, configured, repository):
        _repo, clinician = configured
        self.put_no_shows(repository, 5)
        assert book(clinician)["state"] == "BOOKED"

    def test_over_the_threshold_only_the_next_24_hours(self, configured, repository):
        _repo, clinician = configured
        patch_tenant({"noShowStrikeThreshold": 3})
        self.put_no_shows(repository, 3)
        refused = booking_service.handler(
            {
                "httpMethod": "POST",
                "resource": "/appointments",
                "body": json.dumps(
                    {
                        "appointmentTypeId": TYPE_ID,
                        "clinicianProfileId": clinician,
                        "startAt": START,
                    }
                ),
                "requestContext": {"authorizer": patient_context()},
            },
            None,
        )
        assert refused["statusCode"] == 400
        assert "24 hours" in body_of(refused)["message"]
        # Never a lock-out: tomorrow morning is still open to them.
        assert book(clinician, start="2026-03-02T08:00:00Z")["state"] == "BOOKED"
