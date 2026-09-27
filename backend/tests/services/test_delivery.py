# ruff: noqa: F401, F811  the wired fixtures are imported, and pytest passes them by name
"""What became of each message, and who reads it.

Verifies FR-MSG-04 (SES events and SNS delivery logs update the message log),
FR-MSG-05 (a unit's log, failed messages first, naming the patient and the
number to phone) and FR-MSG-06 (the administrator's delivery, bounce and
complaint rates, SMS spend per day, and the sender identities).

The wiring is the notice tests': a clinic in Douala, a patient with an email
and a phone, and a clock at 09:00 UTC on Sunday 2026-03-01.
"""

from __future__ import annotations

import base64
import datetime as dt
import gzip
import json

import pytest
from test_notify import DOUALA, NOW, TENANT, job, put_appointment, seeded, wired

from atria.data import keys
from atria.data.booking import Booking
from atria.data.messages import DELIVERED, FAILED, SENT, Messages
from atria.services.directory import clinicians as directory
from atria.services.directory import messages as message_views
from atria.services.notify import sender, status

pytestmark = pytest.mark.usefixtures("table")

DESK = {
    "personId": "p-desk",
    "tenantId": TENANT,
    "roles": "RECEPTIONIST",
    "staffId": "s-desk",
    "clinicId": DOUALA,
}
ADMIN = {"personId": "p-admin", "tenantId": TENANT, "roles": "TENANT_ADMIN", "staffId": "s-a"}


class FakeSns:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def publish(self, **kwargs):
        self.sent.append(kwargs)
        return {"MessageId": f"sns-{len(self.sent):04d}"}

    def get_sms_sandbox_account_status(self):
        return {"IsInSandbox": True}


class FakeSesAccount:
    def list_email_identities(self, **_kwargs):
        return {
            "EmailIdentities": [
                {
                    "IdentityName": "atria@atria.invalid",
                    "IdentityType": "EMAIL_ADDRESS",
                    "SendingEnabled": True,
                    "VerificationStatus": "SUCCESS",
                }
            ]
        }

    def get_account(self):
        return {"ProductionAccessEnabled": False}


@pytest.fixture
def reported(wired, monkeypatch):
    repository, clinician, fake_ses = wired
    monkeypatch.setattr(sender, "_sns", FakeSns())
    monkeypatch.setattr(status, "_messages", Messages(repository, clock=lambda: NOW))
    monkeypatch.setattr(directory, "_booking", Booking(repository, clock=lambda: NOW))
    monkeypatch.setattr(message_views, "_ses", FakeSesAccount())
    monkeypatch.setattr(message_views, "_sns", FakeSns())
    for n in (1, 2, 3):
        put_appointment(repository, clinician, appointment_id=f"a-{n}")
    return repository, fake_ses


def send(appointment_id: str, channel: str = "EMAIL") -> None:
    event = job(appointment_id=appointment_id, channel=channel)
    event["Records"][0]["messageId"] = f"m-{appointment_id}-{channel}"
    assert sender.handler(event, None)["batchItemFailures"] == []


def logged(repository) -> dict[str, dict]:
    rows = Messages(repository).for_day(TENANT, "2026-03-01")
    return {f"{r['appointmentId']}/{r['channel']}": r for r in rows}


def ses_event(kind: str, message_id: str, **detail) -> dict:
    return {
        "source": "aws.ses",
        "detail-type": f"Email {kind}",
        "detail": {
            "eventType": kind,
            "mail": {"messageId": message_id, "timestamp": "2026-03-01T09:00:00.000Z"},
            **detail,
        },
    }


def sms_logs(*lines: dict) -> dict:
    payload = {
        "logEvents": [{"id": str(n), "message": json.dumps(line)} for n, line in enumerate(lines)]
    }
    data = base64.b64encode(gzip.compress(json.dumps(payload).encode())).decode()
    return {"awslogs": {"data": data}}


