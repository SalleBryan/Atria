"""The unit's clinicians today: who is on shift, and how full their day is (FR-STF-08).

    GET /clinics/{id}/roster?date=

availability.read at clinic scope, which the front desk and the unit manager
hold. For each clinician of the unit, on the unit's date:

    status    OFF, LEAVE, UNAVAILABLE, LATER, ON_SHIFT, FINISHED, or SCHEDULED
              on a day other than today
    hours     the working span, and any time taken out of it
    load      visits booked, minutes booked, and the share of the working
              time they fill

No patient appears here: a roster is about the clinicians, so it is not an
audit entry.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import booking as rules
from atria.core import permissions, schedule
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.booking import Booking
from atria.data.people import People
from atria.http import requests
from atria.services.directory import availability as availability_views

# The states in which a visit still takes the clinician's time.
TAKING_TIME = ("BOOKED", "CONFIRMED", "RESCHEDULED", "ARRIVED", "IN_CONSULTATION", "COMPLETED")


def local(instant: dt.datetime, zone: Any) -> str:
    return instant.astimezone(zone).strftime("%H:%M")


def roster(
    principal: Principal, event: dict[str, Any], *, data: Booking, people: People
) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    clinic = data.clinic(principal.tenant_id, clinic_id)
    permissions.require(
        principal, "availability.read", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    zone = data.zone(principal.tenant_id)
    now = data.now()
    today = now.astimezone(zone).date()
    raw = requests.query_parameter(event, "date")
    day = schedule.parse_date(raw, name="date") if raw else today

    booked_today = data.clinic_day(principal.tenant_id, clinic_id, day.isoformat())
    store = availability_views.availability(data)
    rows = []
    for clinician in people.clinicians(principal.tenant_id, clinic_id=clinic_id):
        cid = str(clinician["clinicianProfileId"])
        window = schedule.working_window(
            store.hours(principal.tenant_id, cid), clinic.get("openingHours"), day, zone=zone
        )
        taken = [
            e
            for e in data.exceptions(principal.tenant_id, cid)
            if str(e.get("exceptionDate")) == day.isoformat()
        ]
        blocked = schedule.blocked_windows(taken, day, zone=zone)
        whole_day_off = any(e.get("startTime") is None for e in taken)
        kinds = {str(e.get("source") or "UNAVAILABLE") for e in taken}

        visits = [
            a
            for a in booked_today
            if a.get("clinicianProfileId") == cid and a.get("state") in TAKING_TIME
        ]
        booked_minutes = sum(
            int(
                (
                    rules.parse_instant(a["endAt"], name="endAt")
                    - rules.parse_instant(a["startAt"], name="startAt")
                ).total_seconds()
                // 60
            )
            for a in visits
        )

        if window is None:
            status, working = "OFF", 0
        else:
            working = int((window.closes_at - window.opens_at).total_seconds() // 60)
            for block in blocked:
                start = max(block.opens_at, window.opens_at)
                end = min(block.closes_at, window.closes_at)
                if end > start:
                    working -= int((end - start).total_seconds() // 60)
            working = max(0, working)
            if whole_day_off:
                status = "LEAVE" if "LEAVE" in kinds else "UNAVAILABLE"
            elif day != today:
                status = "SCHEDULED"
            elif any(b.opens_at <= now < b.closes_at for b in blocked):
                status = "UNAVAILABLE"
            elif now < window.opens_at:
                status = "LATER"
            elif now < window.closes_at:
                status = "ON_SHIFT"
            else:
                status = "FINISHED"

        rows.append(
            {
                "clinicianProfileId": cid,
                "givenName": clinician.get("givenName"),
                "familyName": clinician.get("familyName"),
                "specialty": clinician.get("specialty"),
                "status": status,
                "startsAt": local(window.opens_at, zone) if window else None,
                "endsAt": local(window.closes_at, zone) if window else None,
                "timeOff": [
                    {
                        "kind": str(e.get("source") or "UNAVAILABLE"),
                        "startTime": e.get("startTime"),
                        "endTime": e.get("endTime"),
                    }
                    for e in taken
                ],
                "visits": len(visits),
                "bookedMinutes": booked_minutes,
                "workingMinutes": working,
                "load": round(booked_minutes / working, 2) if working else None,
            }
        )
    order = {
        "ON_SHIFT": 0,
        "LATER": 1,
        "SCHEDULED": 1,
        "UNAVAILABLE": 2,
        "FINISHED": 3,
        "LEAVE": 4,
        "OFF": 5,
    }
    rows.sort(key=lambda r: (order.get(str(r["status"]), 9), str(r["familyName"])))
    return {
        "clinicId": clinic_id,
        "date": day.isoformat(),
        "timezone": str(zone),
        "clinicians": rows,
        "onShift": sum(1 for r in rows if r["status"] == "ON_SHIFT"),
    }
