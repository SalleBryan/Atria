# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""The fee ledger and the weekly report.

Verifies FR-MSR-05 (every visit writes a ledger entry at closure with its
band, amount, outcome and entitlement), FR-MSR-06 (the outcome to
entitlement map, and the cancel screen's preview of the band), FR-MSR-07
(nothing settles), FR-MSR-01 (a unit's week of booked, attended, no-show,
cancelled and late-cancelled) and FR-MSR-02 (attendance by channel and by
reminder outcome).

The wiring is the cancellation tests'. The visit is at 09:00 in Douala on
Wednesday 2026-03-04, with a free cancellation window of a day.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from test_appointment_cancel import (
    CLOCK,
    DOUALA,
    NOW,
    START,
    TENANT,
    TYPE_ID,
    body_of,
    book,
    cancel,
    patient_context,
    staff_context,
    wired,
)

from atria.data import keys
from atria.data.catalogue import clinic_listing
from atria.data.settings import Settings
from atria.services.booking import appointments as service
from atria.services.directory import clinicians as directory

pytestmark = pytest.mark.usefixtures("table")

MANAGER = staff_context(personId="p-mgr", roles="CLINIC_MANAGER", staffId="s-mgr")
ADMIN = {"personId": "p-admin", "tenantId": TENANT, "roles": "TENANT_ADMIN", "staffId": "s-admin"}


@pytest.fixture
def banded(wired, repository):
    store = Settings(repository, clock=lambda: dt.datetime(2026, 2, 1, tzinfo=dt.UTC))
    store.set_fee_band(
        TENANT,
        "fb-first",
        {"practice": "Specialist, first visit", "baseAmountMinor": 5000, "scheduleReference": ""},
    )
    type_key = keys.appointment_type(TENANT, TYPE_ID)
    repository.put(
        type_key, {**repository.get(type_key), "feeBandId": "fb-first", "serviceLine": "SPECIALIST"}
    )
    return wired


def act(appointment_id, action, context):
    return service.handler(
        {
            "httpMethod": "POST",
            "resource": f"/appointments/{{id}}/{action}",
            "pathParameters": {"id": appointment_id},
            "requestContext": {"authorizer": context},
        },
        None,
    )


def read(appointment_id, context=None):
    return body_of(
        service.handler(
            {
                "httpMethod": "GET",
                "resource": "/appointments/{id}",
                "pathParameters": {"id": appointment_id},
                "requestContext": {"authorizer": context or patient_context()},
            },
            None,
        )
    )


def ledger(repository, appointment_id):
    return repository.get(keys.fee_ledger_entry(TENANT, appointment_id))


def doctor(clinician):
    return {
        "personId": "p-doc",
        "tenantId": TENANT,
        "roles": "CLINICIAN",
        "staffId": clinician,
        "clinicId": DOUALA,
    }


class TestLedger:
    def test_fr_msr_05_an_attended_visit_records_its_band_and_amount(self, banded, repository):
        _repo, clinician = banded
        booked = book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 8, 30, tzinfo=dt.UTC)
        act(booked["appointmentId"], "arrive", staff_context())
        act(booked["appointmentId"], "start", doctor(clinician))
        act(booked["appointmentId"], "complete", doctor(clinician))
        entry = ledger(repository, booked["appointmentId"])
        assert (
            entry["outcome"],
            entry["entitlement"],
            entry["amountMinor"],
            entry["currency"],
        ) == ("ATTENDED", "NONE", 5000, "XAF")
        assert entry["practice"] == "Specialist, first visit"
        assert entry["settledAt"] is None

    @pytest.mark.parametrize(
        ("when", "by", "outcome", "entitlement"),
        [
            (NOW, "PATIENT", "CANCELLED_IN_WINDOW", "FULL"),
            (dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC), "PATIENT", "CANCELLED_LATE", "PARTIAL"),
            (dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC), "CLINIC", "CLINIC_CANCELLED", "FULL"),
        ],
    )
    def test_fr_msr_06_each_cancellation_records_its_entitlement(
        self, banded, repository, when, by, outcome, entitlement
    ):
        _repo, clinician = banded
        booked = book(clinician)
        CLOCK["now"] = when
        cancel(
            booked["appointmentId"],
            context=staff_context(),
            body={"cancelledBy": by, "reason": "phoned"},
        )
        entry = ledger(repository, booked["appointmentId"])
        assert (entry["outcome"], entry["entitlement"]) == (outcome, entitlement)

    def test_a_no_show_records_none(self, banded, repository):
        _repo, clinician = banded
        booked = book(clinician)
        CLOCK["now"] = dt.datetime(2026, 3, 4, 10, 0, tzinfo=dt.UTC)
        act(booked["appointmentId"], "no-show", staff_context())
        assert ledger(repository, booked["appointmentId"])["entitlement"] == "NONE"

    def test_the_amount_is_the_one_in_force_on_the_day_of_the_visit(self, banded, repository):
        _repo, clinician = banded
        booked = book(clinician)
        # A new amount from after the visit does not reach it.
        later = Settings(repository, clock=lambda: dt.datetime(2026, 3, 10, tzinfo=dt.UTC))
        later.set_fee_band(
            TENANT,
            "fb-first",
            {
                "practice": "Specialist, first visit",
                "baseAmountMinor": 6000,
                "scheduleReference": "",
            },
        )
        cancel(
            booked["appointmentId"],
            context=staff_context(),
            body={"cancelledBy": "CLINIC", "reason": "ill"},
        )
        assert ledger(repository, booked["appointmentId"])["amountMinor"] == 5000