def sms_line(message_id: str, ok: bool, price: float = 0.0322) -> dict:
    return {
        "notification": {"messageId": message_id, "timestamp": "2026-03-01 09:00:01.123"},
        "delivery": {
            "destination": "+237600000001",
            "priceInUSD": price,
            "providerResponse": "Message has been accepted by phone"
            if ok
            else "Phone is unreachable",
        },
        "status": "SUCCESS" if ok else "FAILURE",
    }


class TestSending:
    def test_email_goes_through_the_configuration_set(self, reported, monkeypatch):
        _repo, fake_ses = reported
        monkeypatch.setattr(sender, "CONFIGURATION_SET", "atria-dev-notices")
        send("a-1")
        assert fake_ses.sent[0]["ConfigurationSetName"] == "atria-dev-notices"

    def test_the_row_names_its_unit_and_the_day_it_went(self, reported):
        repository, _ses = reported
        send("a-1")
        row = logged(repository)["a-1/EMAIL"]
        assert row["clinicId"] == DOUALA
        assert row["messageDay"] == f"TENANT#{TENANT}#MSGDAY#2026-03-01"
        assert (
            repository.get(keys.provider_message("ses-0001"))["messageLogId"] == row["messageLogId"]
        )


class TestEmailReports:
    def test_fr_msg_04_a_delivery_is_recorded(self, reported):
        repository, _ses = reported
        send("a-1")
        assert status.handler(ses_event("Delivery", "ses-0001", delivery={}), None)["outcomes"] == [
            "recorded"
        ]
        assert logged(repository)["a-1/EMAIL"]["deliveryState"] == DELIVERED

    def test_a_bounce_fails_the_message_and_says_why(self, reported):
        repository, _ses = reported
        send("a-1")
        status.handler(
            ses_event(
                "Bounce",
                "ses-0001",
                bounce={
                    "bounceType": "Permanent",
                    "bouncedRecipients": [{"diagnosticCode": "550 5.1.1 user unknown"}],
                },
            ),
            None,
        )
        row = logged(repository)["a-1/EMAIL"]
        assert (row["deliveryState"], row["feedback"]) == (FAILED, "BOUNCE")
        assert "user unknown" in row["failureReason"]

    def test_a_complaint_keeps_the_delivery_and_is_noted(self, reported):
        repository, _ses = reported
        send("a-1")
        status.handler(ses_event("Delivery", "ses-0001", delivery={}), None)
        status.handler(ses_event("Complaint", "ses-0001", complaint={}), None)
        row = logged(repository)["a-1/EMAIL"]
        assert (row["deliveryState"], row["feedback"]) == (DELIVERED, "COMPLAINT")

    def test_a_report_on_nothing_atria_sent_is_ignored(self, reported, monkeypatch):
        later = Messages(reported[0], clock=lambda: NOW + dt.timedelta(days=1))
        monkeypatch.setattr(status, "_messages", later)
        assert status.handler(ses_event("Delivery", "ses-9999", delivery={}), None)["outcomes"] == [
            "unknown"
        ]

    def test_a_report_that_beat_the_sender_is_retried(self, reported):
        with pytest.raises(status.NotYetKnownError):
            status.handler(ses_event("Delivery", "ses-9999", delivery={}), None)

    def test_a_delay_says_nothing_final(self, reported):
        send("a-1")
        assert status.handler(ses_event("DeliveryDelay", "ses-0001"), None)["outcomes"] == [
            "ignored"
        ]


class TestSmsReports:
    def test_fr_msg_04_a_delivered_sms_and_its_price(self, reported):
        repository, _ses = reported
        send("a-1", "SMS")
        status.handler(sms_logs(sms_line("sns-0001", ok=True)), None)
        row = logged(repository)["a-1/SMS"]
        assert row["deliveryState"] == DELIVERED
        assert str(row["priceUsd"]) == "0.0322"

    def test_an_undelivered_sms_fails_with_the_carrier_reason(self, reported):
        repository, _ses = reported
        send("a-1", "SMS")
        status.handler(sms_logs(sms_line("sns-0001", ok=False)), None)
        row = logged(repository)["a-1/SMS"]
        assert row["deliveryState"] == FAILED
        assert row["failureReason"] == "Phone is unreachable"


