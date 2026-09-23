"""Book an appointment end to end, against deployed infrastructure.

    python tools/smoke_booking.py

Creates a clinician and a receptionist through the real staff API, signs in as
the receptionist, and books the clinician through POST /appointments. Then asks
for the same start a second time, which must come back 409 with nothing
written: that second call is the point of this script, because the slot lock
transaction is the part that cannot be proven by a single happy path.

Finally it counts the lock items in DynamoDB, which is what makes the claim
concrete: N grid units for a type of N units, and not one more after the
refused second attempt.

Development only, same reasoning as tools/smoke_me.py: the admin password auth
flow is enabled for dev alone, and every record here is synthetic.

A tenant, an appointment type and a patient profile have no endpoints yet, so
this script writes those three directly to the table. Everything the booking
path itself does goes through the API.
"""

from __future__ import annotations

import datetime as dt
import json
import secrets
import sys
import time
import urllib.error
import urllib.request

import boto3

REGION = "us-east-1"
PREFIX = "atria-dev"

ADMIN_USERNAME = "smoke.admin@atria.invalid"
TENANT_ID = "t-cm-smoke"
CLINIC_ID = "c-smoke-01"

# A fresh run must not collide with the locks an earlier run left behind, so
# the identifiers and the start time are unique per run.
RUN = secrets.token_hex(4)
PATIENT_PROFILE_ID = f"pp-smoke-{RUN}"
PERSON_ID = f"p-smoke-{RUN}"
APPOINTMENT_TYPE_ID = f"at-smoke-{RUN}"

GRID_UNIT_MINUTES = 10
DURATION_UNITS = 3
BUFFER_UNITS = 1


def phone() -> str:
    """A synthetic Cameroon mobile number that no earlier run has used."""
    return f"+2376{secrets.randbelow(10**8):08d}"


def start_at() -> str:
    """A start on a grid boundary, inside the type's notice and booking window."""
    when = dt.datetime.now(tz=dt.UTC) + dt.timedelta(days=1 + secrets.randbelow(20))
    when = when.replace(minute=(secrets.randbelow(6) * GRID_UNIT_MINUTES), second=0, microsecond=0)
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def find_user_pool(idp) -> str:  # noqa: ANN001  boto3 client
    paginator = idp.get_paginator("list_user_pools")
    for page in paginator.paginate(MaxResults=60):
        for pool in page["UserPools"]:
            if pool["Name"] == f"{PREFIX}-users":
                return str(pool["Id"])
    raise SystemExit(f"no user pool named {PREFIX}-users in {REGION}")


def find_client(idp, pool_id: str, suffix: str) -> str:  # noqa: ANN001  boto3 client
    paginator = idp.get_paginator("list_user_pool_clients")
    for page in paginator.paginate(UserPoolId=pool_id, MaxResults=60):
        for client in page["UserPoolClients"]:
            if client["ClientName"] == f"{PREFIX}-{suffix}":
                return str(client["ClientId"])
    raise SystemExit(f"no app client named {PREFIX}-{suffix}")


def api_base() -> str:
    apigateway = boto3.client("apigateway", region_name=REGION)
    for item in apigateway.get_rest_apis(limit=500)["items"]:
        if item["name"] == f"{PREFIX}-api":
            return f"https://{item['id']}.execute-api.{REGION}.amazonaws.com/dev"
    raise SystemExit(f"no REST API named {PREFIX}-api")


def main_table():  # noqa: ANN201  boto3 resource
    dynamodb = boto3.resource("dynamodb", region_name=REGION)
    return dynamodb.Table(f"{PREFIX}-main")


