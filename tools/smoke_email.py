"""Acceptance test BR-09: email is sent reliably, and every send is logged.

    python tools/smoke_email.py              five bookings and five cancellations
    python tools/smoke_email.py --count 20   the acceptance figure: 40 emails

GIVEN bookings and cancellations addressed to the SES mailbox simulator,
WHEN they complete,
THEN every email is accepted and every message log entry shows SENT.

The whole path is the deployed one: a receptionist books through the API, the
table's change stream fills the outbox, and the sender composes, sends through
SES and writes the message log. Nothing here calls SES itself.

The bookings are confirmed before any is cancelled. The sender re-reads an
appointment at send time and will not send a confirmation for one already
cancelled, which is right for a patient but would make a script that cancels
in the same second see fewer emails than it expects. A real patient receives
their confirmation long before they cancel.

The patient's address is the SES mailbox simulator, which the sandbox accepts
without verification and which reports acceptance without delivering anywhere.
The development account is in the sandbox and sends one message a second, so a
run of 20 takes several minutes.

Development only, same reasoning as tools/smoke_me.py.
"""

from __future__ import annotations

import argparse
import collections
import contextlib
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

TENANT_ID = "t-cm-001"
CLINIC_ID = "c-douala-01"
ADMIN_USERNAME = "smoke.admin.t1@atria.invalid"

SIMULATOR = "success@simulator.amazonses.com"

RUN = secrets.token_hex(4)
APPOINTMENT_TYPE_ID = f"at-email-{RUN}"
PERSON_ID = f"p-email-{RUN}"
PATIENT_PROFILE_ID = f"pp-email-{RUN}"

# Long enough for one retry cycle: a send throttled by the sandbox is retried
# only once the queue's visibility timeout of three minutes has passed.
WAIT_SECONDS = 480


def phone() -> str:
    return f"+2376{secrets.randbelow(10**8):08d}"


def find_user_pool(idp) -> str:  # noqa: ANN001  boto3 client
    for page in idp.get_paginator("list_user_pools").paginate(MaxResults=60):
        for pool in page["UserPools"]:
            if pool["Name"] == f"{PREFIX}-users":
                return str(pool["Id"])
    raise SystemExit(f"no user pool named {PREFIX}-users")


def find_client(idp, pool_id: str, suffix: str) -> str:  # noqa: ANN001  boto3 client
    for page in idp.get_paginator("list_user_pool_clients").paginate(
        UserPoolId=pool_id, MaxResults=60
    ):
        for client in page["UserPoolClients"]:
            if client["ClientName"] == f"{PREFIX}-{suffix}":
                return str(client["ClientId"])
    raise SystemExit(f"no app client named {PREFIX}-{suffix}")


def api_base() -> str:
    for item in boto3.client("apigateway", region_name=REGION).get_rest_apis(limit=500)["items"]:
        if item["name"] == f"{PREFIX}-api":
            return f"https://{item['id']}.execute-api.{REGION}.amazonaws.com/dev"
    raise SystemExit(f"no REST API named {PREFIX}-api")


def call(
    url: str,
    token: str,
    *,
    method: str = "GET",
    body: object = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, method=method, data=data)  # noqa: S310  https only
    if data is not None:
        request.add_header("Content-Type", "application/json")
    request.add_header("Authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
            return response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


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


def ensure_admin(idp, pool_id: str) -> str:  # noqa: ANN001  boto3 client
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    with contextlib.suppress(idp.exceptions.UsernameExistsException):
        idp.admin_create_user(
            UserPoolId=pool_id,
            Username=ADMIN_USERNAME,
            UserAttributes=[
                {"Name": "email", "Value": ADMIN_USERNAME},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:tenantId", "Value": TENANT_ID},
                {"Name": "custom:personId", "Value": "p-smoke-admin-t1"},
                {"Name": "custom:roles", "Value": "TENANT_ADMIN"},
            ],
            MessageAction="SUPPRESS",
        )
    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=ADMIN_USERNAME, Password=password, Permanent=True
    )
    return password


