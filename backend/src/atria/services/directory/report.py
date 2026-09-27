"""The weekly report per unit (FR-MSR-01, FR-MSR-02, FR-MSR-04).

    GET /clinics/{id}/report?week=     one unit's week
    GET /reports?week=                 every unit's week, for the administrator

report.read decides: a unit manager their unit, an administrator every unit.
The week is the Monday given, on the tenant's clock, this week by default,
and any week back to the tenant's first day of use. No patient is named: a
report is counts, so it is not an audit entry.

Each visit's reminder is read from the log row its appointment points at
(FR-REM-01), which is filed under the day the reminder was arranged, and the
ledger entries in one batch for the week's closed visits.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import permissions, schedule
from atria.core import report as rules
from atria.core.errors import Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.booking import Booking
from atria.data.catalogue import Catalogue
from atria.http import requests


def monday_of(principal: Principal, event: dict[str, Any], data: Booking) -> dt.date:
    zone = data.zone(principal.tenant_id)
    today = data.now().astimezone(zone).date()
    raw = requests.query_parameter(event, "week")
    day = schedule.parse_date(raw, name="week") if raw else today
    monday = day - dt.timedelta(days=day.weekday())
    if monday > today:
        raise Invalid("that week has not started")
    return monday


def unit_week(data: Booking, tenant_id: str, clinic_id: str, monday: dt.date) -> dict[str, Any]:
    days = [monday + dt.timedelta(days=n) for n in range(7)]
    appointments = [
        a for day in days for a in data.clinic_day(tenant_id, clinic_id, day.isoformat())
    ]
    ids = {str(a["appointmentId"]) for a in appointments}

    pointed = [
        keys.message_log(
            tenant_id,
            str(a["reminderLoggedAt"])[:10],
            str(a["reminderLoggedAt"]),
            str(a["reminderLogId"]),
        )
        for a in appointments
        if a.get("reminderLogId") and a.get("reminderLoggedAt")
    ]
    rows = data.repository.get_many(pointed) if pointed else {}
    reminders = {
        str(row["appointmentId"]): str(row.get("deliveryState") or "")
        for row in rows.values()
        if row.get("kind") == "APPOINTMENT_REMINDER"
    }

    wanted = [keys.fee_ledger_entry(tenant_id, i) for i in sorted(ids)]
    found = data.repository.get_many(wanted)
    ledger = [found[(k.pk, k.sk)] for k in wanted if (k.pk, k.sk) in found]
    return rules.week_figures(appointments, reminders=reminders, ledger=ledger)


def one_unit(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    clinic = data.clinic(principal.tenant_id, clinic_id)
    permissions.require(
        principal, "report.read", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    monday = monday_of(principal, event, data)
    return {
        "clinicId": clinic_id,
        "clinicName": clinic.get("name"),
        "week": monday.isoformat(),
        "to": (monday + dt.timedelta(days=6)).isoformat(),
        "firstDay": first_day(data, principal.tenant_id),
        **unit_week(data, principal.tenant_id, clinic_id, monday),
    }


def every_unit(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    scope = permissions.require(principal, "report.read", Subject(tenant_id=principal.tenant_id))
    if scope != "tenant":
        raise Invalid("the hospital-wide report is the administrator's; ask for your unit's")
    monday = monday_of(principal, event, data)
    units = []
    for clinic in Catalogue(data.repository).clinics(principal.tenant_id):
        figures = unit_week(data, principal.tenant_id, str(clinic["clinicId"]), monday)
        units.append({"clinicId": clinic["clinicId"], "clinicName": clinic.get("name"), **figures})
    units.sort(key=lambda u: -int(u["booked"]))
    return {
        "week": monday.isoformat(),
        "to": (monday + dt.timedelta(days=6)).isoformat(),
        "firstDay": first_day(data, principal.tenant_id),
        "units": units,
        "booked": sum(int(u["booked"]) for u in units),
        "attended": sum(int(u["attended"]) for u in units),
        "noShow": sum(int(u["noShow"]) for u in units),
        "cancelled": sum(int(u["cancelled"]) for u in units),
        "lateCancelled": sum(int(u["lateCancelled"]) for u in units),
    }


def first_day(data: Booking, tenant_id: str) -> str | None:
    """The first day of use, which is as far back as the report goes (FR-MSR-01)."""
    first = data.tenant(tenant_id).get("firstAppointmentAt")
    return str(first)[:10] if first else None
