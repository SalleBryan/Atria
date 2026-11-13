"""Pay one appointment's fee by mobile money through Fapshi, and see whether it was paid.

    POST /appointments/{id}/payment  {"attemptId": "<uuid4>", "phone": "6XXXXXXXX"}
    GET  /appointments/{id}/payment  the latest attempt, its status refreshed

The patient (or the desk, for them) gives the number to pay from; Fapshi sends a
payment prompt to that phone (direct pay) and the payer approves it there. The
amount is never the caller's: it is the fee band in force on the local day of the
visit (services/booking/fees.py), so a consultation priced at 1,500 XAF is charged
1,500 XAF, exactly what the booking page, the desk and the reminder say. A visit
with no fee band, or a free one, has nothing to pay; a cancelled visit cannot be
paid; a prompt still waiting on a phone is not sent twice.

Whoever may read the appointment may start a payment or see its status: the
patient, or the unit's staff at the desk, who confirm the amount was paid. This
reads the appointment and its fee from the main table and never writes it or the
fee ledger; attempts live in the payments table of their own (ADR 0023).
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

from atria.core import permissions
from atria.core.errors import Conflict, Invalid, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.booking import Booking
from atria.data.keys import Key
from atria.data.repository import Item, Repository
from atria.http import requests, responses
from atria.services.booking.fees import FeeLookup
from atria.services.payment_sandbox.fapshi import (
    Credentials,
    Fapshi,
    ProviderError,
    masked,
    mobile_number,
)
from atria.services.payment_sandbox.handler import _payment_key, _save, _status

PAID = "SUCCESSFUL"
# An attempt still in these states may yet be paid: a new one would prompt twice.
WAITING = ("INITIATING", "CREATED", "PENDING", "INITIATION_UNKNOWN")
# Fapshi's smallest collection.
MINIMUM = 100


def _start(
    repo: Repository, key: Key, amount: int, phone: str, fields: Item, message: str
) -> tuple[Item, bool]:
    """Record the attempt, then send ONE prompt; only the conditional insert's winner sends."""
    existing = repo.get(key, consistent=True)
    if existing is not None:
        return existing, False
    provider = Fapshi(Credentials.load())
    try:
        current = repo.put_new(
            key, {"status": "INITIATING", "version": 1, "amount": amount, **fields}, what="payment"
        )
    except Conflict:
        return repo.require(key, what="payment", consistent=True), False
    try:
        trans_id = provider.direct_pay(key.pk, amount, phone, message)
    except ProviderError as exc:
        rejected = exc.provider_status in (400, 401, 403, 429)
        _save(
            repo,
            key,
            current,
            {"status": "INITIATION_REJECTED" if rejected else "INITIATION_UNKNOWN"},
        )
        raise
    return _save(repo, key, current, {"status": "PENDING", "transId": trans_id}), True


def _latest_key(tenant_id: str, appointment_id: str) -> Key:
    return Key(f"APPOINTMENT#{tenant_id}#{appointment_id}", "PAYMENT_LATEST")


def _uuid4(value: object) -> str:
    try:
        parsed = UUID(str(value))
    except ValueError:
        raise Invalid("use a new UUIDv4 attemptId for each checkout") from None
    if parsed.version != 4 or str(parsed) != value:
        raise Invalid("use a new UUIDv4 attemptId for each checkout")
    return str(value)


def _appointment(main: Repository, principal: Principal, appointment_id: str) -> Item:
    appointment = main.get(keys.appointment(principal.tenant_id, appointment_id))
    if appointment is None:
        raise NotFound("no such appointment")
    subject = Subject(
        tenant_id=str(appointment.get("tenantId", "")),
        patient_profile_id=appointment.get("patientProfileId"),
        clinician_profile_id=appointment.get("clinicianProfileId"),
        clinic_id=appointment.get("clinicId"),
    )
    caller = permissions.effective_principal(principal, subject)
    permissions.require(caller, "appointment.read", subject)
    return appointment


def _fee(main: Repository, tenant_id: str, appointment: Item) -> tuple[int, str] | None:
    zone = Booking(main).zone(tenant_id)
    start = dt.datetime.fromisoformat(str(appointment["startAt"]).replace("Z", "+00:00"))
    day = start.astimezone(zone).date().isoformat()
    found = FeeLookup(main, tenant_id, day).for_type(appointment.get("appointmentTypeId"))
    if not found:
        return None
    return int(found["amountMinor"]), str(found["currency"])


def _view(appointment_id: str, row: Item | None, fee: tuple[int, str] | None) -> dict[str, Any]:
    if row is None:
        return {
            "appointmentId": appointment_id,
            "status": "NONE",
            "paid": False,
            "amount": fee[0] if fee else None,
            "currency": fee[1] if fee else None,
        }
    view: dict[str, Any] = {
        "appointmentId": appointment_id,
        "attemptId": row.get("attemptId"),
        "status": row["status"],
        "paid": row["status"] == PAID,
        "amount": int(row["amount"]),
        "currency": row.get("currency", "XAF"),
    }
    for field in ("transId", "payerPhone", "startedAt"):
        if field in row:
            view[field] = row[field]
    return view


def route(event: dict[str, Any], repo: Repository, principal: Principal) -> dict[str, Any]:
    """The appointment payment routes on the payments function."""
    main = Repository()
    appointment_id = requests.path_parameter(event, "id")
    appointment = _appointment(main, principal, appointment_id)
    fee = _fee(main, principal.tenant_id, appointment)
    latest_key = _latest_key(principal.tenant_id, appointment_id)
    latest = repo.get(latest_key, consistent=True)

    if str(event.get("httpMethod")).upper() == "GET":
        if latest is None:
            return responses.ok(_view(appointment_id, None, fee))
        row = _status(repo, Key(str(latest["reference"]), "PAYMENT"))
        return responses.ok(_view(appointment_id, row, fee))

    body = requests.json_body(event)
    attempt_id = _uuid4(body.get("attemptId"))
    # The amount is the visit's fee, whatever the request says.
    phone = mobile_number(body.get("phone"))
    if str(appointment.get("state", "")).endswith("CANCELLED"):
        raise Conflict("a cancelled visit cannot be paid")
    if fee is None or fee[0] <= 0:
        raise Conflict("this visit has no fee to pay")
    if fee[0] < MINIMUM:
        raise Conflict(f"a fee under {MINIMUM} {fee[1]} cannot be paid by mobile money")
    if latest is not None:
        previous_key = Key(str(latest["reference"]), "PAYMENT")
        previous = repo.get(previous_key, consistent=True)
        if previous is not None and previous["status"] in WAITING:
            previous = _status(repo, previous_key)
        if previous is not None and previous["status"] == PAID:
            raise Conflict("this visit is already paid")
        if (
            previous is not None
            and previous["status"] in WAITING
            and previous.get("attemptId") != attempt_id
        ):
            raise Conflict("a payment prompt is already waiting on the phone")
    key = _payment_key(principal.tenant_id, attempt_id)
    row, created = _start(
        repo,
        key,
        fee[0],
        phone,
        {
            "attemptId": attempt_id,
            "appointmentId": appointment_id,
            "currency": fee[1],
            "payerPhone": masked(phone),
            "startedAt": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        f"Atria visit {appointment.get('reference') or appointment_id}",
    )
    repo.put(latest_key, {"reference": key.pk, "attemptId": attempt_id})
    return responses.response(201 if created else 200, _view(appointment_id, row, fee))
