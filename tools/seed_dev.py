"""Seed the development tenant as the Regional Hospital Buea (FR-TEN-08).

Writes the region pack exactly as the specification defines it, the tenant
with its agreed settings, the hospital's outpatient units, the fee bands and
the appointment types, all from atria_spec.hospital. Every table write has a
fixed key, and what an administrator may since have changed (a fee band's
amount, a setting, the region pack lock) is kept, so running this again
restores the hospital rather than resetting it.

Then it makes sure the staff exist: the clinicians, the front desk and the
unit managers, created through POST /admin/staff as a tenant administrator
would. Each is created only if nobody of that name already works at that
unit, so this too can be run again. Every name is invented and every number
is fictional: no staff roster of the hospital is published, and none is used.

    python tools/seed_dev.py            seed, and add any missing staff
    python tools/seed_dev.py --tidy     also suspend the clinicians the smoke
                                        scripts left behind and unlist their
                                        units and appointment types, so the
                                        directory shows only the hospital's

Suspending takes a clinician out of the directory and leaves their records,
and unlisting a unit or type only drops its directory keys; nothing is
deleted.
"""

from __future__ import annotations

import json
import sys

import devkit
from atria_spec import hospital
from atria_spec.region_packs import region_pack
from boto3.dynamodb.conditions import Attr, Key

# Everything below comes from atria_spec.hospital: the Regional Hospital
# Buea's units as the public record describes them, the agreed fee bands and
# appointment types, and an invented staff.
CLINICS = {unit["clinicId"]: unit for unit in hospital.UNITS}
APPOINTMENT_TYPES = {t["appointmentTypeId"]: t for t in hospital.APPOINTMENT_TYPES}
CLINICIANS = hospital.CLINICIANS


def unlist_leftovers(table: object, kind: str, keep: set[str], id_field: str) -> None:
    """Take the smoke scripts' clinics or types out of the directory."""
    listed = table.query(  # type: ignore[attr-defined]
        IndexName="DirectoryIndex",
        KeyConditionExpression=Key("directoryKey").eq(f"TENANT#{devkit.TENANT_ID}#{kind}"),
    )["Items"]
    for item in listed:
        if item[id_field] in keep:
            continue
        table.update_item(  # type: ignore[attr-defined]
            Key={"pk": item["pk"], "sk": item["sk"]},
            UpdateExpression="REMOVE directoryKey, directorySort",
        )
        print(f"unlisted {kind.lower()} {item[id_field]}: {item.get('name')}")


def put_fee_band(table: object, band: dict) -> None:
    """The band's first version, unless an administrator has already set one."""
    pk = f"TENANT#{devkit.TENANT_ID}#FEE#{band['feeBandId']}"
    versions = table.query(KeyConditionExpression=Key("pk").eq(pk))["Items"]  # type: ignore[attr-defined]
    if versions:
        return
    table.put_item(  # type: ignore[attr-defined]
        Item={
            "pk": pk,
            "sk": "FROM#2026-09-26",
            "type": "FEE_BAND",
            "tenantId": devkit.TENANT_ID,
            **band,
            "scheduleReference": hospital.FEE_SCHEDULE_REFERENCE,
            "effectiveFrom": "2026-09-26",
            "directoryKey": f"TENANT#{devkit.TENANT_ID}#FEE",
            "directorySort": band["feeBandId"],
        }
    )


