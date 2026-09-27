"""What happens after booking, end to end, against deployed infrastructure.

    python tools/smoke_visits.py

Builds on tools/smoke_booking.py: the same seeded smoke tenant, a new
clinician and receptionist through the real staff API. Then, through the API:

1. the receptionist books a visit;
2. moves it without a reason, which must be refused (FR-VIS-05), then with one;
3. the new time's locks are held and the old time's freed (FR-VIS-07);
4. the receptionist records arrival, and cannot open the consultation;
5. the clinician starts and completes it;
6. a second visit is cancelled by staff without a reason, which must be refused.

The smoke patient has no email or phone, so no notice reaches anyone.
Development only.
"""

from __future__ import annotations

import datetime as dt
import json
import sys

import boto3
import smoke_booking as sb


def later(start: str, days: int) -> str:
    when = dt.datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC)
    when += dt.timedelta(days=days)
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=sb.REGION)
    pool_id = sb.find_user_pool(idp)
    staff_client = sb.find_client(idp, pool_id, "staff")
    base = sb.api_base()
    table = sb.main_table()
    sb.seed(table)
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
            "languages": ["fr", "en"],
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
    clinician_id = str(clinician["staffId"])
    desk_token = sb.sign_in_as(idp, pool_id, staff_client, desk)
    clinician_token = sb.sign_in_as(idp, pool_id, staff_client, clinician)
    print(f"run {sb.RUN}: clinician {clinician_id}, receptionist {desk['staffId']}")

    def book(start: str) -> dict:
        status, raw = sb.call(
            f"{base}/appointments",
            desk_token,
            method="POST",
            body={
                "patientProfileId": sb.PATIENT_PROFILE_ID,
                "appointmentTypeId": sb.APPOINTMENT_TYPE_ID,
                "clinicianProfileId": clinician_id,
                "startAt": start,
                "channel": "PHONE",
                "callbackPhone": "+12025550199",
            },
        )
        if status != 201:
            raise SystemExit(f"booking failed: {status} {raw}")
        return dict(json.loads(raw))

    def act(appointment_id: str, action: str, token: str, body: object = None) -> tuple[int, dict]:
        status, raw = sb.call(
            f"{base}/appointments/{appointment_id}/{action}",
            token,
            method="POST",
            body=body if body is not None else {},
        )
        return status, json.loads(raw) if raw else {}

    start = sb.start_at()
    visit = book(start)
    moved_to = later(start, 1)
    no_reason, _ = act(
        visit["appointmentId"],
        "reschedule",
        desk_token,
        {"startAt": moved_to, "rescheduledBy": "CLINIC"},
    )
    moved_status, moved = act(
        visit["appointmentId"],
        "reschedule",
        desk_token,
        {"startAt": moved_to, "rescheduledBy": "CLINIC", "reason": "smoke: clinician in theatre"},
    )
    print(f"reschedule without reason {no_reason}, with {moved_status}: {moved.get('state')}")
    new_locks = sb.count_locks(table, clinician_id, sb.held_units(moved_to))
    old_locks = sb.count_locks(table, clinician_id, sb.held_units(start))

    arrived_status, arrived = act(visit["appointmentId"], "arrive", desk_token)
    desk_start, _ = act(visit["appointmentId"], "start", desk_token)
    started_status, started = act(visit["appointmentId"], "start", clinician_token)
    done_status, done = act(visit["appointmentId"], "complete", clinician_token)
    print(f"arrive {arrived_status}, desk start {desk_start}")
    print(f"clinician start {started_status}, complete {done_status}")

    second = book(later(start, 2))
    unexplained, _ = sb.call(
        f"{base}/appointments/{second['appointmentId']}",
        desk_token,
        method="DELETE",
        body={"cancelledBy": "PATIENT"},
    )
    explained, _ = sb.call(
        f"{base}/appointments/{second['appointmentId']}",
        desk_token,
        method="DELETE",
        body={"cancelledBy": "PATIENT", "reason": "smoke: patient phoned"},
    )

    units = len(sb.held_units(start))
    checks = {
        "a staff move without a reason is refused": no_reason == 400,
        "a staff move with a reason lands": moved_status == 200
        and moved.get("state") == "RESCHEDULED",
        "the reference is kept": moved.get("reference") == visit.get("reference"),
        "the new time holds every unit": new_locks == units,
        "the old time is free": old_locks == 0,
        "arrival is recorded": arrived_status == 200 and arrived.get("state") == "ARRIVED",
        "the desk cannot open the consultation": desk_start == 403,
        "the clinician starts it": started_status == 200
        and started.get("state") == "IN_CONSULTATION",
        "and completes it": done_status == 200 and done.get("state") == "COMPLETED",
        "a staff cancel without a reason is refused": unexplained == 400,
        "with a reason it goes through": explained == 200,
    }
    print()
    for name, ok in checks.items():
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
