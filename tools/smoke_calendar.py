"""Check the staff calendar end to end, against deployed infrastructure.

    python tools/smoke_calendar.py

FR-STF-01: a clinician sees their own calendar, and a receptionist sees any
clinician's day in their own clinic. Creates a clinic open around the clock,
two clinicians and a receptionist there, and a receptionist at a second clinic,
all through the real staff API. The first receptionist books three
appointments, and then each account asks for what it should and should not see.

One booking is at 23:30 UTC, which is 00:30 the next day in Douala. It has to
appear on the clinic's local date and not on the UTC one: that is the case the
local clinicDay key exists for, and a UTC key would put it on the wrong list.

Every appointment is cancelled at the end, which also removes its reminder
schedule. The patient's number is fictional (tools/devkit.py), so no reminder
could have reached anyone either way.

Development only, same reasoning as tools/smoke_me.py.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from zoneinfo import ZoneInfo

import devkit
from atria_spec.region_packs import region_pack

RUN = devkit.run_id()
CLINIC_ID = f"c-cal-{RUN}"
OTHER_CLINIC_ID = "c-douala-akwa"
TYPE_ID = f"at-cal-{RUN}"
ZONE = ZoneInfo(region_pack(devkit.REGION_PACK_CODE)["timezone"])


def stamp(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def entries(raw: str) -> list[dict[str, object]]:
    return list(json.loads(raw).get("appointments", []))


def named(raw: str, patient: str) -> dict:
    """The name the list gives one patient profile."""
    try:
        return dict(json.loads(raw).get("patients", {}).get(patient) or {})
    except ValueError:
        return {}


def main() -> int:
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    staff_client = devkit.app_client(idp, pool, "staff")
    base = devkit.api_base()
    table = devkit.main_table()
    print(f"api  {base}\nrun  {RUN}")

    devkit.seed_baseline(table)
    around_the_clock = devkit.every_day_hours("00:00", "23:50")
    devkit.put_clinic(table, CLINIC_ID, name="Clinique du calendrier", hours=around_the_clock)
    devkit.put_clinic(table, OTHER_CLINIC_ID, name="Clinique d'Akwa")
    devkit.put_appointment_type(table, TYPE_ID)
    _person, patient = devkit.put_patient(table, RUN)

    admin = devkit.admin_token(idp, pool, staff_client)
    first = devkit.create_staff(base, admin, devkit.clinician_body(CLINIC_ID, RUN, "Etoa"))
    second = devkit.create_staff(base, admin, devkit.clinician_body(CLINIC_ID, RUN, "Nkoulou"))
    desk = devkit.create_staff(base, admin, devkit.receptionist_body(CLINIC_ID))
    elsewhere = devkit.create_staff(base, admin, devkit.receptionist_body(OTHER_CLINIC_ID))
    first_id, second_id = str(first["staffId"]), str(second["staffId"])
    print(f"clinicians {first_id}, {second_id}; receptionist {desk['staffId']}")

    first_token = devkit.staff_token(idp, pool, staff_client, first)
    desk_token = devkit.staff_token(idp, pool, staff_client, desk)
    elsewhere_token = devkit.staff_token(idp, pool, staff_client, elsewhere)

    # Day D is a UTC date three days out. 23:30 UTC on D is 00:30 local on D+1.
    utc_day = (dt.datetime.now(tz=dt.UTC) + dt.timedelta(days=3)).date()
    local_day = utc_day + dt.timedelta(days=1)
    later_day = utc_day + dt.timedelta(days=2)
    midnight_edge = dt.datetime.combine(utc_day, dt.time(23, 30), tzinfo=dt.UTC)
    bookings = {
        "edge": (first_id, midnight_edge),
        "later": (first_id, dt.datetime.combine(later_day, dt.time(10, 0), tzinfo=ZONE)),
        "other": (second_id, dt.datetime.combine(local_day, dt.time(11, 0), tzinfo=ZONE)),
    }
    booked: dict[str, dict[str, object]] = {}
    for name, (clinician, start) in bookings.items():
        status, raw, _headers = devkit.call(
            f"{base}/appointments",
            desk_token,
            method="POST",
            body={
                "patientProfileId": patient,
                "appointmentTypeId": TYPE_ID,
                "clinicianProfileId": clinician,
                "startAt": stamp(start),
                "channel": "PHONE",
            },
        )
        if status != 201:
            print(raw)
            print(f"\ncould not book the {name} appointment: {status}")
            return 1
        booked[name] = json.loads(raw)
        print(f"booked {name}: {stamp(start)} with {clinician}")
    ids = {name: str(item["appointmentId"]) for name, item in booked.items()}

    def get(path: str, token: str) -> tuple[int, str]:
        status, raw, _headers = devkit.call(f"{base}{path}", token)
        print(f"GET {path}: {status}")
        return status, raw

    own_status, own_raw = get(
        f"/clinicians/{first_id}/calendar?from={local_day}&to={later_day}", first_token
    )
    own = entries(own_raw) if own_status == 200 else []
    colleague_status, _ = get(f"/clinicians/{second_id}/calendar", first_token)
    clinician_day_status, _ = get(f"/clinics/{CLINIC_ID}/day?date={local_day}", first_token)

    day_status, day_raw = get(f"/clinics/{CLINIC_ID}/day?date={local_day}", desk_token)
    day = entries(day_raw) if day_status == 200 else []
    utc_status, utc_raw = get(f"/clinics/{CLINIC_ID}/day?date={utc_day}", desk_token)
    on_utc_day = entries(utc_raw) if utc_status == 200 else []
    desk_cal_status, desk_cal_raw = get(
        f"/clinicians/{first_id}/calendar?from={local_day}&to={local_day}", desk_token
    )
    desk_cal = entries(desk_cal_raw) if desk_cal_status == 200 else []
    wide_status, _ = get(
        f"/clinicians/{first_id}/calendar?from={local_day}&to={local_day + dt.timedelta(days=40)}",
        desk_token,
    )
    backwards_status, _ = get(
        f"/clinicians/{first_id}/calendar?from={later_day}&to={local_day}", desk_token
    )
    foreign_status, _ = get(f"/clinics/{CLINIC_ID}/day?date={local_day}", elsewhere_token)

    cancel_status, _raw, _h = devkit.call(
        f"{base}/appointments/{ids['other']}",
        desk_token,
        method="DELETE",
        body={"cancelledBy": "CLINIC", "reason": "calendar smoke test"},
    )
    after_status, after_raw = get(f"/clinics/{CLINIC_ID}/day?date={local_day}", desk_token)
    after = {str(a["appointmentId"]): a for a in entries(after_raw)} if after_status == 200 else {}

    for name in ("edge", "later"):
        devkit.call(
            f"{base}/appointments/{ids[name]}",
            desk_token,
            method="DELETE",
            body={"cancelledBy": "CLINIC", "reason": "calendar smoke test"},
        )

    edge_entry = next((a for a in day if a.get("appointmentId") == ids["edge"]), {})
    checks = {
        "a clinician reads their own calendar": own_status == 200,
        "and sees exactly their two appointments": sorted(str(a["appointmentId"]) for a in own)
        == sorted([ids["edge"], ids["later"]]),
        "a clinician is refused a colleague's calendar": colleague_status == 403,
        "a clinician is refused the clinic's day": clinician_day_status == 403,
        "the receptionist reads the clinic's day": day_status == 200,
        "the day holds both clinicians' bookings": sorted(str(a["appointmentId"]) for a in day)
        == sorted([ids["edge"], ids["other"]]),
        "00:30 local sits on the local date": edge_entry.get("startAt") == stamp(midnight_edge),
        "and not on the UTC date": all(a.get("appointmentId") != ids["edge"] for a in on_utc_day),
        "the receptionist reads a clinician's calendar": [a["appointmentId"] for a in desk_cal]
        == [ids["edge"]],
        "a range over a month is refused": wide_status == 400,
        "a range that runs backwards is refused": backwards_status == 400,
        "a receptionist elsewhere is refused this clinic": foreign_status == 403,
        "the cancellation went through": cancel_status == 200,
        # A clinic cancelling is its own state, whatever the notice.
        "a cancelled appointment stays on the day": after.get(ids["other"], {}).get("state")
        == "CLINIC_CANCELLED",
        "no entry leaks a storage field": all(
            "clinicDay" not in a and "pk" not in a for a in day + own
        ),
        "the day names its patient, and only by name": named(day_raw, patient)
        == {"givenName": "Amina", "familyName": "Ngo"},
    }

    print()
    for name, passed in checks.items():
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")
    print()
    if all(checks.values()):
        print("the staff calendar works end to end, scoped by role, on the clinic's own dates")
        return 0
    print("the staff calendar is not working: see the failed checks above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
