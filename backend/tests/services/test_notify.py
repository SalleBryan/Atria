"""Change capture to a sent email, with a row for every message.

Verifies FR-MSG-01 (a booking sends a confirmation where the patient has an
email), FR-MSG-02 (a cancellation sends one too) and FR-MSG-03 (every message
is logged with its channel, kind, recipient, appointment and state). Together
these are acceptance test BR-09.

The stream is the source of what happened, so a committed booking cannot fail
to notify. The sender re-reads everything at send time, which is what lets it
skip a notice the record has moved past (FR-REM-02).
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from atria.core import notices
from atria.core import staff as staff_rules
from atria.data import keys
from atria.data.booking import Booking
from atria.data.messages import FAILED, SENT, Messages
from atria.data.people import People
from atria.services.notify import outbox, sender

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
DOUALA = "c-douala-01"
PATIENT = "pp-1"
PERSON = "p-patient-1"
NOW = dt.datetime(2026, 3, 1, 9, 0, tzinfo=dt.UTC)


class FakeSes:
    """Records what was handed to SES, and can be told to refuse."""

    def __init__(self, *, fail: Exception | None = None) -> None:
        self.sent: list[dict] = []
        self.fail = fail

    def send_email(self, **kwargs):
        if self.fail is not None:
            raise self.fail
        self.sent.append(kwargs)
        return {"MessageId": f"ses-{len(self.sent):04d}"}


class FakeSqs:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    def send_message(self, **kwargs):
        self.messages.append(kwargs)
        return {"MessageId": f"sqs-{len(self.messages):04d}"}


@pytest.fixture
def seeded(repository):
    repository.put(
        keys.tenant(TENANT),
        {"type": "TENANT", "tenantId": TENANT, "gridUnitMinutes": 10, "regionPackCode": "CM"},
    )
    repository.put(
        keys.region_pack("CM"),
        {"type": "REGION_PACK", "code": "CM", "timezone": "Africa/Douala"},
    )
    repository.put(
        keys.clinic(TENANT, DOUALA),
        {
            "type": "CLINIC",
            "clinicId": DOUALA,
            "tenantId": TENANT,
            "name": "Clinique de Douala",
        },
    )
    repository.put(
        keys.person(PERSON),
        {
            "type": "PERSON",
            "personId": PERSON,
            "givenName": "Amina",
            "familyName": "Ngo",
            "email": "patient@atria.invalid",
            "phoneE164": "+237600000001",
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
    return repository, membership["staffMembershipId"]


def put_appointment(repository, clinician, *, state="BOOKED", appointment_id="a-1"):
    return repository.put(
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
            "startAt": "2026-03-04T08:00:00Z",
            "endAt": "2026-03-04T08:30:00Z",
            "state": state,
        },
    )


@pytest.fixture
def wired(monkeypatch, seeded):
    repository, clinician = seeded
    fake_ses = FakeSes()
    monkeypatch.setattr(sender, "_ses", fake_ses)
    monkeypatch.setattr(sender, "_booking", Booking(repository, clock=lambda: NOW))
    monkeypatch.setattr(sender, "_people", People(repository))
    monkeypatch.setattr(sender, "_messages", Messages(repository, clock=lambda: NOW))
    monkeypatch.setattr(sender, "SENDER", "atria@atria.invalid")
    return repository, clinician, fake_ses


def job(kind=notices.BOOKING_CONFIRMATION, appointment_id="a-1", channel="EMAIL"):
    return {
        "Records": [
            {
                "messageId": "m-1",
                "body": json.dumps(
                    {
                        "kind": kind,
                        "channel": channel,
                        "tenantId": TENANT,
                        "appointmentId": appointment_id,
                    }
                ),
            }
        ]
    }


def stream_record(*, new: dict, old: dict | None = None, event_id="e-1"):
    def tagged(image):
        return {name: {"S": str(value)} for name, value in image.items()}

    change: dict = {"NewImage": tagged(new)}
    if old is not None:
        change["OldImage"] = tagged(old)
    return {"eventID": event_id, "dynamodb": change}


class TestOutbox:
    def test_a_new_booking_owes_a_confirmation(self, monkeypatch):
        fake = FakeSqs()
        monkeypatch.setattr(outbox, "_sqs", fake)
        monkeypatch.setattr(outbox, "OUTBOX_QUEUE_URL", "https://queue.invalid/outbox")
        result = outbox.handler(
            {
                "Records": [
                    stream_record(
                        new={
                            "type": "APPOINTMENT",
                            "state": "BOOKED",
                            "tenantId": TENANT,
                            "appointmentId": "a-1",
                        }
                    )
                ]
            },
            None,
        )
        assert result["batchItemFailures"] == []
        body = json.loads(fake.messages[0]["MessageBody"])
        assert body["kind"] == notices.BOOKING_CONFIRMATION
        assert body["appointmentId"] == "a-1"

    def test_a_cancellation_owes_a_cancellation_notice(self, monkeypatch):
        fake = FakeSqs()
        monkeypatch.setattr(outbox, "_sqs", fake)
        monkeypatch.setattr(outbox, "OUTBOX_QUEUE_URL", "https://queue.invalid/outbox")
        outbox.handler(
            {
                "Records": [
                    stream_record(
                        old={"type": "APPOINTMENT", "state": "BOOKED"},
                        new={
                            "type": "APPOINTMENT",
                            "state": "PATIENT_CANCELLED",
                            "tenantId": TENANT,
                            "appointmentId": "a-1",
                        },
                    )
                ]
            },
            None,
        )
        body = json.loads(fake.messages[0]["MessageBody"])
        assert body["kind"] == notices.BOOKING_CANCELLATION

    def test_a_rewrite_in_the_same_state_owes_nothing(self, monkeypatch):
        """Otherwise a retried write would send a second confirmation."""
        fake = FakeSqs()
        monkeypatch.setattr(outbox, "_sqs", fake)
        outbox.handler(
            {
                "Records": [
                    stream_record(
                        old={"type": "APPOINTMENT", "state": "BOOKED"},
                        new={
                            "type": "APPOINTMENT",
                            "state": "BOOKED",
                            "tenantId": TENANT,
                            "appointmentId": "a-1",
                        },
                    )
                ]
            },
            None,
        )
        assert fake.messages == []

    def test_a_state_nobody_needs_telling_about_owes_nothing(self, monkeypatch):
        fake = FakeSqs()
        monkeypatch.setattr(outbox, "_sqs", fake)
        outbox.handler(
            {
                "Records": [
                    stream_record(
                        old={"type": "APPOINTMENT", "state": "BOOKED"},
                        new={
                            "type": "APPOINTMENT",
                            "state": "ARRIVED",
                            "tenantId": TENANT,
                            "appointmentId": "a-1",
                        },
                    )
                ]
            },
            None,
        )
        assert fake.messages == []

    def test_another_kind_of_record_is_ignored(self, monkeypatch):
        """A lock, an event and a person all travel the same stream."""
        fake = FakeSqs()
        monkeypatch.setattr(outbox, "_sqs", fake)
        outbox.handler(
            {"Records": [stream_record(new={"type": "SLOT_LOCK", "state": "BOOKED"})]}, None
        )
        assert fake.messages == []

    def test_the_group_is_the_appointment_and_the_dedupe_is_the_record(self, monkeypatch):
        fake = FakeSqs()
        monkeypatch.setattr(outbox, "_sqs", fake)
        monkeypatch.setattr(outbox, "OUTBOX_QUEUE_URL", "https://queue.invalid/outbox")
        outbox.handler(
            {
                "Records": [
                    stream_record(
                        new={
                            "type": "APPOINTMENT",
                            "state": "BOOKED",
                            "tenantId": TENANT,
                            "appointmentId": "a-7",
                        },
                        event_id="e-99",
                    )
                ]
            },
            None,
        )
        assert fake.messages[0]["MessageGroupId"] == "a-7"
        # The record id, suffixed with the job, because one record now owes
        # two jobs and a shared id would have the second dropped.
        assert fake.messages[0]["MessageDeduplicationId"] == f"e-99:{notices.BOOKING_CONFIRMATION}"

    def test_a_record_that_cannot_be_queued_is_reported_not_swallowed(self, monkeypatch):
        class Broken:
            def send_message(self, **_kwargs):
                raise RuntimeError("queue unavailable")

        monkeypatch.setattr(outbox, "_sqs", Broken())
        result = outbox.handler(
            {
                "Records": [
                    stream_record(
                        new={
                            "type": "APPOINTMENT",
                            "state": "BOOKED",
                            "tenantId": TENANT,
                            "appointmentId": "a-1",
                        },
                        event_id="e-5",
                    )
                ]
            },
            None,
        )
        assert result["batchItemFailures"] == [{"itemIdentifier": "e-5"}]


class TestSending:
    def test_fr_msg_01_a_confirmation_is_sent(self, wired):
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician)
        assert sender.handler(job(), None)["batchItemFailures"] == []
        assert len(fake_ses.sent) == 1
        assert fake_ses.sent[0]["Destination"]["ToAddresses"] == ["patient@atria.invalid"]

    def test_the_email_says_the_local_time(self, wired):
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician)
        sender.handler(job(), None)
        body = fake_ses.sent[0]["Content"]["Simple"]["Body"]["Text"]["Data"]
        assert "09:00" in body
        assert "Clinique de Douala" in body
        assert "Paul Etoa" in body

    def test_fr_msg_02_a_cancellation_is_sent(self, wired):
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician, state="PATIENT_CANCELLED")
        sender.handler(job(notices.BOOKING_CANCELLATION), None)
        subject = fake_ses.sent[0]["Content"]["Simple"]["Subject"]["Data"]
        assert "annule" in subject.lower()

    def test_fr_msg_03_the_message_is_logged_as_sent(self, wired):
        repository, clinician, _ses = wired
        put_appointment(repository, clinician)
        sender.handler(job(), None)
        logged = Messages(repository).for_day(TENANT, "2026-03-01")
        assert len(logged) == 1
        assert logged[0]["deliveryState"] == SENT
        assert logged[0]["providerMessageId"] == "ses-0001"
        assert logged[0]["appointmentId"] == "a-1"
        assert logged[0]["channel"] == "EMAIL"

    def test_the_sender_is_the_verified_identity(self, wired):
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician)
        sender.handler(job(), None)
        assert fake_ses.sent[0]["FromEmailAddress"] == "atria@atria.invalid"


class TestNotSending:
    def test_a_confirmation_for_a_cancelled_appointment_is_skipped(self, wired):
        """FR-REM-02: the record moved on, so the notice is not sent."""
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician, state="PATIENT_CANCELLED")
        assert sender.handler(job(), None)["batchItemFailures"] == []
        assert fake_ses.sent == []

    def test_a_skip_writes_no_message_log_row(self, wired):
        repository, clinician, _ses = wired
        put_appointment(repository, clinician, state="PATIENT_CANCELLED")
        sender.handler(job(), None)
        assert Messages(repository).for_day(TENANT, "2026-03-01") == []

    def test_a_patient_with_no_email_is_not_a_failure(self, wired):
        """FR-MSG-01 sends where the patient has an address."""
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician)
        repository.update_existing(keys.person(PERSON), set_values={"email": ""}, what="person")
        assert sender.handler(job(), None)["batchItemFailures"] == []
        assert fake_ses.sent == []

    def test_a_provider_refusal_is_logged_and_retried(self, wired, monkeypatch):
        repository, clinician, _ses = wired
        monkeypatch.setattr(
            sender, "_ses", FakeSes(fail=RuntimeError("Email address is not verified"))
        )
        put_appointment(repository, clinician)
        result = sender.handler(job(), None)
        assert result["batchItemFailures"] == [{"itemIdentifier": "m-1"}]
        logged = Messages(repository).for_day(TENANT, "2026-03-01")
        assert logged[0]["deliveryState"] == FAILED
        assert "not verified" in logged[0]["failureReason"]

    def test_an_unknown_appointment_is_retried_not_dropped(self, wired):
        result = sender.handler(job(appointment_id="a-nope"), None)
        assert result["batchItemFailures"] == [{"itemIdentifier": "m-1"}]

    def test_an_unconfigured_sender_fails_loudly(self, wired, monkeypatch):
        repository, clinician, _ses = wired
        monkeypatch.setattr(sender, "SENDER", "")
        put_appointment(repository, clinician)
        result = sender.handler(job(), None)
        assert result["batchItemFailures"] == [{"itemIdentifier": "m-1"}]
        logged = Messages(repository).for_day(TENANT, "2026-03-01")
        assert logged[0]["deliveryState"] == FAILED


def queued(kind=notices.BOOKING_CONFIRMATION, *, message_id="m-1", sent_ms="1772355600000"):
    """A record as SQS delivers it, with the attributes a redelivery keeps."""
    return {
        "Records": [
            {
                "messageId": message_id,
                "attributes": {"SentTimestamp": sent_ms},
                "body": json.dumps(
                    {
                        "kind": kind,
                        "channel": "EMAIL",
                        "tenantId": TENANT,
                        "appointmentId": "a-1",
                    }
                ),
            }
        ]
    }


class TestRetries:
    def test_a_retry_lands_on_the_row_the_first_attempt_wrote(self, wired, monkeypatch):
        """One message, one row, whatever happened on the way. A FAILED row
        beside a SENT one would send somebody chasing a failure that never
        reached the patient."""
        repository, clinician, _ses = wired
        put_appointment(repository, clinician)

        monkeypatch.setattr(sender, "_ses", FakeSes(fail=RuntimeError("Throttling")))
        assert sender.handler(queued(), None)["batchItemFailures"]

        monkeypatch.setattr(sender, "_ses", FakeSes())
        assert sender.handler(queued(), None)["batchItemFailures"] == []

        rows = Messages(repository).for_day(TENANT, "2026-03-01")
        assert len(rows) == 1
        assert rows[0]["deliveryState"] == SENT

    def test_a_success_after_a_failure_clears_the_reason(self, wired, monkeypatch):
        repository, clinician, _ses = wired
        put_appointment(repository, clinician)
        monkeypatch.setattr(sender, "_ses", FakeSes(fail=RuntimeError("Throttling")))
        sender.handler(queued(), None)
        monkeypatch.setattr(sender, "_ses", FakeSes())
        sender.handler(queued(), None)
        row = Messages(repository).for_day(TENANT, "2026-03-01")[0]
        assert "failureReason" not in row

    def test_the_row_is_timed_by_when_the_queue_first_took_it(self, wired):
        """Redelivery keeps the queue's timestamp, so the key does not move."""
        repository, clinician, _ses = wired
        put_appointment(repository, clinician)
        sender.handler(queued(sent_ms="1772355600000"), None)
        row = Messages(repository).for_day(TENANT, "2026-03-01")[0]
        assert row["sentAt"] == "2026-03-01T09:00:00Z"

    def test_different_messages_still_get_different_rows(self, wired):
        repository, clinician, _ses = wired
        put_appointment(repository, clinician)
        sender.handler(queued(message_id="m-1"), None)
        sender.handler(queued(message_id="m-2"), None)
        assert len(Messages(repository).for_day(TENANT, "2026-03-01")) == 2