def seed(table) -> None:  # noqa: ANN001  boto3 table
    """The records no endpoint writes yet, and a patient addressed to the simulator."""
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}",
            "sk": "META",
            "type": "TENANT",
            "tenantId": TENANT_ID,
            "gridUnitMinutes": 10,
            "regionPackCode": "CM",
        }
    )
    table.put_item(
        Item={
            "pk": "REGION#CM",
            "sk": "PACK",
            "type": "REGION_PACK",
            "code": "CM",
            "timezone": "Africa/Douala",
        }
    )
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}#CLINIC#{CLINIC_ID}",
            "sk": "PROFILE",
            "type": "CLINIC",
            "clinicId": CLINIC_ID,
            "tenantId": TENANT_ID,
            "name": "Clinique de Douala",
            "openingHours": {str(day): {"start": "08:00", "end": "17:00"} for day in range(7)},
        }
    )
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}#TYPE#{APPOINTMENT_TYPE_ID}",
            "sk": "TYPE",
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": APPOINTMENT_TYPE_ID,
            "tenantId": TENANT_ID,
            "serviceLine": "SPECIALIST",
            "durationUnits": 3,
            "bufferUnits": 1,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 30,
            "maxAdvanceDays": 60,
            "cancellationWindowMinutes": 1440,
            "active": True,
        }
    )
    table.put_item(
        Item={
            "pk": f"PERSON#{PERSON_ID}",
            "sk": "PERSON",
            "type": "PERSON",
            "personId": PERSON_ID,
            "givenName": "Amina",
            "familyName": "Ngo",
            "email": SIMULATOR,
            "phoneE164": phone(),
            "preferredLanguage": "fr",
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


def create_staff(base: str, token: str, body: dict[str, object]) -> dict[str, object]:
    status, raw = call(f"{base}/admin/staff", token, method="POST", body=body)
    if status != 201:
        raise SystemExit(f"could not create staff account: {status} {raw}")
    return dict(json.loads(raw))


def logged(table, appointment_ids: set[str]) -> list[dict[str, object]]:  # noqa: ANN001
    """Every message log row for these appointments, today and yesterday.

    Yesterday too, because a run started just before midnight UTC logs on both.
    """
    found: list[dict[str, object]] = []
    today = dt.datetime.now(tz=dt.UTC).date()
    for day in (today - dt.timedelta(days=1), today):
        response = table.query(
            KeyConditionExpression="pk = :pk",
            ExpressionAttributeValues={":pk": f"TENANT#{TENANT_ID}#MSG#{day.isoformat()}"},
        )
        found.extend(
            dict(item) for item in response.get("Items", [])
            if item.get("appointmentId") in appointment_ids
        )
    return found


def wait_for(table, appointment_ids: set[str], kind: str, expected: int) -> list[dict[str, object]]:  # noqa: ANN001
    """Poll the log until every notice of one kind is SENT, or give up."""
    deadline = time.monotonic() + WAIT_SECONDS
    while True:
        rows = [row for row in logged(table, appointment_ids) if row.get("kind") == kind]
        states = collections.Counter(str(row.get("deliveryState")) for row in rows)
        print(f"   {kind}: {dict(states)} of {expected}")
        if states.get("SENT", 0) >= expected or time.monotonic() > deadline:
            return rows
        time.sleep(10)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--count", type=int, default=5, help="bookings, and as many cancellations")
    count = parser.parse_args().count

    idp = boto3.client("cognito-idp", region_name=REGION)
    pool_id = find_user_pool(idp)
    staff_client = find_client(idp, pool_id, "staff")
    base = api_base()
    table = boto3.resource("dynamodb", region_name=REGION).Table(f"{PREFIX}-main")
    print(f"api  {base}\nrun  {RUN}\n{count} bookings and {count} cancellations to {SIMULATOR}")

    seed(table)
    admin_token = sign_in(idp, pool_id, staff_client, ADMIN_USERNAME, ensure_admin(idp, pool_id))

    clinician = create_staff(
        base,
        admin_token,
        {
            "givenName": "Paul",
            "familyName": "Etoa",
            "phoneE164": phone(),
            "clinicId": CLINIC_ID,
            "roles": ["CLINICIAN"],
            "specialty": "Paediatrics",
            "registrationYear": 2012,
            "ordreNumber": f"CM-ONMC-{RUN}",
            "languages": ["fr"],
        },
    )
    receptionist = create_staff(
        base,
        admin_token,
        {
            "givenName": "Ruth",
            "familyName": "Mba",
            "phoneE164": phone(),
            "clinicId": CLINIC_ID,
            "roles": ["RECEPTIONIST"],
        },
    )
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    idp.admin_set_user_password(
        UserPoolId=pool_id,
        Username=str(receptionist["signInName"]),
        Password=password,
        Permanent=True,
    )
    time.sleep(2)
    token = sign_in(idp, pool_id, staff_client, str(receptionist["signInName"]), password)

    # One appointment a day at 08:00 in Douala, which is 07:00 UTC. A day apart,
    # so none of them can share a grid unit and no lock can refuse another.
    first_day = dt.datetime.now(tz=dt.UTC).date() + dt.timedelta(days=2)
    appointment_ids: list[str] = []
    for index in range(count):
        start = f"{(first_day + dt.timedelta(days=index)).isoformat()}T07:00:00Z"
        status, raw = call(
            f"{base}/appointments",
            token,
            method="POST",
            body={
                "patientProfileId": PATIENT_PROFILE_ID,
                "appointmentTypeId": APPOINTMENT_TYPE_ID,
                "clinicianProfileId": clinician["staffId"],
                "startAt": start,
                "channel": "PHONE",
            },
            headers={"Idempotency-Key": f"email-{RUN}-{index:03d}"},
        )
        if status != 201:
            print(raw)
            raise SystemExit(f"booking {index} failed: {status}")
        appointment_ids.append(str(json.loads(raw)["appointmentId"]))
    print(f"\nbooked {len(appointment_ids)}; waiting for the confirmations")
    confirmations = wait_for(table, set(appointment_ids), "BOOKING_CONFIRMATION", count)

    for appointment_id in appointment_ids:
        status, raw = call(
            f"{base}/appointments/{appointment_id}",
            token,
            method="DELETE",
            body={"cancelledBy": "PATIENT"},
        )
        if status != 200:
            print(raw)
            raise SystemExit(f"cancelling {appointment_id} failed: {status}")
    print(f"\ncancelled {len(appointment_ids)}; waiting for the cancellation notices")
    cancellations = wait_for(table, set(appointment_ids), "BOOKING_CANCELLATION", count)

    rows = confirmations + cancellations
    sent = [row for row in rows if row.get("deliveryState") == "SENT"]
    per_appointment = collections.Counter(str(row["appointmentId"]) for row in rows)

    checks = {
        f"{count} confirmations sent": sum(
            1 for row in confirmations if row.get("deliveryState") == "SENT"
        )
        == count,
        f"{count} cancellation notices sent": sum(
            1 for row in cancellations if row.get("deliveryState") == "SENT"
        )
        == count,
        f"{2 * count} message log entries show SENT": len(sent) == 2 * count,
        "one row per message, however many attempts it took": all(
            n == 2 for n in per_appointment.values()
        )
        and len(per_appointment) == count,
        "every row names the simulator as recipient": all(
            row.get("recipient") == SIMULATOR for row in rows
        ),
        "every row records what SES called the message": all(
            row.get("providerMessageId") for row in sent
        ),
        "every notice went out in the patient's language": all(
            str(row.get("template", "")).endswith(".fr") for row in rows
        ),
    }

    print()
    for name, passed in checks.items():
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")
    print()
    if all(checks.values()):
        print(f"BR-09 holds: {2 * count} emails accepted and {2 * count} log entries SENT")
        return 0
    print("BR-09 does not hold: see the failed checks above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
