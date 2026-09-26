"""Mark active the staff accounts that have already set their own password.

    python tools/backfill_activation.py            say what would change
    python tools/backfill_activation.py --write    change it

From 2026-09-25 an INVITED account becomes ACTIVE at its first GET /me
(atria.services.identity.handler), and the administration console reads that
status instead of asking the user pool about every account. Accounts that
signed in before then are CONFIRMED in the pool but still INVITED in the
table, so the console would show them as awaiting their first sign-in. This
asks the pool once per INVITED account and activates the confirmed ones the
same way the API does (atria.data.people.People.activate). Safe to run again.

Development only: it scans the table, which is fine for a handful of dev
accounts and not something a production table should see.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "backend/src")

import devkit  # noqa: E402
from atria.data.people import People  # noqa: E402
from atria.data.repository import Repository  # noqa: E402


def main() -> int:
    write = "--write" in sys.argv
    table = devkit.main_table()
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    people = People(Repository(table))

    memberships = []
    scan = {
        "FilterExpression": "#t = :m AND #s = :i",
        "ExpressionAttributeNames": {"#t": "type", "#s": "status"},
        "ExpressionAttributeValues": {":m": "STAFF_MEMBERSHIP", ":i": "INVITED"},
    }
    while True:
        page = table.scan(**scan)
        memberships += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            break
        scan["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    changed = 0
    for membership in memberships:
        person = table.get_item(Key={"pk": f"PERSON#{membership['personId']}", "sk": "PERSON"}).get(
            "Item", {}
        )
        name = person.get("email") or person.get("phoneE164")
        if not name:
            continue
        try:
            status = idp.admin_get_user(UserPoolId=pool, Username=str(name))["UserStatus"]
        except idp.exceptions.UserNotFoundException:
            continue
        if status != "CONFIRMED":
            continue
        staff_id = str(membership["staffMembershipId"])
        print(f"{'activate' if write else 'would activate'} {staff_id} ({name})")
        if write:
            people.activate(tenant_id=str(membership["tenantId"]), staff_id=staff_id)
        changed += 1
    done = "activated" if write else "to activate"
    print(f"{changed} of {len(memberships)} invited accounts {done}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
