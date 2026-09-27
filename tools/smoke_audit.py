"""The audit trail, end to end, against deployed infrastructure.

    python tools/smoke_audit.py

On the smoke tenant (tools/smoke_booking.py seeds it), through the API:

1. the front desk books, opens and lists a patient's visit, and each of the
   three leaves an entry naming the desk, the patient and the source
   (FR-PRV-06);
2. the unit manager reads those entries, filtered to the desk, and the front
   desk is refused the log (FR-ADM-04);
3. the listing counts patients rather than naming them, and the export names
   them and is itself recorded (FR-ADM-05);

and, from IAM's own policy simulator, that the functions cannot change or
remove an entry while the read only directory can add one and nothing else.

Development only.
"""

from __future__ import annotations

import datetime as dt
import json
import sys

import boto3
import smoke_booking as sb


def simulate(iam, role_arn: str, action: str, table_arn: str, partition: str) -> str:  # noqa: ANN001
    result = iam.simulate_principal_policy(
        PolicySourceArn=role_arn,
        ActionNames=[action],
        ResourceArns=[table_arn],
        ContextEntries=[
            {
                "ContextKeyName": "dynamodb:LeadingKeys",
                "ContextKeyValues": [partition],
                "ContextKeyType": "stringList",
            }
        ],
    )
    return str(result["EvaluationResults"][0]["EvalDecision"])


def role_of(function: str) -> str:
    client = boto3.client("lambda", region_name=sb.REGION)
    return str(client.get_function_configuration(FunctionName=function)["Role"])


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
        specialty="Paediatrics",
        registrationYear=2012,
        ordreNumber=f"CM-ONMC-{sb.RUN}",
        languages=["en"],
    )
    desk = staff("Receptionist", ["RECEPTIONIST"])
    manager = staff("Manager", ["CLINIC_MANAGER"])
    desk_token = sb.sign_in_as(idp, pool_id, staff_client, desk)
    manager_token = sb.sign_in_as(idp, pool_id, staff_client, manager)
    desk_id = str(desk["staffId"])
    print(f"run {sb.RUN}: desk {desk_id}")

    start = sb.start_at()
    booked_status, booked_raw = sb.call(
        f"{base}/appointments",
        desk_token,
        method="POST",
        body={
            "patientProfileId": sb.PATIENT_PROFILE_ID,
            "appointmentTypeId": sb.APPOINTMENT_TYPE_ID,
            "clinicianProfileId": clinician["staffId"],
            "startAt": start,
            "channel": "PHONE",
            "callbackPhone": "+12025550199",
        },
    )
    visit = json.loads(booked_raw)
    read_status, _ = sb.call(f"{base}/appointments/{visit.get('appointmentId')}", desk_token)
    day_status, _ = sb.call(f"{base}/clinics/{sb.CLINIC_ID}/day?date={start[:10]}", desk_token)

    today = dt.datetime.now(tz=dt.UTC).date().isoformat()
    window = f"from={today}&to={today}"
    listed_status, listed_raw = sb.call(f"{base}/audit?{window}&actor={desk_id}", manager_token)
    listed = json.loads(listed_raw) if listed_status == 200 else {}
    actions = {e.get("action"): e for e in listed.get("entries", [])}
    desk_refused, _ = sb.call(f"{base}/audit?{window}", desk_token)
    export_status, export_raw = sb.call(f"{base}/audit/export?{window}&actor={desk_id}", admin)
    after_status, after_raw = sb.call(f"{base}/audit?{window}&action=audit.export", admin)
    exports = json.loads(after_raw).get("entries", []) if after_status == 200 else []
    print(f"entries for the desk: {sorted(a for a in actions if a)}")

    iam = boto3.client("iam")
    table_arn = str(table.table_arn)
    audit_key = f"TENANT#{sb.TENANT_ID}#AUDIT#{today}"
    booking_role = role_of(f"{sb.PREFIX}-bookingservice")
    directory_role = role_of(f"{sb.PREFIX}-directoryservice")

    checks = {
        "the desk books, opens and lists the visit": (booked_status, read_status, day_status)
        == (201, 200, 200),
        "each is an entry": {"appointment.create", "appointment.read", "schedule.day"}
        <= set(actions),
        "naming the patient by count, the unit and the source": all(
            e.get("patientCount") == 1
            and e.get("clinicId") == sb.CLINIC_ID
            and e.get("source", {}).get("ip")
            for name, e in actions.items()
            if name in ("appointment.create", "appointment.read")
        ),
        "and never by name or record": sb.PATIENT_PROFILE_ID not in listed_raw,
        "the front desk cannot read the log": desk_refused == 403,
        "the export is a CSV naming the patient": export_status == 200
        and export_raw.startswith("occurredAt,")
        and sb.PATIENT_PROFILE_ID in export_raw,
        "and is itself recorded": bool(exports),
        "a writing function cannot change an entry": simulate(
            iam, booking_role, "dynamodb:UpdateItem", table_arn, audit_key
        )
        == "explicitDeny",
        "or remove one": simulate(iam, booking_role, "dynamodb:DeleteItem", table_arn, audit_key)
        == "explicitDeny",
        "the directory can add an entry": simulate(
            iam, directory_role, "dynamodb:PutItem", table_arn, audit_key
        )
        == "allowed",
        "and nothing else": simulate(
            iam,
            directory_role,
            "dynamodb:PutItem",
            table_arn,
            f"TENANT#{sb.TENANT_ID}#APPT#anything",
        )
        != "allowed",
    }
    print()
    for name, ok in checks.items():
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