class TestBatch:
    def test_br_09_every_message_in_a_batch_is_logged(self, wired):
        """BR-09 in miniature: what goes out is what is recorded."""
        repository, clinician, fake_ses = wired
        records = []
        for index in range(6):
            put_appointment(repository, clinician, appointment_id=f"a-{index}")
            records.append(
                {
                    "messageId": f"m-{index}",
                    "body": json.dumps(
                        {
                            "kind": notices.BOOKING_CONFIRMATION,
                            "channel": "EMAIL",
                            "tenantId": TENANT,
                            "appointmentId": f"a-{index}",
                        }
                    ),
                }
            )
        result = sender.handler({"Records": records}, None)
        assert result["batchItemFailures"] == []
        assert len(fake_ses.sent) == 6
        logged = Messages(repository).for_day(TENANT, "2026-03-01")
        assert len(logged) == 6
        assert all(row["deliveryState"] == SENT for row in logged)

    def test_one_bad_job_does_not_stop_the_others(self, wired):
        repository, clinician, fake_ses = wired
        put_appointment(repository, clinician, appointment_id="a-good")
        records = [
            {
                "messageId": "m-bad",
                "body": json.dumps(
                    {
                        "kind": notices.BOOKING_CONFIRMATION,
                        "channel": "EMAIL",
                        "tenantId": TENANT,
                        "appointmentId": "a-missing",
                    }
                ),
            },
            {
                "messageId": "m-good",
                "body": json.dumps(
                    {
                        "kind": notices.BOOKING_CONFIRMATION,
                        "channel": "EMAIL",
                        "tenantId": TENANT,
                        "appointmentId": "a-good",
                    }
                ),
            },
        ]
        result = sender.handler({"Records": records}, None)
        assert result["batchItemFailures"] == [{"itemIdentifier": "m-bad"}]
        assert len(fake_ses.sent) == 1
