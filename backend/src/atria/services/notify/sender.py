"""The one thing that talks to a provider and writes the message log.

Reads a job from the outbox and does one of three things: sends a notice
(FR-MSG-01, FR-MSG-02, FR-REM-03), arranges a reminder for later (FR-REM-01), or
removes one because the appointment was cancelled (FR-VIS-04). Immediate
notices and reminders arrive the same way, so there is one place that touches
SES, SNS and EventBridge Scheduler, and one place that records having done so.

Everything is read again at send time rather than carried in the job, because
the two can differ: an appointment may have been cancelled since, and a patient
may have changed their number (FR-REM-02, FR-REM-03). A job carrying a stale
number would send to the wrong person and log it as a success.

A failure worth retrying is recorded as FAILED and then raised, so the queue
tries again and eventually parks it on the dead letter queue. A refusal that no
retry will change, such as an opted out number or an unverified address, is
recorded as FAILED and not raised: five identical attempts would only fill the
dead letter queue with messages nobody can act on.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import os
from email.utils import formataddr
from typing import Any

import boto3
from aws_lambda_powertools import Logger
from botocore.exceptions import ClientError

from atria.core import notices, reminders
from atria.core.errors import Conflict
from atria.data.booking import Booking
from atria.data.messages import SCHEDULED, Messages
from atria.data.people import People
from atria.data.repository import Item, Repository

logger = Logger(service="atria-sender")

# The verified identity every email is sent from. SES refuses an unverified
# sender, so an unset value is a deployment fault and not a runtime choice.
SENDER = os.environ.get("NOTICE_SENDER", "")

# How the sender reads in an inbox. SES checks the address, not this name.
SENDER_NAME = "Atria"

# The web client's public origin, which an email links into. Empty until the
# site is hosted, and then an email simply has no button.
APP_URL = os.environ.get("APP_URL", "")

SCHEDULE_GROUP = os.environ.get("SCHEDULE_GROUP", "")
SCHEDULER_ROLE_ARN = os.environ.get("SCHEDULER_ROLE_ARN", "")
OUTBOX_QUEUE_ARN = os.environ.get("OUTBOX_QUEUE_ARN", "")
REMINDER_FAILURES_ARN = os.environ.get("REMINDER_FAILURES_ARN", "")

# Provider error codes that describe the message or the recipient rather than
# the moment. Retrying them changes nothing.
PERMANENT = frozenset(
    {
        "MessageRejected",
        "MailFromDomainNotVerifiedException",
        "BadRequestException",
        "InvalidParameter",
        "InvalidParameterValue",
        "InvalidParameterException",
        "AuthorizationError",
        "AuthorizationErrorException",
        "OptedOut",
        "OptedOutException",
    }
)

# A reminder that cannot be delivered within this long of its fire time is not
# worth delivering late; the scheduler gives up and parks it instead.
REMINDER_MAX_AGE = dt.timedelta(hours=1)

_ses: Any = None
_sns: Any = None
_scheduler: Any = None
_booking: Booking | None = None
_people: People | None = None
_messages: Messages | None = None


def ses() -> Any:
    global _ses
    if _ses is None:
        _ses = boto3.client("sesv2")
    return _ses


def sns() -> Any:
    global _sns
    if _sns is None:
        _sns = boto3.client("sns")
    return _sns


def scheduler() -> Any:
    global _scheduler
    if _scheduler is None:
        _scheduler = boto3.client("scheduler")
    return _scheduler


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


def still_worth_sending(kind: str, state: str) -> bool:
    """A confirmation for an appointment already cancelled would contradict the
    cancellation that followed it, and a reminder for one is simply wrong."""
    if kind in (notices.BOOKING_CONFIRMATION, notices.APPOINTMENT_REMINDER):
        return state in reminders.REMINDABLE
    return state in ("PATIENT_CANCELLED", "CLINIC_CANCELLED")


def permanent(exc: Exception) -> bool:
    return isinstance(exc, ClientError) and exc.response["Error"]["Code"] in PERMANENT


def parse_time(value: object) -> dt.datetime | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))


# ---------------------------------------------------------------- recipients
def recipient_for(profile: Item, channel: str) -> tuple[Item, str | None]:
    """Who a notice goes to, and at what address, read now.

    An SMS for a patient with a guardian goes to the guardian (FR-REM-03). A
    proxy recipient is a notification preference, which arrives with the
    preferences screen; until one can be set, there is none to honour.
    """
    person = people().person_record(str(profile["personId"]))
    if channel == "EMAIL":
        return person, str(person.get("email") or "") or None
    guardian_id = profile.get("guardianPersonId")
    if guardian_id:
        guardian = people().person_record(str(guardian_id))
        return guardian, str(guardian.get("phoneE164") or "") or None
    return person, str(person.get("phoneE164") or "") or None


def zone_for(tenant_id: str) -> Any:
    return booking().zone(tenant_id)


def compose_for(
    tenant_id: str, appointment: Item, person: Item, kind: str, channel: str
) -> notices.Notice:
    data = booking()
    zone = zone_for(tenant_id)
    clinic = data.clinic(tenant_id, str(appointment["clinicId"]))
    clinician_name = ""
    if appointment.get("clinicianProfileId"):
        clinician = people().clinician(tenant_id, str(appointment["clinicianProfileId"]))
        given = str(clinician.get("givenName") or "")
        family = str(clinician.get("familyName") or "")
        clinician_name = f"{given} {family}".strip()
    return notices.compose(
        kind,
        appointment=appointment,
        clinic_name=str(clinic.get("name") or ""),
        clinician_name=clinician_name,
        language=person.get("preferredLanguage"),
        zone=zone,
        channel=channel,
        app_url=APP_URL,
    )


# ------------------------------------------------------------------ sending
def provider_send(notice: notices.Notice, recipient: str) -> str:
    """Hand one notice to its provider and return the provider's identifier."""
    if notice.channel == "EMAIL":
        if not SENDER:
            raise RuntimeError("NOTICE_SENDER is not configured")
        # Both parts, so a client that shows only text still reads the notice.
        body = {"Text": {"Data": notice.body, "Charset": "UTF-8"}}
        if notice.html:
            body["Html"] = {"Data": notice.html, "Charset": "UTF-8"}
        response = ses().send_email(
            FromEmailAddress=formataddr((SENDER_NAME, SENDER)),
            Destination={"ToAddresses": [recipient]},
            Content={
                "Simple": {
                    "Subject": {"Data": notice.subject, "Charset": "UTF-8"},
                    "Body": body,
                }
            },
        )
        return str(response.get("MessageId") or "")
    response = sns().publish(
        PhoneNumber=recipient,
        Message=notice.body,
        MessageAttributes={
            # Transactional, not promotional: an appointment reminder is not
            # marketing, and carriers route the two differently (FR-REM-03).
            "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
        },
    )
    return str(response.get("MessageId") or "")