def seed(table) -> None:  # noqa: ANN001  boto3 table
    """The three records the booking path reads and no endpoint writes yet."""
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}",
            "sk": "META",
            "type": "TENANT",
            "tenantId": TENANT_ID,
            "gridUnitMinutes": GRID_UNIT_MINUTES,
        }
    )
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}#TYPE#{APPOINTMENT_TYPE_ID}",
            "sk": "TYPE",
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": APPOINTMENT_TYPE_ID,
            "tenantId": TENANT_ID,
            "code": "SPEC_FIRST",
            "name": "First specialist consultation",
            "serviceLine": "SPECIALIST",
            "durationUnits": DURATION_UNITS,
            "bufferUnits": BUFFER_UNITS,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 30,
            "maxAdvanceDays": 60,
            "active": True,
        }
    )
    # A profile always belongs to a person, because registration writes both
    # together. Seeding one without the other made every booking here a job
    # the notice sender could not resolve, retried five times and parked on
    # the dead letter queue. The person has no email, so the sender records
    # that there is no address to write to and stops, which is the honest
    # outcome for a synthetic patient.
    table.put_item(
        Item={
            "pk": f"PERSON#{PERSON_ID}",
            "sk": "PERSON",
            "type": "PERSON",
            "personId": PERSON_ID,
            "givenName": "Smoke",
            "familyName": "Patient",
        }
    )
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}#PAT#{PATIENT_PROFILE_ID}",
            "sk": "PROFILE",
            "type": "PATIENT_PROFILE",
            "patientProfileId": PATIENT_PROFILE_ID,
            "personId": PERSON_ID,
            "tenantId": TENANT_ID,
        }
    )
    print(f"seeded tenant {TENANT_ID}, type {APPOINTMENT_TYPE_ID}, patient {PATIENT_PROFILE_ID}")


def ensure_admin(idp, pool_id: str) -> str:  # noqa: ANN001  boto3 client
    """A synthetic tenant administrator, resolved by token attributes alone."""
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    attributes = [
        {"Name": "email", "Value": ADMIN_USERNAME},
        {"Name": "email_verified", "Value": "true"},
        {"Name": "given_name", "Value": "Smoke"},
        {"Name": "family_name", "Value": "Admin"},
        {"Name": "custom:tenantId", "Value": TENANT_ID},
        {"Name": "custom:personId", "Value": "p-smoke-admin"},
        {"Name": "custom:roles", "Value": "TENANT_ADMIN"},
    ]
    try:
        idp.admin_create_user(
            UserPoolId=pool_id,
            Username=ADMIN_USERNAME,
            UserAttributes=attributes,
            MessageAction="SUPPRESS",
        )
        print(f"created {ADMIN_USERNAME}")
    except idp.exceptions.UsernameExistsException:
        print(f"{ADMIN_USERNAME} already exists")

    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=ADMIN_USERNAME, Password=password, Permanent=True
    )
    return password


def sign_in(idp, pool_id: str, client_id: str, username: str, password: str) -> str:  # noqa: ANN001
    response = idp.admin_initiate_auth(
        UserPoolId=pool_id,
        ClientId=client_id,
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    if "AuthenticationResult" not in response:
        raise SystemExit(f"sign-in needs a challenge: {response.get('ChallengeName')}")
    return str(response["AuthenticationResult"]["AccessToken"])


def call(
    url: str, token: str | None, *, method: str = "GET", body: object = None
) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, method=method, data=data)  # noqa: S310  https only
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
            return response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def create_staff(base: str, token: str, body: dict[str, object]) -> dict[str, object]:
    status, raw = call(f"{base}/admin/staff", token, method="POST", body=body)
    if status != 201:
        print(raw)
        raise SystemExit(f"could not create staff account: {status}")
    return dict(json.loads(raw))


def sign_in_as(idp, pool_id: str, client_id: str, account: dict[str, object]) -> str:  # noqa: ANN001
    """Give a new account a permanent password and sign in as it."""
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    idp.admin_set_user_password(
        UserPoolId=pool_id,
        Username=str(account["signInName"]),
        Password=password,
        Permanent=True,
    )
    time.sleep(2)
    return sign_in(idp, pool_id, client_id, str(account["signInName"]), password)


