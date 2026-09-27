"""What became of a message after the provider accepted it (FR-MSG-04).

Two sources, one handler. SES reports each email's delivery, bounce,
complaint or rejection through the notices' configuration set, which sends
its events to EventBridge. SNS writes a delivery log line for each SMS to
CloudWatch Logs, and a subscription filter hands those lines here.

Both name only the provider's message identifier; the sender left a pointer
from it to the log row when the provider accepted the message. A report that
arrives before that pointer exists is raised, so the invocation is retried a
moment later; one about a message Atria has no row for is ignored.
"""

from __future__ import annotations

import base64
import datetime as dt
import gzip
import json
from typing import Any

from aws_lambda_powertools import Logger

from atria.data.messages import BOUNCE, COMPLAINT, Messages
from atria.data.repository import Repository

logger = Logger(service="atria-delivery-status")

# A report this recent may simply have beaten the sender's own write.
RACE_WINDOW = dt.timedelta(minutes=10)

_messages: Messages | None = None


def messages() -> Messages:
    global _messages
    if _messages is None:
        _messages = Messages(Repository())
    return _messages


class NotYetKnownError(Exception):
    """The report arrived before the sender recorded the message it is about."""


def stamp(value: object) -> str | None:
    """A provider time as the log writes times, to the second in UTC."""
    if value in (None, ""):
        return None
    if isinstance(value, int | float):
        moment = dt.datetime.fromtimestamp(float(value) / 1000, tz=dt.UTC)
    else:
        moment = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if moment.tzinfo is None:
            # SNS writes "2026-09-27 08:00:00.123", which is UTC.
            moment = moment.replace(tzinfo=dt.UTC)
    return moment.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def email_outcome(detail: dict[str, Any]) -> dict[str, Any] | None:
    """An SES event as what it means for the log, or None for one that says nothing final."""
    kind = str(detail.get("eventType") or detail.get("notificationType") or "")
    if kind == "Delivery":
        return {"delivered": True, "at": stamp((detail.get("delivery") or {}).get("timestamp"))}
    if kind == "Bounce":
        bounce = detail.get("bounce") or {}
        recipients = bounce.get("bouncedRecipients") or [{}]
        reason = recipients[0].get("diagnosticCode") or f"{bounce.get('bounceType', '')} bounce"
        return {
            "delivered": False,
            "feedback": BOUNCE,
            "reason": str(reason),
            "at": stamp(bounce.get("timestamp")),
        }
    if kind == "Complaint":
        return {
            "delivered": True,
            "feedback": COMPLAINT,
            "at": stamp((detail.get("complaint") or {}).get("timestamp")),
        }
    if kind == "Reject":
        reason = (detail.get("reject") or {}).get("reason") or "rejected"
        return {"delivered": False, "reason": f"rejected by SES: {reason}"}
    if kind == "Rendering Failure":
        return {"delivered": False, "reason": "the email could not be rendered"}
    # Send, DeliveryDelay, Open, Click: nothing final.
    return None


def sms_outcome(line: dict[str, Any]) -> dict[str, Any]:
    """One SNS delivery log line as what it means for the log."""
    delivery = line.get("delivery") or {}
    price = delivery.get("priceInUSD")
    ok = str(line.get("status") or "").upper() == "SUCCESS"
    return {
        "delivered": ok,
        "reason": None if ok else str(delivery.get("providerResponse") or "not delivered"),
        "price_usd": None if price is None else str(price),
        "at": stamp((line.get("notification") or {}).get("timestamp")),
    }


def record(provider_message_id: str, outcome: dict[str, Any], *, sent: str | None) -> str:
    row = messages().reported(provider_message_id, **outcome)
    if row is not None:
        return "recorded"
    if sent:
        age = messages().now() - dt.datetime.fromisoformat(sent.replace("Z", "+00:00"))
        if age < RACE_WINDOW:
            raise NotYetKnownError(provider_message_id)
    logger.info("a report about no message Atria logged", extra={"id": provider_message_id})
    return "unknown"


def from_ses(event: dict[str, Any]) -> list[str]:
    detail = event.get("detail") or {}
    mail = detail.get("mail") or {}
    outcome = email_outcome(detail)
    if outcome is None or not mail.get("messageId"):
        return ["ignored"]
    return [record(str(mail["messageId"]), outcome, sent=stamp(mail.get("timestamp")))]


def from_sms_logs(event: dict[str, Any]) -> list[str]:
    payload = json.loads(gzip.decompress(base64.b64decode(event["awslogs"]["data"])))
    done: list[str] = []
    for entry in payload.get("logEvents") or []:
        line = json.loads(str(entry.get("message") or "{}"))
        notification = line.get("notification") or {}
        if not notification.get("messageId"):
            continue
        done.append(
            record(
                str(notification["messageId"]),
                sms_outcome(line),
                sent=stamp(notification.get("timestamp")),
            )
        )
    return done


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """An SES event from EventBridge, or a batch of SNS delivery log lines."""
    done = from_sms_logs(event) if "awslogs" in event else from_ses(event)
    logger.info("delivery reports", extra={"outcomes": done})
    return {"outcomes": done}
