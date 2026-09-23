"""A booking is reminded by SMS a day ahead, unless it was cancelled first.

Verifies FR-REM-01 (a one-time schedule, its reference stored on the
appointment), FR-REM-02 (at fire time a moved-on appointment is skipped and
the skip logged), FR-REM-03 (the current number, the guardian's for a minor,
as a transactional SMS), FR-REM-06 (inside the lead time the confirmation goes
by SMS at once), FR-VIS-04 (cancelling removes the schedule) and the CANCELLED
state of FR-MSG-03. Together these are acceptance test BR-08.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from botocore.exceptions import ClientError

from atria.core import notices, reminders
from atria.core import staff as staff_rules
from atria.data import keys
from atria.data.booking import Booking
from atria.data.messages import CANCELLED, FAILED, SCHEDULED, SENT, Messages
from atria.data.people import People
from atria.services.notify import outbox, sender

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
PATIENT = "pp-1"
PERSON = "p-patient-1"
GUARDIAN = "p-guardian-1"

NOW = dt.datetime(2026, 3, 1, 9, 0, tzinfo=dt.UTC)
# Three days out, so the reminder is due two days from now.
LATER = "2026-03-04T08:00:00Z"
# Eleven hours out, which is inside the 24 hour lead.
SOON = "2026-03-01T20:00:00Z"
QUEUED_MS = str(int(NOW.timestamp() * 1000))


def client_error(code: str, operation: str = "Operation") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": code}}, operation)


class FakeSns:
    def __init__(self, *, fail: Exception | None = None) -> None:
        self.published: list[dict] = []
        self.fail = fail

    def publish(self, **kwargs):
        if self.fail is not None:
            raise self.fail
        self.published.append(kwargs)
        return {"MessageId": f"sns-{len(self.published):04d}"}


class FakeScheduler:
    def __init__(self) -> None:
        self.schedules: dict[str, dict] = {}
        self.deleted: list[str] = []

    def create_schedule(self, **kwargs):
        if kwargs["Name"] in self.schedules:
            raise client_error("ConflictException", "CreateSchedule")
        self.schedules[kwargs["Name"]] = kwargs
        return {"ScheduleArn": f"arn:schedule/{kwargs['Name']}"}

    def delete_schedule(self, **kwargs):
        if kwargs["Name"] not in self.schedules:
            raise client_error("ResourceNotFoundException", "DeleteSchedule")
        del self.schedules[kwargs["Name"]]
        self.deleted.append(kwargs["Name"])


@pytest.fixture
def world(monkeypatch, repository):
    repository.put(
        keys.tenant(TENANT),
        {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10, "regionPackCode": "CM"},
    )
    repository.put(
        keys.region_pack("CM"), {"type": "REGION_PACK", "code": "CM", "timezone": "Africa/Douala"}
    )
    repository.put(
        keys.clinic(TENANT, DOUALA),
        {"type": "CLINIC", "clinicId": DOUALA, "tenantId": TENANT, "name": "Clinique de Douala"},
    )
    for person_id, phone in ((PERSON, "+237600000001"), (GUARDIAN, "+237600000099")):
        repository.put(
            keys.person(person_id),
            {
                "type": "PERSON",
                "personId": person_id,
                "givenName": "Amina",
                "familyName": "Ngo",
                "email": "patient@atria.invalid",
                "phoneE164": phone,
                "preferredLanguage": "fr",
            },
        )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {
            "type": "PATIENT_PROFILE",
            "patientProfileId": PATIENT,
            "personId": PERSON,
            "tenantId": TENANT,
        },
    )
    _person, membership = People(repository).create_staff_account(
        tenant_id=TENANT,
        account=staff_rules.StaffAccount(
            given_name="Paul",
            family_name="Etoa",
            phone_e164="+237600000010",
            roles=("CLINICIAN",),
            clinic_id=DOUALA,
            specialty="Paediatrics",
            registration_year=2012,
            ordre_number="CM-ONMC-1",
            languages=("fr",),
        ),
    )
    fakes = {"sns": FakeSns(), "scheduler": FakeScheduler()}
    monkeypatch.setattr(sender, "_sns", fakes["sns"])
    monkeypatch.setattr(sender, "_scheduler", fakes["scheduler"])
    monkeypatch.setattr(sender, "_booking", Booking(repository, clock=lambda: NOW))
    monkeypatch.setattr(sender, "_people", People(repository))
    monkeypatch.setattr(sender, "_messages", Messages(repository, clock=lambda: NOW))
    monkeypatch.setattr(sender, "SCHEDULE_GROUP", "atria-test-reminders")
    monkeypatch.setattr(sender, "SCHEDULER_ROLE_ARN", "arn:aws:iam::1:role/scheduler")
    monkeypatch.setattr(sender, "OUTBOX_QUEUE_ARN", "arn:aws:sqs:us-east-1:1:outbox.fifo")
    return repository, membership["staffMembershipId"], fakes


def put_appointment(repository, clinician, *, start=LATER, state="BOOKED", appointment_id="a-1"):
    repository.put(
        keys.appointment(TENANT, appointment_id),
        {
            "type": "APPOINTMENT",
            "appointmentId": appointment_id,
            "reference": "APT-0123456789",
            "tenantId": TENANT,
            "clinicId": DOUALA,
            "patientProfileId": PATIENT,
            "appointmentTypeId": "at-spec-first",
            "clinicianProfileId": clinician,
            "startAt": start,
            "endAt": start,
            "state": state,
        },
    )


def run(kind: str, *, appointment_id="a-1", message_id="m-1", extra: dict | None = None):
    body = {"kind": kind, "channel": "SMS", "tenantId": TENANT, "appointmentId": appointment_id}
    body.update(extra or {})
    return sender.handler(
        {
            "Records": [
                {
                    "messageId": message_id,
                    "attributes": {"SentTimestamp": QUEUED_MS},
                    "body": json.dumps(body),
                }
            ]
        },
        None,
    )


def fire(fakes):
    """What EventBridge Scheduler does at the fire time: put the job on the outbox."""
    (schedule,) = fakes["scheduler"].schedules.values()
    job = json.loads(schedule["Target"]["Input"])
    return sender.handler(
        {
            "Records": [
                {
                    "messageId": "m-fired",
                    "attributes": {"SentTimestamp": str(int(NOW.timestamp() * 1000) + 999)},
                    "body": json.dumps(job),
                }
            ]
        },
        None,
    )


def cancel_directly(repository):
    """The appointment is cancelled but the schedule's removal did not happen."""
    repository.update_existing(
        keys.appointment(TENANT, "a-1"),
        set_values={"state": "PATIENT_CANCELLED"},
        what="appointment",
    )


