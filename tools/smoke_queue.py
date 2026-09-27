"""The general consultation queue, end to end, against deployed infrastructure.

    python tools/smoke_queue.py

On the smoke tenant: a unit manager publishes today's session (capacity
derived), the desk gives two patients places (positions from the server), one
arrives, a doctor calls the next patient (assigned then, not before), closes
the consultation, and the manager closes the session with its measured pace.
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
    devkit.put_clinic(
        table,
        sb.CLINIC_ID,
        name="Smoke Unit",
        tenant_id=sb.TENANT_ID,
        hours=devkit.every_day_hours("00:00", "23:50"),
    )
    devkit.put_appointment_type(
        table,
        f"at-gen-{sb.RUN}",
        code="GEN_CONSULT",
        tenant_id=sb.TENANT_ID,
        clinicIds=[sb.CLINIC_ID],
    )
    second = f"pp-smoke-b-{sb.RUN}"
    table.put_item(
        Item={
            "pk": f"TENANT#{sb.TENANT_ID}#PAT#{second}",
            "sk": "PROFILE",
            "type": "PATIENT_PROFILE",
            "patientProfileId": second,
            "personId": sb.PERSON_ID,
            "tenantId": sb.TENANT_ID,
        }
    )
    admin = sb.sign_in(idp, pool_id, staff_client, sb.ADMIN_USERNAME, sb.ensure_admin(idp, pool_id))

    def staff(family: str, roles: list[str], **extra: object) -> dict[str, object]:
        return sb.create_staff(
            base,
            admin,
            {
                "givenName": "Smoke",
                "familyName": family,
                "phoneE164": sb.phone(),
                "clinicId": sb.CLINIC_ID,
                "roles": roles,
                **extra,
            },
        )

    gp = staff(
        "Doctor",
        ["CLINICIAN"],
        specialty="General practice",
        registrationYear=2016,
        ordreNumber=f"CM-ONMC-{sb.RUN}",
        languages=["en"],
    )
    desk = sb.sign_in_as(idp, pool_id, staff_client, staff("Receptionist", ["RECEPTIONIST"]))
    manager = sb.sign_in_as(idp, pool_id, staff_client, staff("Manager", ["CLINIC_MANAGER"]))
    doctor = sb.sign_in_as(idp, pool_id, staff_client, gp)

    today = dt.datetime.now(tz=dt.timezone(dt.timedelta(hours=1))).date().isoformat()
    minute = dt.datetime.now(tz=dt.timezone(dt.timedelta(hours=1)))
    start = f"{minute.hour:02d}:{(minute.minute // 10) * 10:02d}"
    end_hour = min(23, minute.hour + 2)
    published_status, published_raw = sb.call(
        f"{base}/clinics/{sb.CLINIC_ID}/sessions",
        manager,
        method="POST",
        body={
            "date": today,
            "startTime": start,
            "endTime": f"{end_hour:02d}:{50 if end_hour == 23 else 0:02d}",
            "rosteredClinicianCount": 1,
        },
    )
    session = json.loads(published_raw) if published_status == 201 else {}
    sid = session.get("sessionId")
    if published_status != 201:
        print("publish", published_status, published_raw)
    typed_status, _ = sb.call(
        f"{base}/clinics/{sb.CLINIC_ID}/sessions",
        manager,
        method="POST",
        body={
            "date": today,
            "startTime": "00:00",
            "endTime": "00:30",
            "rosteredClinicianCount": 1,
            "capacity": 99,
        },
    )
    first_status, first_raw = sb.call(
        f"{base}/sessions/{sid}/tickets",
        desk,
        method="POST",
        body={"patientProfileId": sb.PATIENT_PROFILE_ID, "channel": "WALK_IN"},
    )
    first = json.loads(first_raw) if first_status == 201 else {}
    if first_status != 201:
        print("ticket", first_status, first_raw)
    second_status, second_raw = sb.call(
        f"{base}/sessions/{sid}/tickets",
        desk,
        method="POST",
        body={"patientProfileId": second, "channel": "PHONE"},
    )
    second_ticket = json.loads(second_raw) if second_status == 201 else {}
    arrive_status, _ = sb.call(
        f"{base}/appointments/{first.get('appointmentId')}/arrive", desk, method="POST"
    )
    next_status, next_raw = sb.call(f"{base}/sessions/{sid}/next", doctor, method="POST")
    called = json.loads(next_raw) if next_status == 200 else {}
    done_status, _ = sb.call(
        f"{base}/appointments/{first.get('appointmentId')}/complete", doctor, method="POST"
    )
    queue_status, queue_raw = sb.call(f"{base}/sessions/{sid}/queue", desk)
    live = json.loads(queue_raw) if queue_status == 200 else {}
    close_status, close_raw = sb.call(f"{base}/sessions/{sid}/close", manager, method="POST")
    closed = json.loads(close_raw) if close_status == 200 else {}

    checks = {
        "the manager publishes with a derived capacity": published_status == 201
        and int(session.get("capacity", 0)) > 0,
        "a typed capacity is refused": typed_status == 400,
        "places come from the server, in order": (
            first.get("position"),
            second_ticket.get("position"),
        )
        == (1, 2),
        "no doctor before check-in": first.get("clinicianProfileId") is None
        and bool(first.get("arrivalWindowStart")),
        "arrival is recorded": arrive_status == 200,
        "the doctor is assigned when called": next_status == 200
        and called.get("clinicianProfileId") == gp["staffId"],
        "and closes the consultation": done_status == 200,
        "the desk sees one seen, one waiting": (live.get("seen"), live.get("waiting")) == (1, 1),
        "closing records the pace": close_status == 200
        and closed.get("actualThroughputPerHour") is not None,
    }
    print()
    for name, ok in checks.items():
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
