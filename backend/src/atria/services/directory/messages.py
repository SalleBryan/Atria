"""The message log and the delivery figures (FR-MSG-05, FR-MSG-06).

    GET /clinics/{id}/messages?day=     what went out for one unit on one day
    GET /messages/delivery?days=        the administrator's delivery figures

A unit's log lists what went out on a day, on the tenant's clock, with the
failures first, so the desk can phone those patients: each row names the
patient and the number on file now. A unit manager or the desk reads their
unit's; an administrator any unit's.

The figures are the administrator's: the sender identities and whether the
account can reach anyone beyond verified addresses, then per day the emails
attempted, delivered, bounced and complained about, and the SMS attempted,
delivered and what they cost, as SNS reported it. A rate is left out where
nothing was attempted rather than shown as zero.

Both read only what the message log recorded, and both are counts or the
log itself, so neither is an audit entry.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import permissions, schedule
from atria.core.errors import Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.booking import Booking
from atria.data.messages import BOUNCE, COMPLAINT, DELIVERED, FAILED, SENT, Messages
from atria.data.repository import Item
from atria.http import requests

logger = Logger(service="atria-messages")

ATTEMPTED = (SENT, DELIVERED, FAILED)
MAX_DAYS = 31

_ses: Any = None
_sns: Any = None


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


def local_day(stamp: str, zone: Any) -> str:
    moment = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    return moment.astimezone(zone).date().isoformat()


def rows_between(
    data: Booking, tenant_id: str, first: dt.date, last: dt.date, *, clinic_id: str | None = None
) -> dict[str, list[Item]]:
    """Every settled row whose local day is in [first, last], by that day.

    The index files a row under the UTC day it settled, so the UTC days either
    side are read too and each row placed on the tenant's own calendar."""
    zone = data.zone(tenant_id)
    log = Messages(data.repository)
    by_day: dict[str, list[Item]] = {}
    day = first - dt.timedelta(days=1)
    while day <= last + dt.timedelta(days=1):
        for row in log.went_out(tenant_id, day.isoformat(), clinic_id=clinic_id):
            local = local_day(str(row["settledAt"]), zone)
            if first.isoformat() <= local <= last.isoformat():
                by_day.setdefault(local, []).append(row)
        day += dt.timedelta(days=1)
    return by_day


def today(data: Booking, tenant_id: str) -> dt.date:
    return data.now().astimezone(data.zone(tenant_id)).date()