class TestCancelPreview:
    def test_fr_msr_06_the_band_is_known_before_the_confirm(self, banded):
        _repo, clinician = banded
        booked = book(clinician)
        early = read(booked["appointmentId"])["cancellationPreview"]
        assert (early["entitlement"], early["amountMinor"], early["freeUntil"]) == (
            "FULL",
            5000,
            "2026-03-03T08:00:00Z",
        )
        CLOCK["now"] = dt.datetime(2026, 3, 4, 7, 0, tzinfo=dt.UTC)
        assert read(booked["appointmentId"])["cancellationPreview"]["entitlement"] == "PARTIAL"

    def test_the_patient_reads_their_own_entry_after_closure(self, banded):
        _repo, clinician = banded
        booked = book(clinician)
        cancel(booked["appointmentId"])
        found = read(booked["appointmentId"])
        assert found["ledger"]["entitlement"] == "FULL"
        assert found["cancellationPreview"] is None if "cancellationPreview" in found else True


def report(context, resource="/clinics/{id}/report", query=None):
    return directory.handler(
        {
            "httpMethod": "GET",
            "resource": resource,
            "pathParameters": {"id": DOUALA} if "{id}" in resource else None,
            "queryStringParameters": query or {"week": "2026-03-02"},
            "requestContext": {"authorizer": context},
        },
        None,
    )