def held_units(start: str) -> list[str]:
    """The grid units a booking of this type should hold: duration plus buffer."""
    first = dt.datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC)
    return [
        (first + dt.timedelta(minutes=GRID_UNIT_MINUTES * n)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for n in range(DURATION_UNITS + BUFFER_UNITS)
    ]


def count_locks(table, clinician_id: str, units: list[str]) -> int:  # noqa: ANN001  boto3 table
    """Lock items are one per grid unit, each in its own partition, so these are
    read back one key at a time rather than by scanning the table."""
    return sum(
        1
        for unit in units
        if table.get_item(
            Key={"pk": f"TENANT#{TENANT_ID}#LOCK#{clinician_id}#{unit}", "sk": "LOCK"}
        ).get("Item")
    )


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=REGION)
    pool_id = find_user_pool(idp)
    staff_client_id = find_client(idp, pool_id, "staff")
    base = api_base()
    table = main_table()
    print(f"pool {pool_id}\napi  {base}\nrun  {RUN}")

    seed(table)

    admin_password = ensure_admin(idp, pool_id)
    admin_token = sign_in(idp, pool_id, staff_client_id, ADMIN_USERNAME, admin_password)
    print("admin signed in")

    clinician = create_staff(
        base,
        admin_token,
        {
            "givenName": "Smoke",
            "familyName": "Clinician",
            "phoneE164": phone(),
            "clinicId": CLINIC_ID,
            "roles": ["CLINICIAN"],
            "specialty": "Paediatrics",
            "registrationYear": 2012,
            "ordreNumber": f"CM-ONMC-{RUN}",
            "languages": ["fr", "en"],
        },
    )
    clinician_id = str(clinician["staffId"])
    print(f"clinician {clinician_id} at {clinician['clinicId']}")

    receptionist = create_staff(
        base,
        admin_token,
        {
            "givenName": "Smoke",
            "familyName": "Receptionist",
            "phoneE164": phone(),
            "clinicId": CLINIC_ID,
            "roles": ["RECEPTIONIST"],
        },
    )
    print(f"receptionist {receptionist['staffId']} at {receptionist['clinicId']}")

    receptionist_token = sign_in_as(idp, pool_id, staff_client_id, receptionist)
    print("receptionist signed in")

    start = start_at()
    booking = {
        "patientProfileId": PATIENT_PROFILE_ID,
        "appointmentTypeId": APPOINTMENT_TYPE_ID,
        "clinicianProfileId": clinician_id,
        "startAt": start,
        "channel": "PHONE",
    }

    status, raw = call(f"{base}/appointments", receptionist_token, method="POST", body=booking)
    print(f"\nPOST /appointments: {status}")
    if status != 201:
        print(raw)
        print("\nbooking is not working: the first booking failed")
        return 1
    appointment = json.loads(raw)
    print(json.dumps(appointment, indent=2))

    units = held_units(start)
    locks = count_locks(table, clinician_id, units)
    print(f"\nslot locks written: {locks} of {len(units)} expected")

    # The same start again. This is what the whole transaction exists for.
    second_status, second_raw = call(
        f"{base}/appointments", receptionist_token, method="POST", body=booking
    )
    print(f"\nPOST /appointments again, same start: {second_status}")
    print(second_raw)
    locks_after = count_locks(table, clinician_id, units)
    print(f"slot locks after the refusal: {locks_after}")

    first = dt.datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC)
    expected_end = first + dt.timedelta(minutes=GRID_UNIT_MINUTES * DURATION_UNITS)
    checks = {
        "the appointment is BOOKED": appointment.get("state") == "BOOKED",
        "it carries a reference": str(appointment.get("reference", "")).startswith("APT-"),
        "the clinic came from the clinician": appointment.get("clinicId") == CLINIC_ID,
        "it holds no session": appointment.get("sessionId") is None,
        "endAt is the duration, not the buffer": appointment.get("endAt")
        == expected_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "the booking is attributed to the receptionist": appointment.get("bookedByRole")
        == "RECEPTIONIST",
        "one lock per unit, buffer included": locks == len(units),
        "the second attempt is a conflict": second_status == 409,
        "the refusal wrote nothing further": locks_after == locks,
    }

    print()
    for name, passed in checks.items():
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")

    print()
    if all(checks.values()):
        print(
            "booking works end to end: the units are locked in one transaction, "
            "and a second request for the same start is refused with nothing written"
        )
        return 0
    print("booking is not working: see the failed checks above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
