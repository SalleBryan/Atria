"""The message log: what was sent, to whom, and what the provider said.

Every outbound message gets a row, whatever happens to it (FR-MSG-03). A row is
written before the provider is called and updated after, so a send that
disappears leaves SCHEDULED behind rather than nothing at all: a message with
no record would be invisible, and invisible is worse than failed.

Phase 1 records SCHEDULED, SENT and FAILED. DELIVERED and the bounce and
complaint handling that produces it need SES notifications, which is Phase 2.

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
        "reminderId": None,
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
        )
        return self._repo.put(
            keys.message_log(tenant_id, at.strftime("%Y-%m-%d"), sent_at, message_log_id),
            item,
        )

    def sent(self, log: Item, *, provider_message_id: str) -> Item:
        """The provider accepted it."""
        return self._repo.update_existing(
            self._key_of(log),
            set_values={"deliveryState": SENT, "providerMessageId": provider_message_id},
            what="message log entry",
        )

    def failed(self, log: Item, *, reason: str) -> Item:
        """The provider refused it, or could not be reached."""
        return self._repo.update_existing(
            self._key_of(log),
            set_values={"deliveryState": FAILED, "failureReason": reason[:MAX_REASON]},
            what="message log entry",
        )

    def for_day(self, tenant_id: str, day: str) -> list[Item]:
        """Every message logged for one day, earliest first."""
        return self._repo.query_partition(f"{keys.TENANT}{tenant_id}#MSG#{day}")

    def _key_of(self, log: Item) -> keys.Key:
        return keys.message_log(
            str(log["tenantId"]),
            str(log["sentAt"])[:10],
            str(log["sentAt"]),
            str(log["messageLogId"]),
        )
