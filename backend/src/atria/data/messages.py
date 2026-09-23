"""The message log: what was sent, to whom, and what the provider said.

Every outbound message gets a row, whatever happens to it (FR-MSG-03). A row is
written before the provider is called and updated after, so a send that
disappears leaves SCHEDULED behind rather than nothing at all: a message with
no record would be invisible, and invisible is worse than failed.

Phase 1 records SCHEDULED, SENT, FAILED and CANCELLED, the last for a reminder
whose appointment was cancelled first. DELIVERED and the bounce and complaint
handling that produces it need provider notifications, which is Phase 2.

The log is partitioned by day so a clinic's messages for a date are one query,
which is what the message console reads.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import notices
from atria.data import keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository

SCHEDULED = "SCHEDULED"
SENT = "SENT"
FAILED = "FAILED"
CANCELLED = "CANCELLED"

# DELIVERED is deliberately absent from what this module writes: it arrives
# from the provider, not from the act of sending.
STATES = (SCHEDULED, SENT, FAILED, CANCELLED, "DELIVERED")

# A provider error can be long and can quote the recipient back. Enough to
# diagnose, not enough to turn the log into a copy of the message.
MAX_REASON = 300


def log_item(
    *,
    message_log_id: str,
    tenant_id: str,
    notice: notices.Notice,
    recipient_person_id: str,
    recipient: str,
    appointment_id: str,
    sent_at: str,
    reminder_id: str | None = None,
) -> Item:
    """A message log row, before the provider has been called.

    The recipient address is recorded because the number or address a notice
    went to is the question asked after a patient says they heard nothing, and
    a person's contact details change.
    """
    return {
        "type": "MESSAGE_LOG",
        "messageLogId": message_log_id,
        "tenantId": tenant_id,
        "recipientPersonId": recipient_person_id,
        "recipient": recipient,
        "appointmentId": appointment_id,
        "reminderId": reminder_id,
        "kind": notice.kind,
        "channel": notice.channel,
        "template": notice.template,
        "language": notice.language,
        "subject": notice.subject,
        "deliveryState": SCHEDULED,
        "sentAt": sent_at,
    }


class Messages:
    """Writes and reads of the message log."""

    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    def now(self) -> dt.datetime:
        return self._clock()

    def scheduled(
        self,
        *,
        tenant_id: str,
        notice: notices.Notice,
        recipient_person_id: str,
        recipient: str,
        appointment_id: str,
        message_log_id: str | None = None,
        at: dt.datetime | None = None,
        reminder_id: str | None = None,
    ) -> Item:
        """Record the intention to send, before anything is sent.

        One row per message, not per attempt. A caller that retries passes the
        same identifier and the same time on every attempt, so the row is
        overwritten back to SCHEDULED and then settles on the final outcome.
        Writing a new row per attempt would leave a FAILED row beside the SENT
        one for a message the patient actually received, and anyone reading
        the log would chase a failure that never reached a patient.
        """
        at = at or self.now()
        sent_at = at.strftime("%Y-%m-%dT%H:%M:%SZ")
        message_log_id = message_log_id or new_id("ml")
        item = log_item(
            message_log_id=message_log_id,
            tenant_id=tenant_id,
            notice=notice,
            recipient_person_id=recipient_person_id,
            recipient=recipient,
            appointment_id=appointment_id,
            sent_at=sent_at,
            reminder_id=reminder_id,
        )
        return self._repo.put(
            keys.message_log(tenant_id, at.strftime("%Y-%m-%d"), sent_at, message_log_id),
            item,
        )

    def sent(self, log: Item, *, provider_message_id: str) -> Item:
        """The provider accepted it."""
        return self._repo.update_existing(
            self._key_of(log),
            set_values={
                "deliveryState": SENT,
                "providerMessageId": provider_message_id,
                "settledAt": self._stamp(),
            },
            what="message log entry",
        )

    def failed(self, log: Item, *, reason: str) -> Item:
        """The provider refused it, or could not be reached."""
        return self._repo.update_existing(
            self._key_of(log),
            set_values={
                "deliveryState": FAILED,
                "failureReason": reason[:MAX_REASON],
                "settledAt": self._stamp(),
            },
            what="message log entry",
        )

    def cancelled(self, log: Item, *, reason: str, expect: str | None = None) -> Item:
        """A scheduled message that will now never be sent.

        FR-MSG-03 lists CANCELLED as a state, and it is how a reminder for an
        appointment cancelled before its time leaves a trace: the skip is in
        the log rather than simply absent from it. `expect` makes it apply only
        to a row still in that state, so a reminder that already went out keeps
        its SENT row; a mismatch raises Conflict.
        """
        return self._repo.update_existing(
            self._key_of(log),
            set_values={
                "deliveryState": CANCELLED,
                "cancelledReason": reason[:MAX_REASON],
                "settledAt": self._stamp(),
            },
            what="message log entry",
            expect=("deliveryState", expect) if expect is not None else None,
        )

    def for_day(self, tenant_id: str, day: str) -> list[Item]:
        """Every message logged for one day, earliest first."""
        return self._repo.query_partition(f"{keys.TENANT}{tenant_id}#MSG#{day}")

    def _stamp(self) -> str:
        """When an outcome was reached. sentAt is when the message was queued
        and is part of the key, so it cannot also record when it went."""
        return self.now().strftime("%Y-%m-%dT%H:%M:%SZ")

    def _key_of(self, log: Item) -> keys.Key:
        return keys.message_log(
            str(log["tenantId"]),
            str(log["sentAt"])[:10],
            str(log["sentAt"]),
            str(log["messageLogId"]),
        )
