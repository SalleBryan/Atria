"""Move the development data onto the Regional Hospital of Buea's units.

    python tools/migrate_units.py            say what would move
    python tools/migrate_units.py --write    move it

Until 2026-09-26 the development tenant had two invented clinics, Akwa
Clinic (c-douala-akwa) and Bastos Medical Centre (c-yaounde-bastos). It is
now the Regional Hospital of Buea, whose outpatient units are the clinics
(tools/seed_dev.py). This moves what points at the old two:

- each seeded clinician, by family name, to the unit of their specialty, on
  both the membership and the clinician profile the directory reads;
- every other active staff account at an old clinic (the front desk and
  manager test logins among them) to the Medical Outpatient Unit;
- every appointment with a moved clinician to that clinician's unit, with
  the clinicDay key the day lists are read by.

Each person's membership summary, which the sign-in token is built from,
moves with them, so a moved account sees its new unit at its next sign-in.
Run `python tools/seed_dev.py --tidy` afterwards to take the old clinics
out of the directory. Safe to run again: nothing already moved is touched.
Development only: it scans the table.
"""

from __future__ import annotations

import sys
from typing import Any

sys.path.insert(0, "backend/src")

import devkit  # noqa: E402
from atria.data.people import People  # noqa: E402
from atria.data.repository import Repository  # noqa: E402

OLD = {"c-douala-akwa", "c-yaounde-bastos"}
BY_FAMILY = {
    "Mbarga": "u-rhb-paediatrics",
    "Nkoulou": "u-rhb-medicine",
    "Bello": "u-rhb-medicine",
    "Tchoupo": "u-rhb-maternity",
    "Fonkou": "u-rhb-eye",
}
EVERYONE_ELSE = "u-rhb-medicine"


def scan(table: Any, kind: str) -> list[dict]:  # noqa: ANN401  a boto3 Table
    items: list[dict] = []
    request = {
        "FilterExpression": "#t = :k",
        "ExpressionAttributeNames": {"#t": "type"},
        "ExpressionAttributeValues": {":k": kind},
    }
    while True:
        page = table.scan(**request)
        items += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return items
        request["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def main() -> int:
    write = "--write" in sys.argv
    table = devkit.main_table()
    people = People(Repository(table))
    verb = "move" if write else "would move"

    moved: dict[str, str] = {}
    for membership in scan(table, "STAFF_MEMBERSHIP"):
        active = membership.get("status") in ("INVITED", "ACTIVE")
        if membership.get("clinicId") not in OLD or not active:
            continue
        person = table.get_item(Key={"pk": f"PERSON#{membership['personId']}", "sk": "PERSON"}).get(
            "Item", {}
        )
        clinician = "CLINICIAN" in membership.get("roles", [])
        family = str(person.get("familyName") or "")
        if clinician and family not in BY_FAMILY:
            continue  # a clinician the smoke scripts made; --tidy suspends those
        unit = BY_FAMILY[family] if clinician else EVERYONE_ELSE
        staff_id = str(membership["staffMembershipId"])
        tenant_id = str(membership["tenantId"])
        print(f"{verb} {person.get('givenName')} {family} ({staff_id}) to {unit}")
        moved[staff_id] = unit
        if not write:
            continue
        table.update_item(
            Key={"pk": membership["pk"], "sk": membership["sk"]},
            UpdateExpression="SET clinicId = :u",
            ExpressionAttributeValues={":u": unit},
        )
        if clinician:
            table.update_item(
                Key={"pk": membership["pk"], "sk": "CLINICIAN"},
                UpdateExpression="SET clinicId = :u",
                ConditionExpression="attribute_exists(pk)",
                ExpressionAttributeValues={":u": unit},
            )
        people._sync_person(str(membership["personId"]), people.staff(tenant_id, staff_id))

    appointments = 0
    for appointment in scan(table, "APPOINTMENT"):
        unit = moved.get(str(appointment.get("clinicianProfileId")))
        if not unit or appointment.get("clinicId") not in OLD:
            continue
        day = str(appointment.get("clinicDay", "#")).split("#", 1)[1]
        appointments += 1
        if write:
            table.update_item(
                Key={"pk": appointment["pk"], "sk": appointment["sk"]},
                UpdateExpression="SET clinicId = :u, clinicDay = :d",
                ExpressionAttributeValues={":u": unit, ":d": f"{unit}#{day}"},
            )
    done = "moved" if write else "to move"
    print(f"{len(moved)} accounts and {appointments} appointments {done}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
