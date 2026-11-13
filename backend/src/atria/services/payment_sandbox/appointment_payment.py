"""Pay one appointment's fee in the Fapshi sandbox, and see whether it was paid.

    POST /appointments/{id}/payment  {"attemptId": "<uuid4>"}: a checkout for the fee
    GET  /appointments/{id}/payment  the latest attempt, its status refreshed

Sandbox only: Fapshi's sandbox host, synthetic money, test numbers. The amount is
the fee band in force on the local day of the visit (services/booking/fees.py), so
the patient pays exactly what the booking page, the desk and the reminder say. A
visit with no fee band, or a free one, has nothing to pay. A cancelled visit cannot
be paid.

Whoever may read the appointment may start a checkout or see its status: the
patient, or the unit's staff at the desk, who confirm the amount was paid. This
reads the appointment and its fee from the main table and never writes it or the
fee ledger; attempts live in the sandbox's own table (ADR 0007, 0030).
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
from atria.services.payment_sandbox.handler import _create, _payment_key, _status

PAID = "SUCCESSFUL"


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
            "sandbox": True,
            "status": "NONE",
            "paid": False,
            "amount": fee[0] if fee else None,
            "currency": fee[1] if fee else None,
        }
    view: dict[str, Any] = {
        "appointmentId": appointment_id,
        "sandbox": True,
        "attemptId": row.get("attemptId"),
        "status": row["status"],
        "paid": row["status"] == PAID,
        "amount": int(row["amount"]),
        "currency": row.get("currency", "XAF"),
    }
    for field in ("transId", "checkoutUrl", "startedAt"):
        if field in row:
            view[field] = row[field]
    return view


def route(event: dict[str, Any], repo: Repository, principal: Principal) -> dict[str, Any]:
    """The appointment payment routes on the sandbox function."""
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

    attempt_id = _uuid4(requests.json_body(event).get("attemptId"))
    if str(appointment.get("state", "")).endswith("CANCELLED"):
        raise Conflict("a cancelled visit cannot be paid")
    if fee is None or fee[0] <= 0:
        raise Conflict("this visit has no fee to pay")
    if latest is not None:
        previous = repo.get(Key(str(latest["reference"]), "PAYMENT"), consistent=True)
        if previous is not None and previous["status"] == PAID:
            raise Conflict("this visit is already paid")
    key = _payment_key(principal.tenant_id, attempt_id)
    row, created = _create(
        repo,
        key,
        fee[0],
        {
            "attemptId": attempt_id,
            "appointmentId": appointment_id,
            "currency": fee[1],
            "startedAt": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    )
    repo.put(latest_key, {"reference": key.pk, "attemptId": attempt_id})
    return responses.response(201 if created else 200, _view(appointment_id, row, fee))
