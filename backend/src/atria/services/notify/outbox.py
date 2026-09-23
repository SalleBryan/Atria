"""Change capture into the FIFO outbox.

The table's stream is the only trustworthy source of what actually happened: a
booking that committed cannot then fail to notify, which is exactly what would
occur if the API enqueued the notice itself and then died. This reads the
stream and puts one message on the outbox queue per state a patient should
hear about.

The queue is FIFO and grouped by appointment, so a booking and its cancellation
cannot be composed out of order. Ordering across different appointments does
not matter and grouping by appointment is what keeps one busy record from
holding up everybody else's.

Nothing is composed here. This decides only that something happened and which
notice it owes (FR-MSG-01, FR-MSG-02).

One deliberate simplification against the Technical Document, which sketches a
second queue with a notification service composing between the two. The sender
has to re-read the appointment and the patient's current contact details at
send time regardless (FR-REM-02, FR-REM-03), so composing earlier would mean
composing twice and acting on the earlier of two answers. Composition lives in
the sender, and this queue is the durable hand-off the outbox was there to
provide. The scheduled reminder path will put the same shape of job on the same
queue.
"""

from __future__ import annotations

import json
import os
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import notices, reminders

logger = Logger(service="atria-outbox")

OUTBOX_QUEUE_URL = os.environ.get("OUTBOX_QUEUE_URL", "")

APPOINTMENT = "APPOINTMENT"

_sqs: Any = None


def sqs() -> Any:
    global _sqs
    if _sqs is None:
        _sqs = boto3.client("sqs")
    return _sqs


def plain(image: dict[str, Any] | None) -> dict[str, Any]:
    """A stream image as ordinary values.

    Stream records arrive in DynamoDB's own wire form, where every value is
    wrapped in a type tag. Only the few fields this module reads are unwrapped,
    because a general deserialiser here would be a second implementation of
    something boto3 already does on the read path.
    """
    flat: dict[str, Any] = {}
    for name, tagged in (image or {}).items():
        if not isinstance(tagged, dict):  # pragma: no cover  defensive
            continue
        for tag, value in tagged.items():
            if tag in ("S", "N"):
                flat[name] = str(value)
            elif tag == "NULL":
                flat[name] = None
            break
    return flat


# What arrival in a state arranges for the reminder, alongside any email.
REMINDER_JOB_FOR_STATE = {
    "BOOKED": reminders.SCHEDULE,
    "PATIENT_CANCELLED": reminders.CANCEL,
    "CLINIC_CANCELLED": reminders.CANCEL,
}


def jobs_due(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Every job this one stream record owes, in the order they should run.

    A booking owes a confirmation and a reminder to be scheduled; a
    cancellation owes a notice and the reminder's removal (FR-VIS-04). Both
    travel in the appointment's own FIFO group, so a reminder can never be
    scheduled after the cancellation that should have removed it.
    """
    change = record.get("dynamodb") or {}
    new = plain(change.get("NewImage"))
    if new.get("type") != APPOINTMENT:
        return []

    old = plain(change.get("OldImage"))
    to_state = str(new.get("state") or "")
    from_state = old.get("state")
    if from_state == to_state:
        # A rewrite in the same state owes nothing, or a retried write would
        # send a second confirmation and schedule a second reminder.
        return []

    base = {
        "tenantId": new.get("tenantId"),
        "appointmentId": new.get("appointmentId"),
        "fromState": from_state,
        "toState": to_state,
    }
    jobs: list[dict[str, Any]] = []
    kind = notices.kind_for(from_state, to_state)
    if kind is not None:
        jobs.append({**base, "kind": kind, "channel": "EMAIL"})
    reminder_job = REMINDER_JOB_FOR_STATE.get(to_state)
    if reminder_job is not None:
        jobs.append({**base, "kind": reminder_job, "channel": "SMS"})
    return jobs


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Put a message on the outbox for every change a patient should hear about.

    Returns the partial batch response, so one record that cannot be handled is
    retried and eventually parked on its own rather than dragging the whole
    batch back through the stream (ADR 0014).
    """
    failures: list[dict[str, str]] = []
    sent = 0
    for record in event.get("Records", []):
        try:
            for job in jobs_due(record):
                sqs().send_message(
                    QueueUrl=OUTBOX_QUEUE_URL,
                    MessageBody=json.dumps(job, separators=(",", ":")),
                    # One group per appointment: its own events stay in order,
                    # and a slow one does not block another patient's.
                    MessageGroupId=str(job["appointmentId"]),
                    # The stream record identifier, so a stream retry of a
                    # record already accepted is deduplicated by the queue.
                    # Suffixed with the job kind, because one record yields
                    # two jobs and a shared identifier would have the queue
                    # quietly drop the second.
                    MessageDeduplicationId=f"{record.get('eventID')}:{job['kind']}",
                )
                sent += 1
        except Exception:
            logger.exception(
                "could not put a change on the outbox",
                extra={"eventID": record.get("eventID")},
            )
            failures.append({"itemIdentifier": str(record.get("eventID"))})

    logger.info("outbox dispatched", extra={"sent": sent, "failed": len(failures)})
    return {"batchItemFailures": failures}
