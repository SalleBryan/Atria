"""Seed the development tenant from the Cameroon region pack (FR-TEN-08).

Writes the region pack exactly as the specification defines it, the tenant
that self-registering patients join, two clinics in real regions of the pack,
and the three appointment types, one per service line. Every table write is a
put with a fixed key, so running this again restores the records rather than
duplicating them.

Then it makes sure the directory has a believable set of clinicians to book,
created through POST /admin/staff as a tenant administrator would. Each is
created only if nobody of that name already practises at that clinic, so this
too can be run again. Every name is invented and every number is fictional.

    python tools/seed_dev.py            seed, and add any missing clinicians
    python tools/seed_dev.py --tidy     also suspend the clinicians the smoke
                                        scripts left behind, so the directory
                                        shows only the ones below

Suspending takes a clinician out of the directory and leaves their records;
nothing is deleted.
"""

from __future__ import annotations

import json
import sys

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

# (given name, family name, specialty, year on the Order's roll, clinic, languages)
CLINICIANS = (
    ("Esther", "Mbarga", "Paediatrics", 2008, "c-douala-akwa", ["fr", "en"]),
    ("Jean-Paul", "Nkoulou", "Cardiology", 1999, "c-douala-akwa", ["fr"]),
    ("Grace", "Fonkou", "Ophthalmology", 2019, "c-douala-akwa", ["en", "fr"]),
    ("Aicha", "Bello", "Dermatology", 2015, "c-yaounde-bastos", ["fr", "en"]),
    ("Samuel", "Tchoupo", "Gynaecology", 2011, "c-yaounde-bastos", ["fr"]),
)


def seed_table() -> None:
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


def main(argv: list[str]) -> int:
    seed_table()
    seed_clinicians(tidy="--tidy" in argv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
