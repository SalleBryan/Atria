"""Seed the development tenant from the Cameroon region pack (FR-TEN-08).

Writes the region pack exactly as the specification defines it, the tenant
that self-registering patients join, two clinics in real regions of the pack,
and the three appointment types, one per service line. Nothing here touches
Cognito or creates staff: staff accounts are created through POST /admin/staff,
which is the path the smoke scripts exercise.

Every write is a put with a fixed key, so running this again restores the
records rather than duplicating them.

    python tools/seed_dev.py
"""

from __future__ import annotations

import devkit
from atria_spec.region_packs import region_pack

CLINICS = {
    "c-douala-akwa": {"name": "Clinique d'Akwa", "city": "Douala", "region": "Littoral"},
    "c-yaounde-bastos": {"name": "Centre medical de Bastos", "city": "Yaounde", "region": "Centre"},
}

APPOINTMENT_TYPES = {
    "at-gen-consult": "GEN_CONSULT",
    "at-spec-first": "SPEC_FIRST",
    "at-minor-proc": "MINOR_PROC",
}


def main() -> int:
    table = devkit.main_table()
    pack = devkit.put_region_pack(table)
    unconfirmed = sorted(set(region_pack(pack["code"])) - set(pack))
    print(f"region pack {pack['code']}, timezone {pack['timezone']}, unconfirmed: {unconfirmed}")
    tenant = devkit.put_tenant(table)
    print(f"tenant {tenant['tenantId']} on the {tenant['regionPackCode']} pack")
    for clinic_id, clinic in CLINICS.items():
        devkit.put_clinic(table, clinic_id, **clinic)
        print(f"clinic {clinic_id}: {clinic['name']}, {clinic['city']}")
    for type_id, code in APPOINTMENT_TYPES.items():
        devkit.put_appointment_type(table, type_id, code=code)
        print(f"appointment type {type_id}: {code}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
