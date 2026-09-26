"""Working hours and time off, end to end, against deployed infrastructure.

    python tools/smoke_availability.py

On the smoke tenant (tools/smoke_booking.py seeds it), through the API:

1. the clinician sets their own week, and the free search follows it;
2. the receptionist cannot set it;
3. a block over a booked visit is refused and names it (FR-DIR-04);
4. the receptionist marks the clinician unavailable over it, and the visit
   is disrupted (FR-STF-10);
5. the patient's side, a reschedule of the disrupted visit, books it again.

The smoke patient has no email or phone, so no notice reaches anyone.
Development only.
"""

from __future__ import annotations

import datetime as dt
import json
import sys

import boto3
import devkit
import smoke_booking as sb


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=sb.REGION)
    pool_id = sb.find_user_pool(idp)
    staff_client = sb.find_client(idp, pool_id, "staff")
    base = sb.api_base()
    table = sb.main_table()
    sb.seed(table)
    # The booking smoke never needed its unit as a record; the hours views read it.
    devkit.put_clinic(table, sb.CLINIC_ID, name="Smoke Unit", tenant_id=sb.TENANT_ID)
    admin = sb.sign_in(idp, pool_id, staff_client, sb.ADMIN_USERNAME, sb.ensure_admin(idp, pool_id))
    clinician = sb.create_staff(
        base,
        admin,
        {
            "givenName": "Smoke",
            "familyName": "Clinician",
            "phoneE164": sb.phone(),
            "clinicId": sb.CLINIC_ID,
            "roles": ["CLINICIAN"],
            "specialty": "Paediatrics",
            "registrationYear": 2012,
            "ordreNumber": f"CM-ONMC-{sb.RUN}",
            "languages": ["en"],
        },
    )
    desk = sb.create_staff(
        base,
        admin,
        {
            "givenName": "Smoke",
            "familyName": "Receptionist",
            "phoneE164": sb.phone(),
            "clinicId": sb.CLINIC_ID,
            "roles": ["RECEPTIONIST"],
        },
    )
    cid = str(clinician["staffId"])
    desk_token = sb.sign_in_as(idp, pool_id, staff_client, desk)
    own_token = sb.sign_in_as(idp, pool_id, staff_client, clinician)
    print(f"run {sb.RUN}: clinician {cid}")

    # A Wednesday a week or two out, 10:00 in Douala (09:00 UTC).
    day = dt.datetime.now(tz=dt.UTC).date() + dt.timedelta(days=8)
    day += dt.timedelta(days=(2 - day.weekday()) % 7)
    start = f"{day.isoformat()}T09:00:00Z"

    week = {"days": {"2": {"start": "09:00", "end": "13:00"}}}
    desk_hours, _ = sb.call(f"{base}/clinicians/{cid}/hours", desk_token, method="PUT", body=week)
    own_hours, _ = sb.call(f"{base}/clinicians/{cid}/hours", own_token, method="PUT", body=week)
    status, raw = sb.call(
        f"{base}/clinicians/{cid}/slots?date={day.isoformat()}&typeId={sb.APPOINTMENT_TYPE_ID}",
        desk_token,
    )
    starts = [s["startAt"] for s in json.loads(raw).get("slots", [])] if status == 200 else []
    print(
        f"hours: desk {desk_hours}, clinician {own_hours}; {len(starts)} starts, first {starts[:1]}"
    )

    booked_status, booked_raw = sb.call(
        f"{base}/appointments",
        desk_token,
        method="POST",
        body={
            "patientProfileId": sb.PATIENT_PROFILE_ID,
            "appointmentTypeId": sb.APPOINTMENT_TYPE_ID,
            "clinicianProfileId": cid,
            "startAt": start,
            "channel": "PHONE",
        },
    )
    visit = json.loads(booked_raw)
    window = {"date": day.isoformat(), "startTime": "09:00", "endTime": "12:00"}
    block_status, block_raw = sb.call(
        f"{base}/clinicians/{cid}/time-off",
        own_token,
        method="POST",
        body={"kind": "BLOCK", "reason": "smoke: meeting", **window},
    )
    off_status, off_raw = sb.call(
        f"{base}/clinicians/{cid}/time-off",
        desk_token,
        method="POST",
        body={"kind": "UNAVAILABLE", "reason": "smoke: called away", **window},
    )
    off = json.loads(off_raw) if off_status == 201 else {}
    status_after, after_raw = sb.call(
        f"{base}/appointments/{visit.get('appointmentId')}", desk_token
    )
    later = f"{(day + dt.timedelta(days=7)).isoformat()}T09:00:00Z"
    moved_status, moved_raw = sb.call(
        f"{base}/appointments/{visit.get('appointmentId')}/reschedule",
        desk_token,
        method="POST",
        body={"startAt": later, "rescheduledBy": "CLINIC", "reason": "smoke: new time chosen"},
    )

    checks = {
        "the desk cannot set a clinician's hours": desk_hours == 403,
        "the clinician sets their own": own_hours == 200,
        "the free search follows them": bool(starts)
        and starts[0] == f"{day.isoformat()}T08:00:00Z",
        "the visit books": booked_status == 201,
        "a block over it is refused": block_status == 409
        and visit.get("reference", "?") in block_raw,
        "the desk marks the clinician unavailable": off_status == 201,
        "the visit is disrupted": status_after == 200
        and json.loads(after_raw).get("state") == "DISRUPTED",
        "and named in the answer": [a.get("appointmentId") for a in off.get("disrupted", [])]
        == [visit.get("appointmentId")],
        "a new time books it again": moved_status == 200
        and json.loads(moved_raw).get("state") == "BOOKED",
    }
    print()
    for name, ok in checks.items():
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
