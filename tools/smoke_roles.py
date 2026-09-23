"""Sweep every deployed route with every role, against deployed infrastructure.

    python tools/smoke_roles.py

BR-07: Cognito distinguishes patient and staff access correctly. FR-STF-09: a
staff member sees only their own tenant. This asks each route the same question
as each kind of account and compares the answer with the permission matrix in
atria_spec.roles, so a route that forgot its check shows up as a 200 where the
matrix says 403.

The accounts, all in the development tenant unless named:

    P, Q   two patients, registered through the patient client
    R      a receptionist at clinic C;  R2 a receptionist at another clinic
    A, B   two clinicians at clinic C
    M      a clinic manager at clinic C
    T      the tenant administrator
    X      the administrator of a different tenant
    anon   no token at all;  junk  a token that is not one

The appointment everyone reads is P's, with clinician A, at clinic C.

Write routes are asked with an empty body where a real one would create an
account: a 400 then shows the permission check passed and validation refused,
and a 403 that it did not pass. Everything booked here is cancelled, and the
receptionist R is suspended at the end, which is the last row of the sweep.

Development only, same reasoning as tools/smoke_me.py.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from zoneinfo import ZoneInfo

import devkit
from atria_spec.region_packs import region_pack

RUN = devkit.run_id()
CLINIC = f"c-roles-{RUN}"
OTHER_CLINIC = "c-douala-akwa"
OTHER_TENANT = "t-cm-smoke"
TYPE = f"at-roles-{RUN}"
ZONE = ZoneInfo(region_pack(devkit.REGION_PACK_CODE)["timezone"])

ACTORS = ["P", "Q", "R", "R2", "A", "B", "M", "T", "X", "anon", "junk"]
DENIED = {401, 403}  # no token, or a token the authoriser will not accept
ELSEWHERE = {403, 404}  # another tenant: refused, or not found in theirs

# route -> actor -> the status the matrix calls for. A set allows either.
EXPECTED: dict[str, dict[str, int | set[int]]] = {
    # Anyone signed in may ask who they are and whom they can book.
    "GET /me": dict.fromkeys(["P", "Q", "R", "R2", "A", "B", "M", "T", "X"], 200),
    "GET /clinicians": dict.fromkeys(["P", "Q", "R", "R2", "A", "B", "M", "T", "X"], 200),
    # appointment.read on clinician A at clinic C: a patient for their own
    # booking, staff at C, a clinician for their own diary, the admin tenant-wide.
    "GET /clinicians/A/slots": {
        "P": 200,
        "Q": 200,
        "R": 200,
        "R2": 403,
        "A": 200,
        "B": 403,
        "M": 200,
        "T": 200,
        "X": 404,
    },
    "GET /clinicians/A/calendar": {
        "P": 403,
        "Q": 403,
        "R": 200,
        "R2": 403,
        "A": 200,
        "B": 403,
        "M": 200,
        "T": 200,
        "X": 404,
    },
    "GET /clinics/C/day": {
        "P": 403,
        "Q": 403,
        "R": 200,
        "R2": 403,
        "A": 403,
        "B": 403,
        "M": 200,
        "T": 200,
        "X": 404,
    },
    "GET /appointments/P's": {
        "P": 200,
        "Q": 403,
        "R": 200,
        "R2": 403,
        "A": 200,
        "B": 403,
        "M": 200,
        "T": 200,
        "X": 404,
    },
    # Only an account with a patient profile has "my appointments".
    "GET /patients/me/appointments": {
        "P": 200,
        "Q": 200,
        "R": 400,
        "R2": 400,
        "A": 400,
        "B": 400,
        "M": 400,
        "T": 400,
        "X": 400,
    },
    # staff.* is the tenant administrator's alone. 400 is past the check.
    "POST /admin/staff {}": {
        "P": 403,
        "Q": 403,
        "R": 403,
        "R2": 403,
        "A": 403,
        "B": 403,
        "M": 403,
        "T": 400,
        "X": 400,
    },
    "PATCH /admin/staff/R/roles {}": {
        "P": 403,
        "Q": 403,
        "R": 403,
        "R2": 403,
        "A": 403,
        "B": 403,
        "M": 403,
        "T": 400,
        "X": {400, 404},
    },
    "POST /admin/staff/R/suspend (refusals)": {
        "P": 403,
        "Q": 403,
        "R": 403,
        "R2": 403,
        "A": 403,
        "B": 403,
        "M": 403,
        "X": 404,
    },
    # appointment.create: a patient books for themselves, clinic staff at C,
    # never the administrator (none), never another clinic.
    "POST /appointments with A": {
        "P": 201,
        "Q": 201,
        "R": 201,
        "R2": 403,
        "A": 201,
        "B": 201,
        "M": 201,
        "T": 403,
        "X": ELSEWHERE,
    },
    # appointment.cancel on P's booking, refusals only; P then cancels it.
    "DELETE /appointments/P's (refusals)": {
        "Q": 403,
        "R2": 403,
        "B": 403,
        "T": 403,
        "X": 404,
    },
    "DELETE /appointments/P's": {"P": 200},
    # Each cancels the booking they made. B's was with clinician A, so B's
    # scope, their own diary, does not reach it.
    "DELETE /appointments/own booking": {
        "P": 200,
        "Q": 200,
        "R": 200,
        "A": 200,
        "B": 403,
        "M": 200,
    },
    "POST /admin/staff/R/suspend": {"T": 200},
}
UNAUTHENTICATED = [route for route in EXPECTED if not route.endswith("(refusals)")]


def main() -> int:
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    staff_client = devkit.app_client(idp, pool, "staff")
    base = devkit.api_base()
    table = devkit.main_table()
    print(f"api  {base}\nrun  {RUN}")

    devkit.seed_baseline(table)
    devkit.put_clinic(table, CLINIC, name="Clinique des roles", hours=devkit.every_day_hours())
    devkit.put_clinic(table, OTHER_CLINIC, name="Clinique d'Akwa")
    devkit.put_appointment_type(table, TYPE)

    admin = devkit.admin_token(idp, pool, staff_client)
    staff = {
        "A": devkit.create_staff(base, admin, devkit.clinician_body(CLINIC, RUN, "Etoa")),
        "B": devkit.create_staff(base, admin, devkit.clinician_body(CLINIC, RUN, "Nkoulou")),
        "R": devkit.create_staff(base, admin, devkit.receptionist_body(CLINIC)),
        "R2": devkit.create_staff(base, admin, devkit.receptionist_body(OTHER_CLINIC)),
        "M": devkit.create_staff(base, admin, devkit.receptionist_body(CLINIC, "CLINIC_MANAGER")),
    }
    tokens: dict[str, str | None] = {
        name: devkit.staff_token(idp, pool, staff_client, account)
        for name, account in staff.items()
    }
    tokens["T"] = admin
    tokens["X"] = devkit.admin_token(idp, pool, staff_client, tenant_id=OTHER_TENANT)
    for name in ("P", "Q"):
        email, secret = devkit.register_patient(idp, pool, RUN, f"roles-{name.lower()}")
        tokens[name] = devkit.sign_in(idp, pool, staff_client, email, secret)
    tokens["anon"] = None
    tokens["junk"] = "not-a-token"

    profiles = {}
    for name in ("P", "Q"):
        _status, raw, _h = devkit.call(f"{base}/me", tokens[name])
        profiles[name] = json.loads(raw)["patientProfileId"]
    ids = {name: str(account["staffId"]) for name, account in staff.items()}
    print(f"patients {profiles}\nstaff    {ids}")

    day = (dt.datetime.now(tz=ZONE) + dt.timedelta(days=3)).date()
    booking_day = day + dt.timedelta(days=1)

    def start(slot: int, on: dt.date) -> str:
        """A 40 minute slot from 08:00 local, so no two bookings here collide."""
        opens = dt.datetime.combine(on, dt.time(8, 0), tzinfo=ZONE)
        at = (opens + dt.timedelta(minutes=40 * slot)).astimezone(dt.UTC)
        return at.strftime("%Y-%m-%dT%H:%M:%SZ")

    def book(token: str | None, patient: str | None, clinician: str, at: str) -> tuple[int, str]:
        body = {"appointmentTypeId": TYPE, "clinicianProfileId": clinician, "startAt": at}
        if patient:
            body |= {"patientProfileId": patient, "channel": "PHONE"}
        status, raw, _h = devkit.call(f"{base}/appointments", token, method="POST", body=body)
        return status, raw

    status, raw = book(tokens["R"], profiles["P"], ids["A"], start(0, day))
    if status != 201:
        raise SystemExit(f"could not book P's appointment: {status} {raw}")
    p_appointment = json.loads(raw)["appointmentId"]
    print(f"P's appointment {p_appointment} with A on {day}")

    paths = {
        "GET /me": ("GET", "/me", None),
        "GET /clinicians": ("GET", "/clinicians", None),
        "GET /clinicians/A/slots": (
            "GET",
            f"/clinicians/{ids['A']}/slots?date={day}&typeId={TYPE}",
            None,
        ),
        "GET /clinicians/A/calendar": (
            "GET",
            f"/clinicians/{ids['A']}/calendar?from={day}&to={day}",
            None,
        ),
        "GET /clinics/C/day": ("GET", f"/clinics/{CLINIC}/day?date={day}", None),
        "GET /appointments/P's": ("GET", f"/appointments/{p_appointment}", None),
        "GET /patients/me/appointments": ("GET", "/patients/me/appointments", None),
        "POST /admin/staff {}": ("POST", "/admin/staff", {}),
        "PATCH /admin/staff/R/roles {}": ("PATCH", f"/admin/staff/{ids['R']}/roles", {}),
        "POST /admin/staff/R/suspend (refusals)": (
            "POST",
            f"/admin/staff/{ids['R']}/suspend",
            None,
        ),
        "DELETE /appointments/P's (refusals)": (
            "DELETE",
            f"/appointments/{p_appointment}",
            {"cancelledBy": "CLINIC", "reason": "role sweep"},
        ),
    }
    got: dict[str, dict[str, int]] = {route: {} for route in EXPECTED}

    def ask(route: str, actor: str) -> int:
        method, path, body = paths[route]
        status, _raw, _h = devkit.call(f"{base}{path}", tokens[actor], method=method, body=body)
        return status

    for route in paths:
        for actor in EXPECTED[route]:
            got[route][actor] = ask(route, actor)

    # Bookings, each at its own start, then each cancelled by whoever made it.
    made: dict[str, str] = {}
    for slot, actor in enumerate(EXPECTED["POST /appointments with A"], start=1):
        patient = None if actor in ("P", "Q") else profiles["P"]
        status, raw = book(tokens[actor], patient, ids["A"], start(slot, booking_day))
        got["POST /appointments with A"][actor] = status
        if status == 201:
            made[actor] = json.loads(raw)["appointmentId"]

    got["DELETE /appointments/P's"]["P"] = devkit.call(
        f"{base}/appointments/{p_appointment}", tokens["P"], method="DELETE"
    )[0]
    for actor in EXPECTED["DELETE /appointments/own booking"]:
        if actor in made:
            got["DELETE /appointments/own booking"][actor] = devkit.call(
                f"{base}/appointments/{made[actor]}",
                tokens[actor],
                method="DELETE",
                body=None if actor in ("P", "Q") else {"cancelledBy": "CLINIC"},
            )[0]
    # Whatever is left, the receptionist clears, so nothing stays booked.
    for actor, appointment in made.items():
        if got["DELETE /appointments/own booking"].get(actor) != 200:
            devkit.call(
                f"{base}/appointments/{appointment}",
                tokens["R"],
                method="DELETE",
                body={"cancelledBy": "CLINIC", "reason": "role sweep clean-up"},
            )

    # No token, and a junk one, on every route that takes one.
    unauthenticated: dict[str, dict[str, int]] = {}
    for route in UNAUTHENTICATED:
        if route in paths:
            unauthenticated[route] = {actor: ask(route, actor) for actor in ("anon", "junk")}

    got["POST /admin/staff/R/suspend"]["T"] = devkit.call(
        f"{base}/admin/staff/{ids['R']}/suspend", tokens["T"], method="POST"
    )[0]

    failures = 0
    width = max(len(route) for route in EXPECTED)
    print(f"\n{'route':<{width}}  " + "  ".join(f"{a:>4}" for a in ACTORS[:-2]))
    for route, expected in EXPECTED.items():
        cells = []
        for actor in ACTORS[:-2]:
            if actor not in expected:
                cells.append(f"{'':>4}")
                continue
            want, status = expected[actor], got[route].get(actor)
            ok = status in want if isinstance(want, set) else status == want
            failures += not ok
            cells.append(f"{status:>4}" if ok else f"{'!' + str(status):>4}")
        print(f"{route:<{width}}  " + "  ".join(cells))
        for actor in ACTORS[:-2]:
            if actor in expected:
                want, status = expected[actor], got[route].get(actor)
                if not (status in want if isinstance(want, set) else status == want):
                    print(f"    {actor}: got {status}, the matrix calls for {want}")

    refused_unauthenticated = all(
        status in DENIED for row in unauthenticated.values() for status in row.values()
    )
    print(
        f"\nno token or a junk token, {len(unauthenticated)} routes: "
        + ("all refused" if refused_unauthenticated else f"NOT all refused: {unauthenticated}")
    )
    failures += not refused_unauthenticated

    checked = sum(len(row) for row in EXPECTED.values()) + 2 * len(unauthenticated)
    print()
    if failures == 0:
        print(f"BR-07 holds: {checked} route and role pairs answered as the matrix says")
        return 0
    print(f"BR-07 does not hold: {failures} of {checked} answers differ from the matrix")
    return 1


if __name__ == "__main__":
    sys.exit(main())
