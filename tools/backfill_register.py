"""Give every existing patient a number and register entries (atria.data.register).

    python tools/backfill_register.py

Patients registered before the register existed have neither. Each profile of
the development tenant is read with its person; one without a number gets the
next from the tenant's counter, and its entries are written. Running it again
changes nothing. Development only.
"""

from __future__ import annotations

import devkit
from atria.data import keys, register
from atria.data.repository import Repository
from boto3.dynamodb.conditions import Attr


def main() -> int:
    table = devkit.main_table()
    repo = Repository(table=table)
    tenant = repo.get(keys.tenant(devkit.TENANT_ID)) or {}
    prefix = str(tenant.get("patientNumberPrefix") or register.DEFAULT_PREFIX)
    store = register.Register(repo)
    scan: dict = {
        "FilterExpression": Attr("type").eq("PATIENT_PROFILE")
        & Attr("tenantId").eq(devkit.TENANT_ID)
    }
    profiles = []
    while True:
        page = table.scan(**scan)
        profiles += page["Items"]
        if "LastEvaluatedKey" not in page:
            break
        scan["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    profiles.sort(key=lambda p: str(p.get("createdAt") or ""))
    numbered = 0
    for profile in profiles:
        pid = str(profile["patientProfileId"])
        person = repo.get(keys.person(str(profile.get("personId") or ""))) or {}
        number = profile.get("patientNumber")
        if not number:
            number = store.next_number(devkit.TENANT_ID, prefix)
            repo.update_existing(
                keys.patient_profile(devkit.TENANT_ID, pid),
                set_values={"patientNumber": number},
                what="patient",
            )
            numbered += 1
        store.replace(
            devkit.TENANT_ID,
            pid,
            register.entries(
                tenant_id=devkit.TENANT_ID,
                patient_profile_id=pid,
                person_id=str(profile.get("personId") or ""),
                given_name=str(person.get("givenName") or ""),
                family_name=str(person.get("familyName") or ""),
                phone_e164=person.get("phoneE164") or None,
                patient_number=str(number),
                date_of_birth=person.get("dateOfBirth"),
            ),
        )
    print(f"{len(profiles)} patients in the register, {numbered} newly numbered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
