"""Capacity over a week, hospital-wide: where the cover is thin (Admin · Overview, 211:2).

    GET /capacity?from=YYYY-MM-DD

report.read at tenant scope, so the administrator's alone. From the Monday
given (the next one by default), for seven days, it says:

    leave      a clinician away for whole days, and the visits already
               booked inside that time, which someone has to move
    uncovered  a unit open on a day no clinician of it works
    covered    each unit's free working hours, when it has no gap

No patient appears: this is about clinicians and hours, so not an audit entry.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import permissions, schedule
from atria.core.errors import Invalid
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import Booking
from atria.data.catalogue import Catalogue
from atria.data.people import People
from atria.http import requests
from atria.services.directory import availability as availability_views
from atria.services.directory.roster import TAKING_TIME

DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def next_monday(today: dt.date) -> dt.date:
    return today + dt.timedelta(days=7 - today.weekday())


def name_of(clinician: dict[str, Any]) -> str:
    return " ".join(str(p) for p in (clinician.get("givenName"), clinician.get("familyName")) if p)


def spans(days: list[dt.date]) -> list[tuple[dt.date, dt.date]]:
    """Consecutive days as (first, last) runs."""
    runs: list[tuple[dt.date, dt.date]] = []
    for day in sorted(days):
        if runs and (day - runs[-1][1]).days == 1:
            runs[-1] = (runs[-1][0], day)
        else:
            runs.append((day, day))
    return runs


def week(
    principal: Principal, event: dict[str, Any], *, data: Booking, people: People
) -> dict[str, Any]:
    scope = permissions.require(principal, "report.read", Subject(tenant_id=principal.tenant_id))
    if scope != "tenant":
        raise Invalid("hospital-wide capacity is the administrator's")
    zone = data.zone(principal.tenant_id)
    today = data.now().astimezone(zone).date()
    raw = requests.query_parameter(event, "from")
    first = schedule.parse_date(raw, name="from") if raw else next_monday(today)
    days = [first + dt.timedelta(days=i) for i in range(7)]
    store = availability_views.availability(data)

    leave: list[dict[str, Any]] = []
    uncovered: list[dict[str, Any]] = []
    covered: list[dict[str, Any]] = []
    on_shift: set[str] = set()

    for clinic in Catalogue(data.repository).clinics(principal.tenant_id):
        clinic_id = str(clinic["clinicId"])
        clinicians = people.clinicians(principal.tenant_id, clinic_id=clinic_id)
        booked = {d: data.clinic_day(principal.tenant_id, clinic_id, d.isoformat()) for d in days}
        worked: dict[dt.date, int] = dict.fromkeys(days, 0)
        free_minutes = 0
        for clinician in clinicians:
            cid = str(clinician["clinicianProfileId"])
            hours = store.hours(principal.tenant_id, cid)
            taken = data.exceptions(principal.tenant_id, cid)
            away: list[dt.date] = []
            for day in days:
                window = schedule.working_window(hours, clinic.get("openingHours"), day, zone=zone)
                if window is None:
                    continue
                whole = [
                    e
                    for e in taken
                    if str(e.get("exceptionDate")) == day.isoformat() and e.get("startTime") is None
                ]
                if whole:
                    away.append(day)
                    continue
                worked[day] += 1
                on_shift.add(cid)
                minutes = int((window.closes_at - window.opens_at).total_seconds() // 60)
                mine = [
                    a
                    for a in booked[day]
                    if a.get("clinicianProfileId") == cid and a.get("state") in TAKING_TIME
                ]
                used = sum(
                    int(
                        (
                            dt.datetime.fromisoformat(str(a["endAt"]).replace("Z", "+00:00"))
                            - dt.datetime.fromisoformat(str(a["startAt"]).replace("Z", "+00:00"))
                        ).total_seconds()
                        // 60
                    )
                    for a in mine
                )
                free_minutes += max(0, minutes - used)
            for start, end in spans(away):
                inside = sum(
                    1
                    for d in days
                    if start <= d <= end
                    for a in booked[d]
                    if a.get("clinicianProfileId") == cid and a.get("state") in TAKING_TIME
                )
                leave.append(
                    {
                        "clinicianProfileId": cid,
                        "clinicianName": name_of(clinician),
                        "clinicId": clinic_id,
                        "clinicName": clinic.get("name"),
                        "from": start.isoformat(),
                        "to": end.isoformat(),
                        "booked": inside,
                    }
                )
        open_days = [
            d
            for d in days
            if schedule.opening_window(clinic.get("openingHours"), d, zone=zone) is not None
        ]
        gaps = [d for d in open_days if worked[d] == 0]
        if gaps and clinicians:
            uncovered.append(
                {
                    "clinicId": clinic_id,
                    "clinicName": clinic.get("name"),
                    "days": [DAY_NAMES[d.weekday()] for d in gaps],
                    "dates": [d.isoformat() for d in gaps],
                }
            )
        elif open_days and clinicians:
            covered.append(
                {
                    "clinicId": clinic_id,
                    "clinicName": clinic.get("name"),
                    "clinicians": len(clinicians),
                    "freeHours": round(free_minutes / 60),
                }
            )

    leave.sort(key=lambda row: (-int(row["booked"]), str(row["from"])))
    uncovered.sort(key=lambda row: -len(row["days"]))
    covered.sort(key=lambda row: -int(row["freeHours"]))
    return {
        "from": first.isoformat(),
        "to": days[-1].isoformat(),
        "cliniciansOnShift": len(on_shift),
        "leave": leave,
        "uncovered": uncovered,
        "covered": covered,
    }