# ------------------------------------------------------------ the unit's log
def unit_log(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    clinic = data.clinic(principal.tenant_id, clinic_id)
    permissions.require(
        principal, "message.read", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    raw = requests.query_parameter(event, "day")
    day = schedule.parse_date(raw, name="day") if raw else today(data, principal.tenant_id)
    rows = rows_between(data, principal.tenant_id, day, day, clinic_id=clinic_id).get(
        day.isoformat(), []
    )

    people = _by_key(data, [keys.person(str(r["recipientPersonId"])) for r in rows])
    visits = _by_key(
        data, [keys.appointment(principal.tenant_id, str(r["appointmentId"])) for r in rows]
    )
    listed = [_row(r, people, visits, principal.tenant_id) for r in rows]
    # Failures first, then the rest; the latest first within each.
    listed.sort(key=lambda r: str(r["settledAt"]), reverse=True)
    listed.sort(key=lambda r: r["deliveryState"] != FAILED)
    counts: dict[str, int] = {}
    for r in listed:
        counts[str(r["deliveryState"])] = counts.get(str(r["deliveryState"]), 0) + 1
    return {
        "clinicId": clinic_id,
        "clinicName": clinic.get("name"),
        "day": day.isoformat(),
        "counts": counts,
        "messages": listed,
    }


def _by_key(data: Booking, wanted: Iterable[keys.Key]) -> dict[str, Item]:
    unique = list({(k.pk, k.sk): k for k in wanted}.values())
    found = data.repository.get_many(unique) if unique else {}
    return {pk: item for (pk, _sk), item in found.items()}


def _row(row: Item, people: dict[str, Item], visits: dict[str, Item], tenant_id: str) -> Item:
    person = people.get(keys.person(str(row["recipientPersonId"])).pk, {})
    visit = visits.get(keys.appointment(tenant_id, str(row["appointmentId"])).pk, {})
    name = " ".join(str(person.get(n) or "") for n in ("givenName", "familyName")).strip()
    return {
        "messageLogId": row["messageLogId"],
        "appointmentId": row["appointmentId"],
        "kind": row.get("kind"),
        "channel": row.get("channel"),
        "recipient": row.get("recipient") or None,
        "deliveryState": row.get("deliveryState"),
        "feedback": row.get("feedback"),
        "failureReason": row.get("failureReason") or row.get("cancelledReason"),
        "settledAt": row.get("settledAt"),
        "reportedAt": row.get("reportedAt"),
        # The number on file now, which is the one to phone.
        "person": {"name": name or None, "phoneE164": person.get("phoneE164")},
        "visit": {
            "startAt": visit.get("startAt"),
            "state": visit.get("state"),
            "patientProfileId": visit.get("patientProfileId"),
        }
        if visit
        else None,
    }


# ------------------------------------------------------- delivery figures
def delivery(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    scope = permissions.require(principal, "message.read", Subject(tenant_id=principal.tenant_id))
    if scope != "tenant":
        raise Invalid("the delivery figures are the administrator's")
    raw = requests.query_parameter(event, "days")
    try:
        days = int(raw) if raw else 14
    except ValueError as exc:
        raise Invalid("days must be a whole number") from exc
    if not 1 <= days <= MAX_DAYS:
        raise Invalid(f"days must be between 1 and {MAX_DAYS}")

    last = today(data, principal.tenant_id)
    first = last - dt.timedelta(days=days - 1)
    by_day = rows_between(data, principal.tenant_id, first, last)
    per_day = [
        {"day": (first + dt.timedelta(days=n)).isoformat()}
        | figures(by_day.get((first + dt.timedelta(days=n)).isoformat(), []))
        for n in range(days)
    ]
    return {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "senders": senders(),
        "sms": sms_account(),
        "totals": figures([r for rows in by_day.values() for r in rows]),
        "days": per_day,
    }


def rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def figures(rows: list[Item]) -> dict[str, Any]:
    emails = [
        r for r in rows if r.get("channel") == "EMAIL" and r.get("deliveryState") in ATTEMPTED
    ]
    texts = [r for r in rows if r.get("channel") == "SMS" and r.get("deliveryState") in ATTEMPTED]
    delivered = sum(r.get("deliveryState") == DELIVERED for r in emails)
    bounced = sum(r.get("feedback") == BOUNCE for r in emails)
    complained = sum(r.get("feedback") == COMPLAINT for r in emails)
    texts_delivered = sum(r.get("deliveryState") == DELIVERED for r in texts)
    spend = sum(
        (Decimal(str(r["priceUsd"])) for r in texts if r.get("priceUsd") is not None), Decimal(0)
    )
    return {
        "email": {
            "attempted": len(emails),
            "delivered": delivered,
            "failed": sum(r.get("deliveryState") == FAILED for r in emails),
            "bounced": bounced,
            "complained": complained,
            "deliveryRate": rate(delivered, len(emails)),
            "bounceRate": rate(bounced, len(emails)),
            "complaintRate": rate(complained, len(emails)),
        },
        "sms": {
            "attempted": len(texts),
            "delivered": texts_delivered,
            "failed": sum(r.get("deliveryState") == FAILED for r in texts),
            "deliveryRate": rate(texts_delivered, len(texts)),
            # Rounded to the hundredth of a cent, which is finer than SNS prices.
            "spendUsd": str(spend.quantize(Decimal("0.0001"))),
        },
    }


def senders() -> list[dict[str, Any]] | None:
    """The account's email identities, or None if SES could not be asked."""
    try:
        listed = ses().list_email_identities(PageSize=100).get("EmailIdentities", [])
        account = ses().get_account()
    except Exception:
        logger.exception("could not read the sender identities")
        return None
    production = bool(account.get("ProductionAccessEnabled"))
    return [
        {
            "identity": i.get("IdentityName"),
            "type": i.get("IdentityType"),
            "verified": i.get("VerificationStatus") == "SUCCESS",
            "sendingEnabled": bool(i.get("SendingEnabled")),
            # In the sandbox an identity reaches only verified addresses.
            "sandbox": not production,
        }
        for i in listed
    ]


def sms_account() -> dict[str, Any] | None:
    try:
        status = sns().get_sms_sandbox_account_status()
    except Exception:
        logger.exception("could not read the SMS account")
        return None
    return {"sandbox": bool(status.get("IsInSandbox"))}
