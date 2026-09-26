"""A clinician's working hours, and time taken away from them.

    GET    /clinicians/{id}/availability      hours and time off from today
    PUT    /clinicians/{id}/hours             replace the week (FR-DIR-03)
    POST   /clinicians/{id}/time-off          take time away (FR-DIR-04, FR-DIR-05, FR-STF-10)
    DELETE /clinicians/{id}/time-off/{groupId} give it back

Three kinds of time off, one stored shape (atria.data.availability):

    BLOCK        refused if a visit is inside; move or cancel it first, so the
                 patient is always told (FR-DIR-04)
    LEAVE        whole days; the visits inside are disrupted (FR-DIR-05)
    UNAVAILABLE  a window, often today; the visits inside are disrupted and
                 each patient offered the next times (FR-STF-10)

Served by a function of its own (AvailabilityService in the API stack), the
only one besides booking that writes schedule data, so the directory and the
slot search stay read only.

Hours, blocks and leave are availability.write: a clinician their own, a unit
manager their unit's. Marking a clinician unavailable is session.disrupt,
which the front desk also holds, because it is usually the desk that learns
a clinician is not coming in.

The time off is written before the visits inside it are read, so a booking
that lands between the two cannot slip past: the free search no longer offers
that time, and the read that follows sees any booking that beat it.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import lifecycle, permissions, schedule
from atria.core.errors import AtriaError, Conflict, Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.availability import Availability
from atria.data.booking import Booking
from atria.data.repository import Repository
from atria.http import requests, responses
from atria.http.handler import api
from atria.http.views import appointment_view

logger = Logger(service="atria-directory")


def availability(data: Booking) -> Availability:
    """Hours and time off live beside the bookings, in the same table."""
    return Availability(data.repository)


def _clinician(
    principal: Principal, event: dict[str, Any], data: Booking, permission: str
) -> tuple[str, str]:
    """The clinician in the path and their unit, once the caller may act on them."""
    clinician_id = requests.path_parameter(event, "id")
    membership = data.bookable_clinician(principal.tenant_id, clinician_id)
    clinic_id = str(membership["clinicId"])
    permissions.require(
        principal,
        permission,
        Subject(
            tenant_id=principal.tenant_id, clinician_profile_id=clinician_id, clinic_id=clinic_id
        ),
    )
    return clinician_id, clinic_id


def _hours_view(hours: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        str(item["weekday"]): {"start": item["startTime"], "end": item["endTime"]} for item in hours
    }


def _time_off_view(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each block or leave once, with the dates it covers."""
    groups: dict[str, dict[str, Any]] = {}
    for item in items:
        group = groups.setdefault(
            str(item.get("groupId") or item.get("availabilityExceptionId")),
            {
                "groupId": item.get("groupId") or item.get("availabilityExceptionId"),
                "kind": item.get("source") or "BLOCK",
                "from": item["exceptionDate"],
                "to": item["exceptionDate"],
                "startTime": item.get("startTime"),
                "endTime": item.get("endTime"),
                "reason": item.get("reason"),
            },
        )
        group["from"] = min(group["from"], item["exceptionDate"])
        group["to"] = max(group["to"], item["exceptionDate"])
    return list(groups.values())