def send_notice(
    job: dict[str, Any], *, message_id: str | None, queued_at: dt.datetime | None
) -> str:
    """Send one notice, or say why it was not sent."""
    tenant_id = str(job["tenantId"])
    appointment_id = str(job["appointmentId"])
    kind = str(job["kind"])
    channel = str(job.get("channel") or "EMAIL")
    # A reminder carries the identity of the log row written when it was
    # scheduled, so firing, skipping and failing all land on that same row.
    log_id = job.get("messageLogId") or (f"ml-{message_id}" if message_id else None)
    log_at = parse_time(job.get("loggedAt")) or queued_at
    reminder_id = job.get("reminderId")

    data = booking()
    appointment = data.appointment(tenant_id, appointment_id)
    state = str(appointment.get("state") or "")
    if not still_worth_sending(kind, state):
        # FR-REM-02: the record moved on, so nothing is sent and the skip is
        # logged. A reminder already has a row, which is closed as CANCELLED.
        logger.info(
            "notice skipped, the appointment moved on",
            extra={"appointmentId": appointment_id, "kind": kind, "state": state},
        )
        if job.get("messageLogId"):
            close_scheduled(
                {"tenantId": tenant_id, "sentAt": job.get("loggedAt"), "messageLogId": log_id},
                reason=f"the appointment is {state}",
            )
        return "skipped"

    profile = data.patient_profile(tenant_id, str(appointment["patientProfileId"]))
    person, recipient = recipient_for(profile, channel)
    notice = compose_for(tenant_id, appointment, person, kind, channel)

    if recipient is None:
        # FR-MSG-01 sends an email where the patient has one. Having none is
        # not a failure. A reminder already has a row, and it is closed rather
        # than left SCHEDULED for ever.
        logger.info(
            "no address for that channel",
            extra={"appointmentId": appointment_id, "channel": channel},
        )
        if job.get("messageLogId"):
            log = messages().scheduled(
                tenant_id=tenant_id,
                notice=notice,
                recipient_person_id=str(person["personId"]),
                recipient="",
                appointment_id=appointment_id,
                message_log_id=log_id,
                at=log_at,
                reminder_id=reminder_id,
            )
            messages().failed(log, reason=f"no {channel.lower()} address at send time")
        return "no-address"

    # Logged before the provider is called, so a send that vanishes leaves a
    # record behind rather than nothing at all.
    log = messages().scheduled(
        tenant_id=tenant_id,
        notice=notice,
        recipient_person_id=str(person["personId"]),
        recipient=recipient,
        appointment_id=appointment_id,
        message_log_id=log_id,
        at=log_at,
        reminder_id=reminder_id,
    )
    try:
        provider_id = provider_send(notice, recipient)
    except Exception as exc:
        messages().failed(log, reason=f"{type(exc).__name__}: {exc}")
        if permanent(exc):
            logger.warning(
                "notice refused by the provider, not retried",
                extra={"appointmentId": appointment_id, "kind": kind, "channel": channel},
            )
            return "refused"
        raise

    messages().sent(log, provider_message_id=provider_id)
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


