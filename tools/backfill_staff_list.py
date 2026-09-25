"""Put existing staff accounts on the administration console's list.

    python tools/backfill_staff_list.py            say what would change
    python tools/backfill_staff_list.py --write    change it

Staff memberships carry directoryKey and directorySort from 2026-09-25, which
is what GET /admin/staff reads (DirectoryIndex, TENANT#<t>#STAFF). Accounts
created before then have neither, so they would be missing from the list.
This gives each the keys a new membership is created with
(atria.data.people.membership_item), from its person's names. Safe to run
again: a membership that already has the keys is left alone.

Development only: it scans the table, which is fine for a handful of dev
accounts and not something a production table should see.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "backend/src")

import devkit  # noqa: E402
from atria.data.people import staff_list_key, staff_list_sort  # noqa: E402


def main() -> int:
    write = "--write" in sys.argv
    table = devkit.main_table()
    memberships = []
    scan = {
        "FilterExpression": "#t = :m",
        "ExpressionAttributeNames": {"#t": "type"},
        "ExpressionAttributeValues": {":m": "STAFF_MEMBERSHIP"},
    }
    while True:
        page = table.scan(**scan)
        memberships += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            break
        scan["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    changed = 0
    for membership in memberships:
        if membership.get("directoryKey"):
            continue
        person = table.get_item(Key={"pk": f"PERSON#{membership['personId']}", "sk": "PERSON"}).get(
            "Item", {}
        )
        key = staff_list_key(str(membership["tenantId"]))
        sort = staff_list_sort(
            family_name=str(person.get("familyName") or ""),
            given_name=str(person.get("givenName") or ""),
            staff_id=str(membership["staffMembershipId"]),
        )
        print(f"{'set ' if write else 'would set '} {membership['staffMembershipId']}: {sort}")
        if write:
            table.update_item(
                Key={"pk": membership["pk"], "sk": membership["sk"]},
                UpdateExpression="SET directoryKey = :k, directorySort = :s",
                ExpressionAttributeValues={":k": key, ":s": sort},
            )
        changed += 1
    print(f"{changed} of {len(memberships)} memberships {'updated' if write else 'to update'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
