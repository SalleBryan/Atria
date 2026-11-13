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


def period_days(
    principal: Principal, event: dict[str, Any], data: Booking
) -> tuple[dt.date, dt.date, list[dt.date]]:
    zone = data.zone(principal.tenant_id)
    today = data.now().astimezone(zone).date()
    granularity = (requests.query_parameter(event, "granularity") or "week").lower()
    raw = requests.query_parameter(event, "date") or requests.query_parameter(event, "week")
    target = schedule.parse_date(raw, name="date") if raw else today
    start, end = span(target, granularity)

    if start > today:
        msg = (
            "that week has not started" if granularity == "week" else "that period has not started"
        )
        raise Invalid(msg)
    return start, end, _days(start, end)


def span(target: dt.date, granularity: str) -> tuple[dt.date, dt.date]:
    """The first and last day of the day, week, month or year holding `target`."""
    if granularity == "day":
        return target, target
    if granularity == "month":
        start = target.replace(day=1)
        next_month = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        return start, next_month - dt.timedelta(days=1)
    if granularity == "year":
        return dt.date(target.year, 1, 1), dt.date(target.year, 12, 31)
    start = target - dt.timedelta(days=target.weekday())  # week
    return start, start + dt.timedelta(days=6)


def _days(start: dt.date, end: dt.date) -> list[dt.date]:
    return [start + dt.timedelta(days=n) for n in range((end - start).days + 1)]


def earlier_period(
    principal: Principal, event: dict[str, Any], data: Booking, start: dt.date
) -> tuple[dt.date, dt.date, list[dt.date]] | None:
    """The period named by `before`, the same length of time as the report's, or None.

    It must end before the report's period begins: a comparison of overlapping
    periods would count the same visits twice.
    """
    raw = requests.query_parameter(event, "before")
    if not raw:
        return None
    granularity = (requests.query_parameter(event, "granularity") or "week").lower()
    first, last = span(schedule.parse_date(raw, name="before"), granularity)
    if last >= start:
        raise Invalid("the period to compare with must end before this one begins")
    return first, last, _days(first, last)


def monday_of(principal: Principal, event: dict[str, Any], data: Booking) -> dt.date:
    start, _, _ = period_days(principal, event, data)
    return start


def unit_period(
    data: Booking, tenant_id: str, clinic_id: str, days: list[dt.date]
) -> dict[str, Any]:
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


def unit_week(data: Booking, tenant_id: str, clinic_id: str, monday: dt.date) -> dict[str, Any]:
    days = [monday + dt.timedelta(days=n) for n in range(7)]
    return unit_period(data, tenant_id, clinic_id, days)


def one_unit(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    clinic = data.clinic(principal.tenant_id, clinic_id)
    permissions.require(
        principal, "report.read", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    start, end, days = period_days(principal, event, data)
    figures = unit_period(data, principal.tenant_id, clinic_id, days)
    report = {
        "clinicId": clinic_id,
        "clinicName": clinic.get("name"),
        "week": start.isoformat(),
        "from": start.isoformat(),
        "to": end.isoformat(),
        "firstDay": first_day(data, principal.tenant_id),
        **figures,
    }
    earlier = earlier_period(principal, event, data, start)
    if earlier:
        was = unit_period(data, principal.tenant_id, clinic_id, earlier[2])
        report["comparison"] = _comparison(earlier, was, figures)
    return report


def _comparison(
    earlier: tuple[dt.date, dt.date, list[dt.date]], was: dict[str, Any], now: dict[str, Any]
) -> dict[str, Any]:
    return {"from": earlier[0].isoformat(), "to": earlier[1].isoformat()} | rules.change(was, now)


def every_unit(principal: Principal, event: dict[str, Any], *, data: Booking) -> dict[str, Any]:
    scope = permissions.require(principal, "report.read", Subject(tenant_id=principal.tenant_id))
    if scope != "tenant":
        raise Invalid("the hospital-wide report is the administrator's; ask for your unit's")
    start, end, days = period_days(principal, event, data)
    units = []
    for clinic in Catalogue(data.repository).clinics(principal.tenant_id):
        figures = unit_period(data, principal.tenant_id, str(clinic["clinicId"]), days)
        units.append({"clinicId": clinic["clinicId"], "clinicName": clinic.get("name"), **figures})
    units.sort(key=lambda u: -int(u["booked"]))
    report = {
        "week": start.isoformat(),
        "from": start.isoformat(),
        "to": end.isoformat(),
        "firstDay": first_day(data, principal.tenant_id),
        "units": units,
        **_totals(units),
        # The breakdowns a unit's report shows, for the whole hospital.
        **rules.hospital_figures(units),
    }
    earlier = earlier_period(principal, event, data, start)
    if earlier:
        was_units = [
            unit_period(data, principal.tenant_id, str(c["clinicId"]), earlier[2])
            for c in Catalogue(data.repository).clinics(principal.tenant_id)
        ]
        was = _totals(was_units) | rules.hospital_figures(was_units)
        report["comparison"] = _comparison(earlier, was, report)
    return report


def _totals(units: list[dict[str, Any]]) -> dict[str, int]:
    return {
        name: sum(int(u[name]) for u in units)
        for name in ("booked", "attended", "noShow", "cancelled", "lateCancelled", "open")
    }


def first_day(data: Booking, tenant_id: str) -> str | None:
    """The first day of use, which is as far back as the report goes (FR-MSR-01)."""
    first = data.tenant(tenant_id).get("firstAppointmentAt")
    return str(first)[:10] if first else None
