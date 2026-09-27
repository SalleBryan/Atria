"""The message log: what was sent, to whom, and what the provider said.

Every outbound message gets a row, whatever happens to it (FR-MSG-03). A row is
written before the provider is called and updated after, so a send that
disappears leaves SCHEDULED behind rather than nothing at all: a message with
no record would be invisible, and invisible is worse than failed.

The sender records SCHEDULED, SENT, FAILED and CANCELLED, the last for a
reminder whose appointment was cancelled first. What happened after the
provider accepted a message arrives later, from SES events and SNS delivery
logs (FR-MSG-04): DELIVERED, or FAILED for a bounce, and a complaint is kept
beside the DELIVERED it follows. Each row names its unit, so a unit's log is
one day's partition filtered (FR-MSG-05).

The log is partitioned by day so a clinic's messages for a date are one query,
which is what the message console reads.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

from atria.core import notices
from atria.data import keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository

SCHEDULED = "SCHEDULED"
SENT = "SENT"
FAILED = "FAILED"
CANCELLED = "CANCELLED"

DELIVERED = "DELIVERED"
STATES = (SCHEDULED, SENT, FAILED, CANCELLED, DELIVERED)

# What a provider can say after accepting a message.
BOUNCE = "BOUNCE"
COMPLAINT = "COMPLAINT"

# How long a provider's identifier leads back to its row.
POINTER_LIFE = dt.timedelta(days=30)

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
    clinic_id: str | None = None,
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
        "clinicId": clinic_id,
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
        clinic_id: str | None = None,
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
            clinic_id=clinic_id,
        )
        return self._repo.put(
            keys.message_log(tenant_id, at.strftime("%Y-%m-%d"), sent_at, message_log_id),
            item,
        )

    def sent(self, log: Item, *, provider_message_id: str) -> Item:
        """The provider accepted it, and its identifier now leads back here."""
        if provider_message_id:
            self._repo.put(
                keys.provider_message(provider_message_id),
                {
                    "type": "PROVIDER_MESSAGE",
                    "tenantId": log["tenantId"],
                    "sentAt": log["sentAt"],
                    "messageLogId": log["messageLogId"],
                    # A provider reports within days; the pointer is not kept longer.
                    "expiresAt": int((self.now() + POINTER_LIFE).timestamp()),
                },
            )
        return self._repo.update_existing(
            self._key_of(log),
            set_values={
                "deliveryState": SENT,
                "providerMessageId": provider_message_id,
                **self._settled(log),
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
                **self._settled(log),
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
                **self._settled(log),
            },
            what="message log entry",
            expect=("deliveryState", expect) if expect is not None else None,
        )

    def reported(
        self,
        provider_message_id: str,
        *,
        delivered: bool,
        feedback: str | None = None,
        reason: str | None = None,
        price_usd: str | None = None,
        at: str | None = None,
    ) -> Item | None:
        """What the provider said after accepting a message (FR-MSG-04).

        None when the identifier leads nowhere, which is a message Atria did
        not send or one sent before identifiers were kept. A report never
        moves a row back to SENT or out of CANCELLED, and a complaint, which
        follows a delivery, keeps the row DELIVERED and says so beside it."""
        pointer = self._repo.get(keys.provider_message(provider_message_id))
        if pointer is None:
            return None
        key = self._key_of(pointer)
        row = self._repo.get(key)
        if row is None or row.get("deliveryState") not in (SENT, DELIVERED, FAILED):
            return row
        values: dict[str, Any] = {"reportedAt": at or self._stamp()}
        if feedback == COMPLAINT:
            values["feedback"] = COMPLAINT
        else:
            values["deliveryState"] = DELIVERED if delivered else FAILED
            if feedback:
                values["feedback"] = feedback
            if reason:
                values["failureReason"] = reason[:MAX_REASON]
        if price_usd is not None:
            # Kept exact: a day's SMS spend is a sum of fractions of a cent.
            values["priceUsd"] = Decimal(price_usd)
        return self._repo.update_existing(key, set_values=values, what="message log entry")

    def for_day(self, tenant_id: str, day: str) -> list[Item]:
        """Every message logged for one day, earliest first."""
        return self._repo.query_partition(f"{keys.TENANT}{tenant_id}#MSG#{day}")

    def went_out(self, tenant_id: str, day: str, *, clinic_id: str | None = None) -> list[Item]:
        """Every message that settled on one day (UTC), a unit's alone if named."""
        rows = self._repo.query_index(
            "MessageDayIndex", "messageDay", f"{keys.TENANT}{tenant_id}#MSGDAY#{day}"
        )
        if clinic_id is None:
            return rows
        return [r for r in rows if str(r.get("messageSort", "")).startswith(f"{clinic_id}#")]

    def _settled(self, log: Item) -> Item:
        """When an outcome was reached, and the day's index entry that files it."""
        at = self._stamp()
        clinic_id = log.get("clinicId")
        if clinic_id is None and "appointmentId" not in log:
            # A caller holding only the row's key: read the unit from the row.
            clinic_id = (self._repo.get(self._key_of(log)) or {}).get("clinicId")
        return {
            "settledAt": at,
            "messageDay": f"{keys.TENANT}{log['tenantId']}#MSGDAY#{at[:10]}",
            "messageSort": f"{clinic_id or '-'}#{at}#{log['messageLogId']}",
        }

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
