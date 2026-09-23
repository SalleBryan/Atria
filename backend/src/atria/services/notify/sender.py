"""The one thing that talks to a provider and writes the message log.

Reads a send job from the outbox, re-reads everything it needs, composes the
notice and sends it (FR-MSG-01, FR-MSG-02, FR-MSG-03). Both the immediate
notices and, later, the scheduled reminders arrive the same way, so there is
one place that touches SES and one place that records having done so.

Everything is read again at send time rather than carried in the job, because
the two can differ: an appointment may have been cancelled since, and a patient
may have changed their email (FR-REM-02, FR-REM-03). A job carrying a stale
address would send to the wrong person and log it as a success.

A message that cannot be sent is recorded as FAILED and then raised, so the
queue retries it and eventually parks it on the dead letter queue. Swallowing
the error would leave a patient uninformed with nothing to show it.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import notices, schedule
from atria.data.booking import Booking
from atria.data.messages import Messages
from atria.data.people import People
from atria.data.repository import Repository

logger = Logger(service="atria-sender")

# The verified identity every notice is sent from. SES refuses an unverified
# sender, so an unset value is a deployment fault and not a runtime choice.
SENDER = os.environ.get("NOTICE_SENDER", "")

_ses: Any = None
_booking: Booking | None = None
_people: People | None = None
_messages: Messages | None = None


def ses() -> Any:
    global _ses
    if _ses is None:
        _ses = boto3.client("sesv2")
    return _ses


def booking() -> Booking:
    global _booking
    if _booking is None:
        _booking = Booking(Repository())
    return _booking


def people() -> People:
    global _people
    if _people is None:
        _people = People(Repository())
    return _people


def messages() -> Messages:
    global _messages
    if _messages is None:
        _messages = Messages(Repository())
    return _messages


# States a notice is still worth sending in. A confirmation for an appointment
# already cancelled would contradict the cancellation that followed it.
def still_worth_sending(kind: str, state: str) -> bool:
    if kind == notices.BOOKING_CONFIRMATION:
        return state in ("BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED")
    return state in ("PATIENT_CANCELLED", "CLINIC_CANCELLED")


def recipient_of(person: dict[str, Any], channel: str) -> str | None:
    """Where this notice goes, read now rather than when it was queued."""
    if channel == "EMAIL":
        return str(person.get("email") or "") or None
    return str(person.get("phoneE164") or "") or None


def deliver(
    job: dict[str, Any], *, message_id: str | None = None, queued_at: dt.datetime | None = None
) -> str:
    """Send one notice, or say why it was not sent.

    Returns a short word for the log line. Raising is reserved for a failure
    worth retrying.

    `message_id` and `queued_at` come from the queue and are the same on every
    redelivery of one message, which is what lets a retry land on the log row
    the first attempt wrote rather than adding another.
    """
    tenant_id = str(job["tenantId"])
    appointment_id = str(job["appointmentId"])
    kind = str(job["kind"])
    channel = str(job.get("channel") or "EMAIL")

    data = booking()
    appointment = data.appointment(tenant_id, appointment_id)
    state = str(appointment.get("state") or "")
    if not still_worth_sending(kind, state):
        # FR-REM-02: the record moved on, so the notice is skipped and the
        # skip is logged rather than sent.
        logger.info(
            "notice skipped, the appointment moved on",
            extra={"appointmentId": appointment_id, "kind": kind, "state": state},
        )
        return "skipped"

    profile = data.patient_profile(tenant_id, str(appointment["patientProfileId"]))
    person = people().person_record(str(profile["personId"]))
    recipient = recipient_of(person, channel)
    if recipient is None:
        # FR-MSG-01 sends an email where the patient has one. Having none is
        # not a failure, and the reminder path will reach them by SMS.
        logger.info(
            "no address for that channel",
            extra={"appointmentId": appointment_id, "channel": channel},
        )
        return "no-address"

    tenant = data.tenant(tenant_id)
    zone = schedule.timezone_for(data.region_pack(str(tenant.get("regionPackCode") or "CM")))
    clinic = data.clinic(tenant_id, str(appointment["clinicId"]))
    clinician_name = ""
    if appointment.get("clinicianProfileId"):
        clinician = people().clinician(tenant_id, str(appointment["clinicianProfileId"]))
        given = str(clinician.get("givenName") or "")
        family = str(clinician.get("familyName") or "")
        clinician_name = f"{given} {family}".strip()

    notice = notices.compose(
        kind,
        appointment=appointment,
        clinic_name=str(clinic.get("name") or ""),
        clinician_name=clinician_name,
        language=person.get("preferredLanguage"),
        zone=zone,
        channel=channel,
    )

    # Logged before the provider is called, so a send that vanishes leaves a
    # record behind rather than nothing at all.
    log = messages().scheduled(
        tenant_id=tenant_id,
        notice=notice,
        recipient_person_id=str(person["personId"]),
        recipient=recipient,
        appointment_id=appointment_id,
        message_log_id=f"ml-{message_id}" if message_id else None,
        at=queued_at,
    )

    if not SENDER:
        messages().failed(log, reason="NOTICE_SENDER is not configured")
        raise RuntimeError("NOTICE_SENDER is not configured")

    try:
        response = ses().send_email(
            FromEmailAddress=SENDER,
            Destination={"ToAddresses": [recipient]},
            Content={
                "Simple": {
                    "Subject": {"Data": notice.subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": notice.body, "Charset": "UTF-8"}},
                }
            },
        )
    except Exception as exc:
        messages().failed(log, reason=f"{type(exc).__name__}: {exc}")
        raise

    messages().sent(log, provider_message_id=str(response.get("MessageId") or ""))
    logger.info(
        "notice sent",
        extra={
            "appointmentId": appointment_id,
            "kind": kind,
            "channel": channel,
            "messageLogId": log["messageLogId"],
        },
    )
    return "sent"


def queued_at(record: dict[str, Any]) -> dt.datetime | None:
    """When the queue first accepted this message, which redelivery keeps."""
    stamp = (record.get("attributes") or {}).get("SentTimestamp")
    if not stamp:
        return None
    return dt.datetime.fromtimestamp(int(stamp) / 1000, tz=dt.UTC)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Send every notice in the batch, reporting the ones that could not go.

    A failure is returned per message rather than raised for the batch, so one
    bad job is retried and parked on its own and the rest still go out.
    """
    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        identifier = str(record.get("messageId"))
        try:
            deliver(
                json.loads(str(record.get("body") or "{}")),
                message_id=identifier,
                queued_at=queued_at(record),
            )
        except Exception:
            logger.exception("could not send a notice", extra={"messageId": identifier})
            failures.append({"itemIdentifier": identifier})
    return {"batchItemFailures": failures}