class TestWeeklyReport:
    @pytest.fixture
    def week(self, banded, repository, monkeypatch):
        """Four visits: one attended by phone, one no-show online, one cancelled late, one open."""
        _repo, clinician = banded
        monkeypatch.setattr(directory, "_booking", service.booking())
        clinic_key = keys.clinic(TENANT, DOUALA)
        repository.put(
            clinic_key,
            {**repository.get(clinic_key), **clinic_listing(TENANT, DOUALA, "Medical Unit")},
        )
        made = [
            book(clinician, start=start)
            for start in (
                "2026-03-04T08:00:00Z",
                "2026-03-04T09:00:00Z",
                "2026-03-05T08:00:00Z",
                "2026-03-06T08:00:00Z",
            )
        ]
        # Arranged when booked, weeks before: the row is filed under that day,
        # and the appointment points at it (FR-REM-01).
        for n, state in ((0, "SENT"), (1, "FAILED")):
            logged = f"2026-02-0{n + 1}T08:00:00Z"
            repository.put(
                keys.message_log(TENANT, logged[:10], logged, f"ml-{n}"),
                {
                    "type": "MESSAGE_LOG",
                    "tenantId": TENANT,
                    "appointmentId": made[n]["appointmentId"],
                    "kind": "APPOINTMENT_REMINDER",
                    "deliveryState": state,
                },
            )
            key = keys.appointment(TENANT, made[n]["appointmentId"])
            repository.put(
                key, {**repository.get(key), "reminderLogId": f"ml-{n}", "reminderLoggedAt": logged}
            )
        CLOCK["now"] = dt.datetime(2026, 3, 5, 7, 0, tzinfo=dt.UTC)
        act(made[0]["appointmentId"], "arrive", staff_context())
        act(made[0]["appointmentId"], "start", doctor(clinician))
        act(made[0]["appointmentId"], "complete", doctor(clinician))
        act(made[1]["appointmentId"], "no-show", staff_context())
        cancel(made[2]["appointmentId"])
        return made

    def test_fr_msr_01_a_units_week(self, week):
        found = body_of(report(MANAGER))
        assert (
            found["booked"],
            found["attended"],
            found["noShow"],
            found["lateCancelled"],
            found["cancelled"],
            found["open"],
        ) == (
            4,
            1,
            1,
            1,
            0,
            1,
        )
        assert found["attendance"] == 0.5

    def test_fr_msr_02_attendance_by_reminder_outcome(self, week):
        by = {row["reminder"]: row for row in body_of(report(MANAGER))["byReminder"]}
        assert (by["SENT"]["attended"], by["FAILED"]["noShow"], by["NOT_SENT"]["booked"]) == (
            1,
            1,
            2,
        )

    def test_fr_msr_02_attendance_by_channel(self, week):
        by = {row["channel"]: row for row in body_of(report(MANAGER))["byChannel"]}
        assert by["ONLINE"]["booked"] == 4

    def test_the_ledger_is_totalled_as_a_record(self, week):
        totals = {
            row["entitlement"]: row for row in body_of(report(MANAGER))["ledger"]["byEntitlement"]
        }
        assert (totals["NONE"]["entries"], totals["PARTIAL"]["entries"]) == (2, 1)
        assert totals["NONE"]["amountMinor"] == 10000

    def test_fr_msr_04_no_currency_saving_is_claimed(self, week):
        body = json.dumps(body_of(report(MANAGER))).lower()
        assert "saving" not in body
        assert "saved" not in body

    def test_the_desk_does_not_read_it(self, week):
        assert report(staff_context())["statusCode"] == 403

    def test_the_administrator_reads_every_unit(self, week):
        found = body_of(report(ADMIN, resource="/reports"))
        assert found["booked"] == 4
        assert [u["clinicId"] for u in found["units"]][:1] == [DOUALA]


class TestCapacity:
    """GET /capacity: the administrator's week of cover (Admin · Overview)."""

    @pytest.fixture
    def listed(self, banded, repository, monkeypatch):
        _repo, clinician = banded
        monkeypatch.setattr(directory, "_booking", service.booking())
        clinic_key = keys.clinic(TENANT, DOUALA)
        repository.put(
            clinic_key,
            {
                **repository.get(clinic_key),
                **clinic_listing(TENANT, DOUALA, "Medical Unit"),
                "name": "Medical Unit",
            },
        )
        book(clinician, start="2026-03-04T08:00:00Z")
        return clinician

    def test_the_administrator_sees_the_week(self, listed):
        found = body_of(report(ADMIN, resource="/capacity", query={"from": "2026-03-02"}))
        assert (found["from"], found["to"]) == ("2026-03-02", "2026-03-08")
        assert found["cliniciansOnShift"] >= 1
        named = [row["clinicName"] for row in found["covered"] + found["uncovered"]]
        assert "Medical Unit" in named

    def test_a_manager_does_not(self, listed):
        assert (
            report(MANAGER, resource="/capacity", query={"from": "2026-03-02"})["statusCode"] == 403
        )