def rows(repository):
    return Messages(repository).for_day(TENANT, "2026-03-01")


class TestScheduling:
    def test_fr_rem_01_a_booking_gets_a_one_time_schedule_a_day_ahead(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        assert run(reminders.SCHEDULE)["batchItemFailures"] == []
        schedule = fakes["scheduler"].schedules["reminder-a-1"]
        assert schedule["ScheduleExpression"] == "at(2026-03-03T08:00:00)"
        assert schedule["ScheduleExpressionTimezone"] == "UTC"
        assert schedule["ActionAfterCompletion"] == "DELETE"
        assert schedule["FlexibleTimeWindow"] == {"Mode": "OFF"}

    def test_the_schedule_puts_the_reminder_in_the_appointments_own_group(self, world):
        """So it can never overtake the cancellation that should remove it."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        target = fakes["scheduler"].schedules["reminder-a-1"]["Target"]
        assert target["SqsParameters"] == {"MessageGroupId": "a-1"}
        assert json.loads(target["Input"])["kind"] == notices.APPOINTMENT_REMINDER

    def test_fr_rem_01_the_reference_is_stored_on_the_appointment(self, world):
        repository, clinician, _fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        stored = repository.get(keys.appointment(TENANT, "a-1"))
        assert stored["reminderSchedule"] == "reminder-a-1"
        assert stored["reminderScheduledFor"] == "2026-03-03T08:00:00Z"

    def test_the_reminder_is_logged_as_scheduled(self, world):
        """FR-MSG-03: a message that will go later is in the log now."""
        repository, clinician, _fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        (row,) = rows(repository)
        assert row["deliveryState"] == SCHEDULED
        assert row["kind"] == notices.APPOINTMENT_REMINDER
        assert row["channel"] == "SMS"
        assert row["reminderId"] == "reminder-a-1"

    def test_scheduling_twice_makes_one_reminder_and_one_row(self, world):
        """A redelivered job must not remind twice."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        assert run(reminders.SCHEDULE)["batchItemFailures"] == []
        assert len(fakes["scheduler"].schedules) == 1
        assert len(rows(repository)) == 1

    def test_no_reminder_for_an_appointment_already_cancelled(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician, state="PATIENT_CANCELLED")
        run(reminders.SCHEDULE)
        assert fakes["scheduler"].schedules == {}


class TestInsideTheLeadTime:
    def test_fr_rem_06_no_reminder_is_scheduled(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician, start=SOON)
        run(reminders.SCHEDULE)
        assert fakes["scheduler"].schedules == {}

    def test_fr_rem_06_the_confirmation_goes_by_sms_at_once(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician, start=SOON)
        run(reminders.SCHEDULE)
        (sms,) = fakes["sns"].published
        assert sms["PhoneNumber"] == "+237600000001"
        assert "confirme" in sms["Message"]
        (row,) = rows(repository)
        assert row["kind"] == notices.BOOKING_CONFIRMATION
        assert row["channel"] == "SMS"
        assert row["deliveryState"] == SENT


class TestFiring:
    def test_br_08_the_reminder_is_published_to_the_current_number(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        assert fire(fakes)["batchItemFailures"] == []
        (sms,) = fakes["sns"].published
        assert sms["PhoneNumber"] == "+237600000001"
        assert "Rappel" in sms["Message"]

    def test_fr_rem_03_it_is_a_transactional_sms(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        fire(fakes)
        attributes = fakes["sns"].published[0]["MessageAttributes"]
        assert attributes["AWS.SNS.SMS.SMSType"]["StringValue"] == "Transactional"

    def test_the_row_scheduled_earlier_becomes_sent(self, world):
        """One row per message, from scheduling through to sending."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        fire(fakes)
        (row,) = rows(repository)
        assert row["deliveryState"] == SENT
        assert row["providerMessageId"] == "sns-0001"

    def test_fr_rem_03_the_number_is_read_when_it_fires(self, world):
        """A patient who changed their number after booking is reached at the new one."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        repository.update_existing(
            keys.person(PERSON), set_values={"phoneE164": "+237677777777"}, what="person"
        )
        fire(fakes)
        assert fakes["sns"].published[0]["PhoneNumber"] == "+237677777777"
        assert rows(repository)[0]["recipient"] == "+237677777777"

    def test_fr_rem_03_a_minor_is_reminded_through_their_guardian(self, world):
        repository, clinician, fakes = world
        repository.update_existing(
            keys.patient_profile(TENANT, PATIENT),
            set_values={"guardianPersonId": GUARDIAN},
            what="patient",
        )
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        fire(fakes)
        assert fakes["sns"].published[0]["PhoneNumber"] == "+237600000099"

    def test_fr_rem_02_a_cancelled_appointment_is_not_reminded(self, world):
        """The schedule removal failed or raced; the worker still refuses."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        cancel_directly(repository)
        assert fire(fakes)["batchItemFailures"] == []
        assert fakes["sns"].published == []

    def test_fr_rem_02_the_skip_is_logged(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        cancel_directly(repository)
        fire(fakes)
        (row,) = rows(repository)
        assert row["deliveryState"] == CANCELLED
        assert "PATIENT_CANCELLED" in row["cancelledReason"]

    def test_a_patient_with_no_number_closes_the_row_rather_than_leaving_it(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        repository.update_existing(keys.person(PERSON), set_values={"phoneE164": ""}, what="person")
        assert fire(fakes)["batchItemFailures"] == []
        (row,) = rows(repository)
        assert row["deliveryState"] == FAILED
        assert "no sms address" in row["failureReason"]


class TestCancelling:
    def test_fr_vis_04_cancelling_removes_the_schedule(self, world):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        assert run(reminders.CANCEL, message_id="m-2")["batchItemFailures"] == []
        assert fakes["scheduler"].schedules == {}
        assert fakes["scheduler"].deleted == ["reminder-a-1"]

    def test_the_reminder_row_is_marked_cancelled(self, world):
        repository, clinician, _fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        run(reminders.CANCEL, message_id="m-2")
        (row,) = rows(repository)
        assert row["deliveryState"] == CANCELLED

    def test_no_schedule_to_remove_is_not_an_error(self, world):
        """Booked inside the lead time, so there never was one."""
        repository, clinician, _fakes = world
        put_appointment(repository, clinician)
        assert run(reminders.CANCEL)["batchItemFailures"] == []

    def test_a_reminder_already_sent_keeps_its_sent_row(self, world):
        """The patient did receive it. The log records what happened."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        fire(fakes)
        run(reminders.CANCEL, message_id="m-3")
        (row,) = rows(repository)
        assert row["deliveryState"] == SENT


class TestRefusals:
    def test_a_permanent_refusal_is_logged_and_not_retried(self, world, monkeypatch):
        """An opted out number will be opted out on the fifth attempt too."""
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        monkeypatch.setattr(sender, "_sns", FakeSns(fail=client_error("OptedOut", "Publish")))
        assert fire(fakes)["batchItemFailures"] == []
        (row,) = rows(repository)
        assert row["deliveryState"] == FAILED
        assert "OptedOut" in row["failureReason"]

    def test_a_throttle_is_logged_and_retried(self, world, monkeypatch):
        repository, clinician, fakes = world
        put_appointment(repository, clinician)
        run(reminders.SCHEDULE)
        monkeypatch.setattr(sender, "_sns", FakeSns(fail=client_error("Throttling", "Publish")))
        assert fire(fakes)["batchItemFailures"] == [{"itemIdentifier": "m-fired"}]
        assert rows(repository)[0]["deliveryState"] == FAILED

    def test_an_email_rejected_for_good_is_not_retried_either(self, world, monkeypatch):
        repository, clinician, _fakes = world
        put_appointment(repository, clinician)

        class RejectingSes:
            def send_email(self, **_kwargs):
                raise client_error("MessageRejected", "SendEmail")

        monkeypatch.setattr(sender, "_ses", RejectingSes())
        monkeypatch.setattr(sender, "SENDER", "atria@atria.invalid")
        result = sender.handler(
            {
                "Records": [
                    {
                        "messageId": "m-email",
                        "attributes": {"SentTimestamp": QUEUED_MS},
                        "body": json.dumps(
                            {
                                "kind": notices.BOOKING_CONFIRMATION,
                                "channel": "EMAIL",
                                "tenantId": TENANT,
                                "appointmentId": "a-1",
                            }
                        ),
                    }
                ]
            },
            None,
        )
        assert result["batchItemFailures"] == []
        assert rows(repository)[0]["deliveryState"] == FAILED


class TestDispatch:
    def stream(self, *, old_state, new_state, event_id="e-1"):
        change = {
            "NewImage": {
                "type": {"S": "APPOINTMENT"},
                "state": {"S": new_state},
                "tenantId": {"S": TENANT},
                "appointmentId": {"S": "a-1"},
            }
        }
        if old_state is not None:
            change["OldImage"] = {"type": {"S": "APPOINTMENT"}, "state": {"S": old_state}}
        return {"eventID": event_id, "dynamodb": change}

    def test_a_booking_owes_a_confirmation_and_a_reminder(self):
        jobs = outbox.jobs_due(self.stream(old_state=None, new_state="BOOKED"))
        assert [(j["kind"], j["channel"]) for j in jobs] == [
            (notices.BOOKING_CONFIRMATION, "EMAIL"),
            (reminders.SCHEDULE, "SMS"),
        ]

    def test_a_cancellation_owes_a_notice_and_the_reminders_removal(self):
        jobs = outbox.jobs_due(self.stream(old_state="BOOKED", new_state="CLINIC_CANCELLED"))
        assert [j["kind"] for j in jobs] == [notices.BOOKING_CANCELLATION, reminders.CANCEL]

    def test_storing_the_reminder_reference_owes_nothing(self):
        """It rewrites the appointment in the same state; a loop would follow otherwise."""
        assert outbox.jobs_due(self.stream(old_state="BOOKED", new_state="BOOKED")) == []

    def test_two_jobs_from_one_record_get_two_deduplication_ids(self, monkeypatch):
        """A shared id would have the FIFO queue drop the second job silently."""

        class Capture:
            def __init__(self) -> None:
                self.sent: list[dict] = []

            def send_message(self, **kwargs):
                self.sent.append(kwargs)

        capture = Capture()
        monkeypatch.setattr(outbox, "_sqs", capture)
        outbox.handler({"Records": [self.stream(old_state=None, new_state="BOOKED")]}, None)
        ids = [m["MessageDeduplicationId"] for m in capture.sent]
        assert len(ids) == 2
        assert len(set(ids)) == 2
