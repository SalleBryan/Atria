"""Register a patient and let them book, against deployed infrastructure.

    python tools/smoke_patient.py

This is the journey that was impossible before the post confirmation trigger
existed: a patient signs themselves up with Cognito, confirms, signs in, is
resolved as a PATIENT with a profile, and books their own appointment. Until
the trigger landed, a confirmed patient had a pool account and no records, so
the token carried no tenant and the authoriser refused them.

What it proves, in order:

    sign-up and confirmation write a person and a patient profile
    the token resolves to PATIENT with that profile and the configured tenant
    the patient can book for themselves, and the booking is self service
    the patient cannot book on somebody else's behalf

Development only, same reasoning as tools/smoke_me.py.

One shortcut worth naming: the patient client offers SRP only, so the patient
is signed in through the staff client, which has the development admin
password flow. Which client signs the token has no bearing on what this
checks, because the claims come from the pre-token trigger and the person
record, not from the client.

A tenant and an appointment type have no endpoints yet, so those two records
are written directly to the table. The clinician is created through the real
staff API, and everything on the patient path goes through Cognito and the API.
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

# Must match Environment.default_tenant_id: the trigger puts a self-registering
# patient here, so the clinician they book has to be here too.
TENANT_ID = "t-cm-001"
CLINIC_ID = "c-douala-01"
ADMIN_USERNAME = "smoke.admin.t1@atria.invalid"

RUN = secrets.token_hex(4)
APPOINTMENT_TYPE_ID = f"at-patient-{RUN}"

GRID_UNIT_MINUTES = 10
DURATION_UNITS = 3
BUFFER_UNITS = 1


def phone() -> str:
    return f"+2376{secrets.randbelow(10**8):08d}"


def start_at() -> str:
    when = dt.datetime.now(tz=dt.UTC) + dt.timedelta(days=1 + secrets.randbelow(20))
    return when.replace(
        minute=secrets.randbelow(6) * GRID_UNIT_MINUTES, second=0, microsecond=0
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


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
    return boto3.resource("dynamodb", region_name=REGION).Table(f"{PREFIX}-main")


def seed(table) -> None:  # noqa: ANN001  boto3 table
    """The tenant, the clinic and the appointment type, which have no endpoints yet."""
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}",
            "sk": "META",
            "type": "TENANT",
            "tenantId": TENANT_ID,
            "gridUnitMinutes": GRID_UNIT_MINUTES,
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
            "currency": "XAF",
        }
    )
    # Open every weekday, so the slot search does not depend on which day the
    # script happens to pick.
    table.put_item(
        Item={
            "pk": f"TENANT#{TENANT_ID}#CLINIC#{CLINIC_ID}",
            "sk": "PROFILE",
            "type": "CLINIC",
            "clinicId": CLINIC_ID,
            "tenantId": TENANT_ID,
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
            "code": "SPEC_FIRST",
            "serviceLine": "SPECIALIST",
            "durationUnits": DURATION_UNITS,
            "bufferUnits": BUFFER_UNITS,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 30,
            "maxAdvanceDays": 60,
            "active": True,
        }
    )
    print(f"seeded tenant {TENANT_ID} and type {APPOINTMENT_TYPE_ID}")


def ensure_admin(idp, pool_id: str) -> str:  # noqa: ANN001  boto3 client
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    try:
        idp.admin_create_user(
            UserPoolId=pool_id,
            Username=ADMIN_USERNAME,
            UserAttributes=[
                {"Name": "email", "Value": ADMIN_USERNAME},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "given_name", "Value": "Smoke"},
                {"Name": "family_name", "Value": "Admin"},
                {"Name": "custom:tenantId", "Value": TENANT_ID},
                {"Name": "custom:personId", "Value": "p-smoke-admin-t1"},
                {"Name": "custom:roles", "Value": "TENANT_ADMIN"},
            ],
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


def register_patient(idp, pool_id: str, patient_client_id: str) -> tuple[str, str, str]:  # noqa: ANN001
    """Sign a patient up the way the patient client will, then confirm them.

    Confirmation is done with the administrative call rather than the emailed
    code, because a script cannot read the patient's mailbox. It fires the same
    PostConfirmation_ConfirmSignUp trigger the real code path does.
    """
    email = f"smoke.patient.{RUN}@atria.invalid"
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    number = phone()
    idp.sign_up(
        ClientId=patient_client_id,
        Username=email,
        Password=password,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "phone_number", "Value": number},
            {"Name": "given_name", "Value": "Amina"},
            {"Name": "family_name", "Value": "Ngo"},
        ],
    )
    print(f"signed up {email}")
    idp.admin_confirm_sign_up(UserPoolId=pool_id, Username=email)
    print("confirmed, which fires the post confirmation trigger")
    subject = next(
        a["Value"]
        for a in idp.admin_get_user(UserPoolId=pool_id, Username=email)["UserAttributes"]
        if a["Name"] == "sub"
    )
    return email, password, subject


def records_for(table, subject: str) -> tuple[dict[str, object] | None, int]:  # noqa: ANN001
    """The person the trigger wrote, and how many of them exist."""
    found = table.query(
        IndexName="PersonIndex",
        KeyConditionExpression="cognitoSub = :s",
        ExpressionAttributeValues={":s": subject},
    ).get("Items", [])
    return (dict(found[0]) if found else None), len(found)


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=REGION)
    pool_id = find_user_pool(idp)
    patient_client_id = find_client(idp, pool_id, "patient")
    staff_client_id = find_client(idp, pool_id, "staff")
    base = api_base()
    table = main_table()
    print(f"pool {pool_id}\napi  {base}\nrun  {RUN}")

    seed(table)

    admin_password = ensure_admin(idp, pool_id)
    admin_token = sign_in(idp, pool_id, staff_client_id, ADMIN_USERNAME, admin_password)
    status, raw = call(
        f"{base}/admin/staff",
        admin_token,
        method="POST",
        body={
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
    if status != 201:
        print(raw)
        print("\ncould not create the clinician")
        return 1
    clinician_id = str(json.loads(raw)["staffId"])
    print(f"clinician {clinician_id} at {CLINIC_ID}")

    email, password, subject = register_patient(idp, pool_id, patient_client_id)

    # The trigger runs inside the confirmation call, so the records should be
    # there already; a moment is allowed for the index to catch up.
    time.sleep(2)
    person, person_count = records_for(table, subject)
    print(f"\nperson records for that sign-in: {person_count}")
    if person is None:
        print("the post confirmation trigger wrote nothing: a confirmed patient cannot sign in")
        return 1
    shown = {k: v for k, v in person.items() if k not in ("pk", "sk")}
    print(json.dumps(shown, indent=2, default=str))

    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=email, Password=password, Permanent=True
    )
    time.sleep(2)
    patient_token = sign_in(idp, pool_id, staff_client_id, email, password)
    print("patient signed in")

    status, raw = call(f"{base}/me", patient_token)
    print(f"\nGET /me: {status}")
    me = json.loads(raw) if raw else {}
    print(json.dumps(me, indent=2))

    # The directory, which is how a patient finds the clinician at all.
    dir_status, dir_raw = call(f"{base}/clinicians", patient_token)
    directory = json.loads(dir_raw) if dir_status == 200 else {}
    print(f"\nGET /clinicians: {dir_status}, {directory.get('count')} listed")
    listed_ids = {c["clinicianProfileId"] for c in directory.get("clinicians", [])}

    # The free starts for that clinician, which is how a patient picks a time.
    day = (dt.datetime.now(tz=dt.UTC) + dt.timedelta(days=3)).date().isoformat()
    slot_status, slot_raw = call(
        f"{base}/clinicians/{clinician_id}/slots?date={day}&typeId={APPOINTMENT_TYPE_ID}",
        patient_token,
    )
    slots = json.loads(slot_raw) if slot_status == 200 else {}
    offered = [s["startAt"] for s in slots.get("slots", [])]
    print(f"GET /clinicians/{{id}}/slots for {day}: {slot_status}, {len(offered)} free")

    # Book the first start the API itself offered, rather than one invented
    # here: that is what a client would do, and it is the only way to know the
    # two routes agree.
    start = offered[0] if offered else start_at()
    status, raw = call(
        f"{base}/appointments",
        patient_token,
        method="POST",
        body={
            "appointmentTypeId": APPOINTMENT_TYPE_ID,
            "clinicianProfileId": clinician_id,
            "startAt": start,
        },
    )
    print(f"\nPOST /appointments as the patient: {status}")
    print(raw)
    appointment = json.loads(raw) if status == 201 else {}

    # The same request naming somebody else. A patient books only for
    # themselves, so the profile on the record must still be their own.
    other_status, other_raw = call(
        f"{base}/appointments",
        patient_token,
        method="POST",
        body={
            "patientProfileId": "pp-somebody-else",
            "appointmentTypeId": APPOINTMENT_TYPE_ID,
            "clinicianProfileId": clinician_id,
            "startAt": start_at(),
        },
    )
    other = json.loads(other_raw) if other_status == 201 else {}
    print(f"\nPOST /appointments naming another patient: {other_status}")

    # The same day again. The start just booked must no longer be offered.
    after_status, after_raw = call(
        f"{base}/clinicians/{clinician_id}/slots?date={day}&typeId={APPOINTMENT_TYPE_ID}",
        patient_token,
    )
    still_offered = (
        [s["startAt"] for s in json.loads(after_raw).get("slots", [])]
        if after_status == 200
        else []
    )
    print(f"the same day after booking: {len(still_offered)} free")

    checks = {
        "one person record, not two": person_count == 1,
        "the clinician is in the directory": dir_status == 200
        and clinician_id in listed_ids,
        "the directory carries no score": all(
            "score" not in c and "rating" not in c for c in directory.get("clinicians", [])
        ),
        "free starts are offered": slot_status == 200 and bool(offered),
        "every start offered is on the grid": bool(offered)
        and all(
            dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")
            .replace(tzinfo=dt.UTC)
            .minute
            % GRID_UNIT_MINUTES
            == 0
            for s in offered
        ),
        "the start offered could be booked": status == 201,
        "the booked start is no longer offered": start not in still_offered,
        "booking freed nothing else": after_status == 200
        and len(still_offered) < len(offered),
        "the profile is in the configured tenant": person.get("patientProfiles", [{}])[0].get(
            "tenantId"
        )
        == TENANT_ID,
        "GET /me succeeds": status != 401 and me.get("roles") == ["PATIENT"],
        "the token carries a patient profile": bool(me.get("patientProfileId")),
        "the phone is not yet verified": me.get("phoneVerified") is False,
        "the patient booked their own appointment": status == 201
        and appointment.get("patientProfileId") == me.get("patientProfileId"),
        "the booking is self service": status == 201 and appointment.get("bookedByRole") is None,
        "naming another patient books for themselves anyway": other_status == 201
        and other.get("patientProfileId") == me.get("patientProfileId"),
    }

    print()
    for name, passed in checks.items():
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")

    print()
    if all(checks.values()):
        print(
            "the patient journey works end to end: sign-up writes the records, "
            "the token resolves as a patient, and they can book only for themselves"
        )
        return 0
    print("the patient journey is not working: see the failed checks above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