def get(resource: str, context: dict, *, path: dict | None = None, query: dict | None = None):
    return directory.handler(
        {
            "httpMethod": "GET",
            "resource": resource,
            "pathParameters": path,
            "queryStringParameters": query,
            "requestContext": {"authorizer": context},
        },
        None,
    )


def body_of(result) -> dict:
    assert result["statusCode"] == 200, result["body"]
    return json.loads(result["body"])


class TestUnitLog:
    @pytest.fixture
    def day(self, reported):
        repository, _ses = reported
        for n in (1, 2, 3):
            send(f"a-{n}")
        status.handler(ses_event("Delivery", "ses-0001", delivery={}), None)
        status.handler(
            ses_event("Bounce", "ses-0002", bounce={"bounceType": "Permanent"}),
            None,
        )
        return repository

    def read(self, context=DESK, day="2026-03-01"):
        return get("/clinics/{id}/messages", context, path={"id": DOUALA}, query={"day": day})

    def test_fr_msg_05_failures_come_first(self, day):
        found = body_of(self.read())
        states = [m["deliveryState"] for m in found["messages"]]
        assert states[0] == FAILED
        assert sorted(states) == sorted([FAILED, DELIVERED, SENT])
        assert found["counts"] == {FAILED: 1, DELIVERED: 1, SENT: 1}

    def test_the_desk_sees_who_to_phone(self, day):
        first = body_of(self.read())["messages"][0]
        assert first["person"] == {"name": "Amina Ngo", "phoneE164": "+237600000001"}
        assert first["visit"]["startAt"] == "2026-03-04T08:00:00Z"
        assert first["feedback"] == "BOUNCE"

    def test_another_day_is_empty(self, day):
        assert body_of(self.read(day="2026-02-28"))["messages"] == []

    def test_another_units_desk_is_refused(self, day):
        assert self.read({**DESK, "clinicId": "c-other"})["statusCode"] == 403

    def test_a_clinician_does_not_read_it(self, day):
        clinician = {**DESK, "roles": "CLINICIAN"}
        assert self.read(clinician)["statusCode"] == 403


class TestDeliveryFigures:
    @pytest.fixture
    def week(self, reported):
        repository, _ses = reported
        send("a-1")
        send("a-2")
        send("a-1", "SMS")
        status.handler(ses_event("Delivery", "ses-0001", delivery={}), None)
        status.handler(ses_event("Bounce", "ses-0002", bounce={"bounceType": "Permanent"}), None)
        status.handler(sms_logs(sms_line("sns-0001", ok=True, price=0.0322)), None)
        return repository

    def test_fr_msg_06_rates_and_spend(self, week):
        found = body_of(get("/messages/delivery", ADMIN, query={"days": "7"}))
        email, sms = found["totals"]["email"], found["totals"]["sms"]
        assert (email["attempted"], email["delivered"], email["bounced"]) == (2, 1, 1)
        assert (email["deliveryRate"], email["bounceRate"], email["complaintRate"]) == (
            0.5,
            0.5,
            0.0,
        )
        assert (sms["delivered"], sms["spendUsd"]) == (1, "0.0322")
        assert [d["day"] for d in found["days"]][-1] == "2026-03-01"
        assert len(found["days"]) == 7

    def test_a_quiet_day_has_no_rate(self, week):
        found = body_of(get("/messages/delivery", ADMIN, query={"days": "7"}))
        assert found["days"][0]["email"]["deliveryRate"] is None

    def test_the_senders_and_sandboxes(self, week):
        found = body_of(get("/messages/delivery", ADMIN))
        assert found["senders"][0]["identity"] == "atria@atria.invalid"
        assert found["senders"][0]["verified"] is True
        assert found["senders"][0]["sandbox"] is True
        assert found["sms"] == {"sandbox": True}

    def test_a_unit_manager_is_refused(self, week):
        manager = {**DESK, "roles": "CLINIC_MANAGER"}
        assert get("/messages/delivery", manager)["statusCode"] == 403

    def test_the_range_is_bounded(self, week):
        assert get("/messages/delivery", ADMIN, query={"days": "90"})["statusCode"] == 400
