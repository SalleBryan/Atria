"""The staff console, end to end, against deployed infrastructure.

    python tools/smoke_console.py

On the smoke tenant: the desk adds a patient, finds them by name, number and
phone, books them by referral, reads their record and the roster; the unit
manager reads the week's changes after the desk cancels. Development only.
"""

from __future__ import annotations

import json
import sys
import urllib.parse

import boto3
import smoke_booking as sb


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=sb.REGION)
    pool_id = sb.find_user_pool(idp)
    staff_client = sb.find_client(idp, pool_id, "staff")
    base = sb.api_base()
    table = sb.main_table()
    sb.seed(table)
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

    clinician = staff(
        "Clinician",
        ["CLINICIAN"],
        specialty="Cardiology",
        registrationYear=2012,
        ordreNumber=f"CM-ONMC-{sb.RUN}",
        languages=["en"],
    )
    desk = sb.sign_in_as(idp, pool_id, staff_client, staff("Receptionist", ["RECEPTIONIST"]))
    manager = sb.sign_in_as(idp, pool_id, staff_client, staff("Manager", ["CLINIC_MANAGER"]))

    # Names hold no digits, so the run id is spelled in letters.
    family = "Smoke" + sb.RUN.translate(str.maketrans("0123456789", "ghijklmnop"))
    phone = sb.phone()
    made_status, made_raw = sb.call(
        f"{base}/patients",
        desk,
        method="POST",
        body={"givenName": "Test", "familyName": family, "phoneE164": phone},
    )
    made = json.loads(made_raw) if made_status == 201 else {}
    if made_status != 201:
        print("POST /patients", made_status, made_raw)
    pid = made.get("patientProfileId")

    def found(q: str) -> bool:
        status, raw = sb.call(f"{base}/patients?q={urllib.parse.quote(q)}", desk)
        return status == 200 and pid in [r["patientProfileId"] for r in json.loads(raw)["results"]]

    booked_status, booked_raw = sb.call(
        f"{base}/appointments",
        desk,
        method="POST",
        body={
            "patientProfileId": pid,
            "appointmentTypeId": sb.APPOINTMENT_TYPE_ID,
            "clinicianProfileId": clinician["staffId"],
            "startAt": sb.start_at(),
            "channel": "REFERRAL",
            "referringFacility": "Smoke Health Centre",
        },
    )
    booked = json.loads(booked_raw) if booked_status == 201 else {}
    record_status, record_raw = sb.call(f"{base}/patients/{pid}", desk)
    record = json.loads(record_raw) if record_status == 200 else {}
    roster_status, roster_raw = sb.call(f"{base}/clinics/{sb.CLINIC_ID}/roster", desk)
    cancel_status, _ = sb.call(
        f"{base}/appointments/{booked.get('appointmentId')}",
        desk,
        method="DELETE",
        body={"cancelledBy": "PATIENT", "reason": "smoke: patient phoned"},
    )
    week_status, week_raw = sb.call(f"{base}/audit/changes", manager)
    week = json.loads(week_raw) if week_status == 200 else {}

    checks = {
        "the desk adds a patient with a number": made_status == 201
        and str(made.get("patientNumber", "")).count("-") == 1,
        "found by name": found(family),
        "found by number": found(str(made.get("patientNumber"))),
        "found by phone": found(phone),
        "booked by referral": booked_status == 201 and booked.get("channel") == "REFERRAL",
        "the record lists the visit": [a["appointmentId"] for a in record.get("appointments", [])]
        == [booked.get("appointmentId")],
        "the roster names the clinician": roster_status == 200
        and clinician["staffId"] in roster_raw,
        "the desk cancels with a reason": cancel_status == 200,
        "the manager's week shows it": week.get("total", 0) >= 1,
    }
    print()
    for name, ok in checks.items():
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
