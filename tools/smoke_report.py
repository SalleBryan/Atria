"""The fee ledger and the weekly report, end to end, against deployed infrastructure.

    python tools/smoke_report.py

On the smoke tenant: the desk books a patient by referral and reads the
cancellation preview, cancels, and the visit then carries its ledger entry;
the unit manager reads the unit's week, the administrator every unit's, and
the desk is refused. Development only.
"""

from __future__ import annotations

import json
import sys

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

    family = "Smoke" + sb.RUN.translate(str.maketrans("0123456789", "ghijklmnop"))
    _, made_raw = sb.call(
        f"{base}/patients",
        desk,
        method="POST",
        body={"givenName": "Test", "familyName": family, "phoneE164": sb.phone()},
    )
    pid = json.loads(made_raw).get("patientProfileId")
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
    aid = json.loads(booked_raw).get("appointmentId") if booked_status == 201 else None
    _, before_raw = sb.call(f"{base}/appointments/{aid}", desk)
    before = json.loads(before_raw)
    cancel_status, _ = sb.call(
        f"{base}/appointments/{aid}",
        desk,
        method="DELETE",
        body={"cancelledBy": "PATIENT", "reason": "smoke: patient phoned"},
    )
    _, after_raw = sb.call(f"{base}/appointments/{aid}", desk)
    after = json.loads(after_raw)
    unit_status, unit_raw = sb.call(f"{base}/clinics/{sb.CLINIC_ID}/report", manager)
    unit = json.loads(unit_raw) if unit_status == 200 else {}
    desk_status, _ = sb.call(f"{base}/clinics/{sb.CLINIC_ID}/report", desk)
    every_status, every_raw = sb.call(f"{base}/reports", admin)
    every = json.loads(every_raw) if every_status == 200 else {}

    ledger = after.get("ledger") or {}
    checks = {
        "booked by referral": booked_status == 201,
        "the cancel preview names an entitlement": (before.get("cancellationPreview") or {}).get(
            "entitlement"
        )
        in ("FULL", "PARTIAL"),
        "the desk cancels": cancel_status == 200,
        "the visit carries its ledger entry": ledger.get("outcome")
        in ("CANCELLED_IN_WINDOW", "CANCELLED_LATE")
        and ledger.get("settledAt") is None,
        "the manager reads the unit's week": unit_status == 200
        and {"booked", "attendance", "byChannel", "byReminder", "ledger"} <= unit.keys(),
        "the desk is refused": desk_status == 403,
        "the administrator reads every unit": every_status == 200
        and isinstance(every.get("units"), list),
        "no saving is claimed": "sav" not in (unit_raw + every_raw).lower(),
    }
    print()
    for name, ok in checks.items():
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