def lock_region_pack(table: object, tenant: dict) -> None:
    """Record the first appointment the development tenant already has (FR-TEN-07).

    It took bookings before the lock existed, so the date is found once here;
    from then on the booking service records it.
    """
    if tenant.get("firstAppointmentAt"):
        return
    earliest = None
    scan: dict = {
        "FilterExpression": Attr("type").eq("APPOINTMENT") & Attr("tenantId").eq(devkit.TENANT_ID),
        "ProjectionExpression": "createdAt",
    }
    while True:
        page = table.scan(**scan)  # type: ignore[attr-defined]
        for item in page["Items"]:
            created = item.get("createdAt")
            if created and (earliest is None or created < earliest):
                earliest = created
        if "LastEvaluatedKey" not in page:
            break
        scan["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    if earliest:
        table.update_item(  # type: ignore[attr-defined]
            Key={"pk": f"TENANT#{devkit.TENANT_ID}", "sk": "META"},
            UpdateExpression="SET firstAppointmentAt = :t",
            ExpressionAttributeValues={":t": earliest},
        )
        print(f"region pack locked since the first appointment, {earliest}")


def seed_table(*, tidy: bool) -> None:
    table = devkit.main_table()
    pack = devkit.put_region_pack(table)
    unconfirmed = sorted(set(region_pack(pack["code"])) - set(pack))
    print(f"region pack {pack['code']}, timezone {pack['timezone']}, unconfirmed: {unconfirmed}")
    tenant = devkit.put_tenant(table)
    print(f"tenant {tenant['tenantId']} on the {tenant['regionPackCode']} pack")
    lock_region_pack(table, tenant)
    for clinic_id, unit in CLINICS.items():
        devkit.put_clinic(
            table,
            clinic_id,
            name=unit["name"],
            address=hospital.ADDRESS,
            region=hospital.REGION,
            hours=unit["openingHours"],
            description=unit["description"],
            services=unit["services"],
        )
        print(f"unit {clinic_id}: {unit['name']}")
    for band in hospital.FEE_BANDS:
        put_fee_band(table, band)
        print(f"fee band {band['feeBandId']}: {band['baseAmountMinor']} XAF")
    for type_id, spec in APPOINTMENT_TYPES.items():
        fields = {k: v for k, v in spec.items() if k not in ("appointmentTypeId", "code")}
        devkit.put_appointment_type(table, type_id, code=spec["code"], **fields)
        print(f"appointment type {type_id}: {spec['name']}")
    if tidy:
        unlist_leftovers(table, "CLINIC", set(CLINICS), "clinicId")
        unlist_leftovers(table, "TYPE", set(APPOINTMENT_TYPES), "appointmentTypeId")


def seed_clinicians(*, tidy: bool) -> None:
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    base = devkit.api_base()
    admin = devkit.admin_token(idp, pool, devkit.app_client(idp, pool, "staff"))

    status, raw, _headers = devkit.call(f"{base}/clinicians", admin)
    if status != 200:
        raise SystemExit(f"could not read the directory: {status} {raw}")
    listed = json.loads(raw)["clinicians"]
    present = {
        (c["givenName"], c["familyName"], c["clinicId"]): c["clinicianProfileId"] for c in listed
    }

    keep = set()
    for given, family, specialty, year, clinic, languages in CLINICIANS:
        if clinic not in CLINICS:
            raise SystemExit(f"{given} {family} works at {clinic}, which is not a unit")
        existing = present.get((given, family, clinic))
        if existing:
            keep.add(existing)
            print(f"clinician Dr {given} {family}, {specialty}: already listed")
            continue
        account = devkit.create_staff(
            base,
            admin,
            {
                "givenName": given,
                "familyName": family,
                "phoneE164": devkit.fictional_phone(),
                "clinicId": clinic,
                "roles": ["CLINICIAN"],
                "specialty": specialty,
                "registrationYear": year,
                "ordreNumber": f"CM-ONMC-DEV-{family.upper()}",
                "languages": languages,
            },
        )
        keep.add(str(account["staffId"]))
        print(f"clinician Dr {given} {family}, {specialty}: created")

    if not tidy:
        leftovers = len([c for c in listed if c["clinicianProfileId"] not in keep])
        if leftovers:
            print(f"{leftovers} other clinicians are listed; --tidy suspends them")
        return
    for clinician in listed:
        staff_id = clinician["clinicianProfileId"]
        if staff_id in keep:
            continue
        status, raw, _headers = devkit.call(
            f"{base}/admin/staff/{staff_id}/suspend", admin, method="POST"
        )
        name = f"{clinician['givenName']} {clinician['familyName']}"
        print(
            f"suspended {name} ({staff_id}): {status}"
            if status == 200
            else f"could not suspend {name}: {raw}"
        )


def seed_desk_and_managers() -> None:
    """The front desk and unit managers, each once."""
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    base = devkit.api_base()
    admin = devkit.admin_token(idp, pool, devkit.app_client(idp, pool, "staff"))
    present: set[tuple[str, str, str]] = set()
    cursor = ""
    while True:
        status, raw, _headers = devkit.call(f"{base}/admin/staff?limit=50{cursor}", admin)
        if status != 200:
            raise SystemExit(f"could not read the staff list: {status} {raw}")
        page = json.loads(raw)
        present |= {
            (str(a["givenName"]), str(a["familyName"]), str(a.get("clinicId")))
            for a in page["accounts"]
        }
        if not page.get("nextCursor"):
            break
        cursor = f"&cursor={page['nextCursor']}"
    for given, family, clinic, role in hospital.DESK_AND_MANAGERS:
        if (given, family, clinic) in present:
            print(f"{role.lower()} {given} {family}: already there")
            continue
        devkit.create_staff(
            base,
            admin,
            {
                "givenName": given,
                "familyName": family,
                "phoneE164": devkit.fictional_phone(),
                "clinicId": clinic,
                "roles": [role],
            },
        )
        print(f"{role.lower()} {given} {family} at {clinic}: created")


def main(argv: list[str]) -> int:
    seed_table(tidy="--tidy" in argv)
    seed_clinicians(tidy="--tidy" in argv)
    seed_desk_and_managers()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