def read(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    clinician_id, clinic_id = _clinician(principal, event, data, "availability.read")
    today = data.now().astimezone(data.zone(principal.tenant_id)).date().isoformat()
    store = availability(data)
    hours = store.hours(principal.tenant_id, clinician_id)
    unit = data.clinic(principal.tenant_id, clinic_id)
    return {
        "clinicianProfileId": clinician_id,
        "clinicId": clinic_id,
        # No hours of their own means the unit's opening hours apply.
        "usesUnitHours": not hours,
        "hours": _hours_view(hours),
        "unitHours": unit.get("openingHours") or {},
        "timeOff": _time_off_view(store.exceptions(principal.tenant_id, clinician_id, since=today)),
    }


def set_hours(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    clinician_id, clinic_id = _clinician(principal, event, data, "availability.write")
    minutes = rules.grid_unit_minutes(data.tenant(principal.tenant_id))
    hours = schedule.validate_hours(requests.json_body(event), minutes=minutes)
    written = availability(data).set_hours(
        tenant_id=principal.tenant_id,
        clinician_id=clinician_id,
        clinic_id=clinic_id,
        hours=hours,
        actor_person_id=principal.person_id,
        at=rules.instant(data.now()),
    )
    logger.info("hours set", extra={"clinicianProfileId": clinician_id, "days": len(written)})
    return {
        "clinicianProfileId": clinician_id,
        "usesUnitHours": False,
        "hours": _hours_view(written),
    }


def _inside(
    data: Booking, tenant_id: str, clinician_id: str, windows: list[schedule.Window]
) -> list[dict[str, Any]]:
    """The visits still holding time inside any of the windows."""
    since = rules.instant(min(w.opens_at for w in windows) - dt.timedelta(days=1))
    until = rules.instant(max(w.closes_at for w in windows))
    found = data.calendar(tenant_id, clinician_id, since=since, until=until)
    return [
        a
        for a in found
        if lifecycle.is_scheduled(str(a.get("state")))
        and any(
            schedule.overlaps(
                w,
                rules.parse_instant(a["startAt"], name="startAt"),
                rules.parse_instant(a["endAt"], name="endAt"),
            )
            for w in windows
        )
    ]


def take_time_off(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    body = requests.json_body(event)
    kind = str(body.get("kind") or "").upper()
    if kind not in schedule.EXCEPTION_KINDS:
        raise Invalid("kind is required", detail={"allowed": list(schedule.EXCEPTION_KINDS)})
    permission = "session.disrupt" if kind == "UNAVAILABLE" else "availability.write"
    clinician_id, _clinic_id = _clinician(principal, event, data, permission)
    reason = rules.require_reason(
        str(body.get("reason") or "") or None, by_staff=True, action="take time away from"
    )
    tenant_id = principal.tenant_id
    zone = data.zone(tenant_id)
    now = data.now()
    days = schedule.exception_days(body, today=now.astimezone(zone).date())
    start, end = schedule.exception_span(body, days=days)
    if kind == "LEAVE" and start is not None:
        raise Invalid("leave is whole days; to take part of a day, block it or mark it unavailable")
    windows = schedule.exception_windows(days, start, end, zone=zone)

    store = availability(data)
    written = store.add_exceptions(
        tenant_id=tenant_id,
        clinician_id=clinician_id,
        days=days,
        start=start,
        end=end,
        source=kind,
        reason=reason or "",
        actor_person_id=principal.person_id,
        at=rules.instant(now),
    )
    group = str(written[0]["groupId"])
    affected = _inside(data, tenant_id, clinician_id, windows)

    if kind == "BLOCK" and affected:
        # Give the time back: a block never lands on a visit silently.
        store.remove_group(tenant_id, clinician_id, group)
        raise Conflict(
            "that time holds visits; move or cancel them first so each patient is told",
            detail={"references": [a.get("reference") for a in affected]},
        )

    disrupted: list[dict[str, Any]] = []
    for appointment in affected:
        try:
            moved, _event = data.move(
                tenant_id=tenant_id,
                appointment=appointment,
                to_state="DISRUPTED",
                kind="DISRUPTED",
                actor_person_id=principal.person_id,
                actor_role=None,
                reason=reason,
                fields={"disruptedAt": rules.instant(now), "disruptionGroupId": group},
            )
        except Conflict:
            # It changed while this ran (cancelled, arrived); it is no longer ours to move.
            continue
        disrupted.append(appointment_view(moved))
    logger.info(
        "time taken away",
        extra={
            "clinicianProfileId": clinician_id,
            "kind": kind,
            "days": len(days),
            "disrupted": len(disrupted),
        },
    )
    return {
        "groupId": group,
        "kind": kind,
        "from": days[0].isoformat(),
        "to": days[-1].isoformat(),
        "startTime": start,
        "endTime": end,
        "disrupted": disrupted,
    }


def give_back(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    """Undo a block or leave. Disrupted visits stay disrupted: each patient was already asked."""
    clinician_id, _clinic_id = _clinician(principal, event, data, "availability.write")
    group = requests.path_parameter(event, "groupId")
    removed = availability(data).remove_group(principal.tenant_id, clinician_id, group)
    return {"groupId": group, "dates": [item["exceptionDate"] for item in removed]}


_booking: Booking | None = None


def booking() -> Booking:
    global _booking
    if _booking is None:
        _booking = Booking(Repository())
    return _booking


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """The four routes above."""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    data = booking()
    if method == "GET" and resource.endswith("/availability"):
        return responses.ok(read(principal, event, data=data))
    if method == "PUT" and resource.endswith("/hours"):
        return responses.ok(set_hours(principal, event, data=data))
    if method == "POST" and resource.endswith("/time-off"):
        return responses.created(take_time_off(principal, event, data=data))
    if method == "DELETE" and resource.endswith("/time-off/{groupId}"):
        return responses.ok(give_back(principal, event, data=data))
    raise AtriaError(f"no handler for {method} {resource}")