# ---------------------------------------------------------------- reminders
def schedule_reminder(job: dict[str, Any], *, queued_at: dt.datetime | None) -> str:
    """Arrange the reminder for a new booking, or confirm by SMS if it is too late.

    Every step is safe to repeat. The schedule's name is derived from the
    appointment, so a retry cannot create a second one, and the log row's
    identity comes from that name and from when this job was first queued.
    """
    tenant_id = str(job["tenantId"])
    appointment_id = str(job["appointmentId"])
    data = booking()
    appointment = data.appointment(tenant_id, appointment_id)
    if str(appointment.get("state")) not in reminders.REMINDABLE:
        logger.info(
            "no reminder, the appointment moved on", extra={"appointmentId": appointment_id}
        )
        return "skipped"

    start = parse_time(appointment["startAt"])
    if start is None:  # pragma: no cover  every appointment has a start
        return "skipped"
    zone = zone_for(tenant_id)
    decided = reminders.plan(start, now=data.now(), zone=zone)

    if decided.send_now:
        # FR-REM-06: too close for a reminder, so the confirmation goes by SMS
        # now instead of a reminder later.
        return send_notice(
            {**job, "kind": notices.BOOKING_CONFIRMATION, "channel": "SMS"},
            message_id=f"now-{appointment_id}",
            queued_at=queued_at,
        )

    name = reminders.schedule_name(appointment_id)
    logged_at = queued_at or data.now()
    log_id = f"ml-{name}"

    profile = data.patient_profile(tenant_id, str(appointment["patientProfileId"]))
    person, recipient = recipient_for(profile, "SMS")
    notice = compose_for(tenant_id, appointment, person, notices.APPOINTMENT_REMINDER, "SMS")
    messages().scheduled(
        tenant_id=tenant_id,
        notice=notice,
        recipient_person_id=str(person["personId"]),
        # The number is read again when the reminder fires; this one is only
        # what was on file when it was scheduled.
        recipient=recipient or "",
        appointment_id=appointment_id,
        message_log_id=log_id,
        at=logged_at,
        reminder_id=name,
    )

    body = {
        "kind": notices.APPOINTMENT_REMINDER,
        "channel": "SMS",
        "tenantId": tenant_id,
        "appointmentId": appointment_id,
        "reminderId": name,
        "messageLogId": log_id,
        "loggedAt": logged_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    target: dict[str, Any] = {
        "Arn": OUTBOX_QUEUE_ARN,
        "RoleArn": SCHEDULER_ROLE_ARN,
        "Input": json.dumps(body, separators=(",", ":")),
        "SqsParameters": {"MessageGroupId": appointment_id},
        "RetryPolicy": {
            "MaximumEventAgeInSeconds": int(REMINDER_MAX_AGE.total_seconds()),
            "MaximumRetryAttempts": 10,
        },
    }
    if REMINDER_FAILURES_ARN:
        target["DeadLetterConfig"] = {"Arn": REMINDER_FAILURES_ARN}
    try:
        scheduler().create_schedule(
            Name=name,
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=reminders.at_expression(decided.fire_at),
            ScheduleExpressionTimezone="UTC",
            FlexibleTimeWindow={"Mode": "OFF"},
            # A one-time schedule removes itself once it has fired.
            ActionAfterCompletion="DELETE",
            Target=target,
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConflictException":
            raise
        # Already created by an earlier attempt of this same job.

    # FR-REM-01: the reference is stored on the appointment. Setting the same
    # values again on a retry is harmless, and the state is untouched, so the
    # change stream sees nothing it owes a notice for.
    data.record_reminder(
        tenant_id,
        appointment_id,
        schedule=name,
        fire_at=decided.fire_at,
        message_log_id=log_id,
        logged_at=body["loggedAt"],
    )
    logger.info(
        "reminder scheduled",
        extra={"appointmentId": appointment_id, "fireAt": body["loggedAt"], "schedule": name},
    )
    return "scheduled"


def close_scheduled(log: Item, *, reason: str) -> None:
    """Mark a scheduled message CANCELLED, unless it has already gone.

    A reminder sent before the cancellation keeps its SENT row: the patient did
    receive it, and the log is a record of what happened, not of what now
    would.
    """
    if not log.get("sentAt") or not log.get("messageLogId"):
        return
    with contextlib.suppress(Conflict):
        messages().cancelled(log, reason=reason, expect=SCHEDULED)


def cancel_reminder(job: dict[str, Any]) -> str:
    """Remove a cancelled appointment's reminder, and log that it will not go.

    FR-VIS-04. A reminder that was never scheduled, because the booking came
    inside the lead time or has already fired, is not an error: there is
    simply nothing to remove.
    """
    tenant_id = str(job["tenantId"])
    appointment_id = str(job["appointmentId"])
    appointment = booking().appointment(tenant_id, appointment_id)
    name = str(appointment.get("reminderSchedule") or reminders.schedule_name(appointment_id))
    try:
        scheduler().delete_schedule(Name=name, GroupName=SCHEDULE_GROUP)
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ResourceNotFoundException":
            raise
    close_scheduled(
        {
            "tenantId": tenant_id,
            "sentAt": appointment.get("reminderLoggedAt"),
            "messageLogId": appointment.get("reminderLogId"),
        },
        reason="the appointment was cancelled before the reminder was due",
    )
    logger.info("reminder cancelled", extra={"appointmentId": appointment_id, "schedule": name})
    return "cancelled"


def deliver(
    job: dict[str, Any], *, message_id: str | None = None, queued_at: dt.datetime | None = None
) -> str:
    """Do what one outbox job asks.

    `message_id` and `queued_at` come from the queue and are the same on every
    redelivery of one message, which is what lets a retry land on the log row
    the first attempt wrote rather than adding another.
    """
    kind = str(job.get("kind"))
    if kind == reminders.SCHEDULE:
        return schedule_reminder(job, queued_at=queued_at)
    if kind == reminders.CANCEL:
        return cancel_reminder(job)
    return send_notice(job, message_id=message_id, queued_at=queued_at)


def queued_at(record: dict[str, Any]) -> dt.datetime | None:
    """When the queue first accepted this message, which redelivery keeps."""
    stamp = (record.get("attributes") or {}).get("SentTimestamp")
    if not stamp:
        return None
    return dt.datetime.fromtimestamp(int(stamp) / 1000, tz=dt.UTC)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Handle every job in the batch, reporting the ones that could not be done.

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
            logger.exception("could not handle an outbox job", extra={"messageId": identifier})
            failures.append({"itemIdentifier": identifier})
    return {"batchItemFailures": failures}
