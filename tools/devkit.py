"""What every development script needs, defined once.

The smoke scripts and the seed used to each carry their own copy of the AWS
lookups, the sign-in, and a hand written region pack. The copies drifted, and
because each wrote the shared region pack item, every run of one script
overwrote the pack the others relied on with a thinner one. This is the one
place those things are defined, and the region pack comes from the
specification rather than from a script (FR-TEN-08).

Phone numbers are always fictional. Nothing here can generate a number that
reaches a real person, because the notice pipeline is live and a synthetic
patient with a real-looking Cameroonian number would be sent a real SMS the
moment the account leaves the SMS sandbox. No Cameroonian range is known to be
unallocated, so the numbers come from +1 NXX 555-0100 to 0199, which North
American numbering reserves for fiction. That is a deliberate exception to
generating every sample value from the region pack: a number in the wrong
country's format is harmless, and one in the right format might be somebody's.

Development only. Every record written here is synthetic.
"""

# boto3 clients and resources are untyped, so they pass as Any throughout.
# ruff: noqa: ANN401

from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import json
import secrets
import struct
import time
import urllib.error
import urllib.request
from typing import Any

import boto3
from atria_spec import hospital
from atria_spec.region_packs import region_pack

REGION = "us-east-1"
PREFIX = "atria-dev"

# The tenant a self-registering patient joins in development
# (Environment.default_tenant_id), and so the one the scripts seed.
TENANT_ID = "t-cm-001"
REGION_PACK_CODE = "CM"
GRID_UNIT_MINUTES = 10


# --------------------------------------------------------------- synthetic data
def fictional_phone() -> str:
    """A number reserved for fiction, which can never reach anyone."""
    area = 200 + secrets.randbelow(800)
    return f"+1{area}55501{secrets.randbelow(100):02d}"


def run_id() -> str:
    return secrets.token_hex(4)


def password() -> str:
    """Satisfies the pool policy: long, mixed case, a digit and a symbol."""
    return f"Smoke-{secrets.token_urlsafe(12)}!1"


# ------------------------------------------------------------------ lookups
def cognito() -> Any:
    return boto3.client("cognito-idp", region_name=REGION)


def user_pool(idp: Any) -> str:
    for page in idp.get_paginator("list_user_pools").paginate(MaxResults=60):
        for pool in page["UserPools"]:
            if pool["Name"] == f"{PREFIX}-users":
                return str(pool["Id"])
    raise SystemExit(f"no user pool named {PREFIX}-users in {REGION}")


def app_client(idp: Any, pool_id: str, suffix: str) -> str:
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


def main_table() -> Any:
    return boto3.resource("dynamodb", region_name=REGION).Table(f"{PREFIX}-main")


# --------------------------------------------------------------------- HTTP
def call(
    url: str,
    token: str | None,
    *,
    method: str = "GET",
    body: object = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, str, dict[str, str]]:
    """One API call. Returns status, body and response headers, never raises on HTTP."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, method=method, data=data)  # noqa: S310  https only
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
            return response.status, response.read().decode(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(), dict(exc.headers or {})


# ------------------------------------------------------------------ accounts
TOTP_STEP = 30


def totp(secret: str, at: float | None = None) -> str:
    """The six digits an authenticator shows for this secret now (RFC 6238)."""
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    counter = int((time.time() if at is None else at) // TOTP_STEP)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def next_step() -> None:
    """Wait for a fresh code: Cognito refuses one it has already accepted."""
    time.sleep(TOTP_STEP - time.time() % TOTP_STEP + 1)


def _totp_parameter(username: str) -> str:
    return f"/{PREFIX}/smoke/totp/{username.replace('@', '-at-')}"


def _stored_totp(username: str) -> str | None:
    ssm = boto3.client("ssm", region_name=REGION)
    try:
        found = ssm.get_parameter(Name=_totp_parameter(username), WithDecryption=True)
    except ssm.exceptions.ParameterNotFound:
        return None
    return str(found["Parameter"]["Value"])


def _enrol(idp: Any, pool_id: str, username: str, access_token: str) -> None:
    """Give a synthetic administrator an authenticator, as the console does
    for a real one (FR-ACC-11), and keep its secret for the next run."""
    secret = str(idp.associate_software_token(AccessToken=access_token)["SecretCode"])
    idp.verify_software_token(AccessToken=access_token, UserCode=totp(secret))
    idp.admin_set_user_mfa_preference(
        UserPoolId=pool_id,
        Username=username,
        SoftwareTokenMfaSettings={"Enabled": True, "PreferredMfa": True},
    )
    boto3.client("ssm", region_name=REGION).put_parameter(
        Name=_totp_parameter(username), Value=secret, Type="SecureString", Overwrite=True
    )
    print(f"authenticator set up for {username}")
    next_step()


def sign_in(idp: Any, pool_id: str, client_id: str, username: str, secret: str) -> str:
    """The development admin password flow, which is enabled for dev alone.

    An administrator acts only with a second factor (FR-ACC-11), so a
    synthetic one is given an authenticator on first use and answers its
    challenge from the stored secret after that."""
    for _attempt in range(3):
        result = idp.admin_initiate_auth(
            UserPoolId=pool_id,
            ClientId=client_id,
            AuthFlow="ADMIN_USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": username, "PASSWORD": secret},
        )
        if result.get("ChallengeName") == "SOFTWARE_TOKEN_MFA":
            stored = _stored_totp(username)
            if stored is None:
                # Enrolled on another machine, or the secret was lost: start again.
                idp.admin_set_user_mfa_preference(
                    UserPoolId=pool_id,
                    Username=username,
                    SoftwareTokenMfaSettings={"Enabled": False, "PreferredMfa": False},
                )
                continue
            try:
                result = idp.admin_respond_to_auth_challenge(
                    UserPoolId=pool_id,
                    ClientId=client_id,
                    ChallengeName="SOFTWARE_TOKEN_MFA",
                    Session=result["Session"],
                    ChallengeResponses={
                        "USERNAME": username,
                        "SOFTWARE_TOKEN_MFA_CODE": totp(stored),
                    },
                )
            except idp.exceptions.CodeMismatchException:
                next_step()  # this code was already used by an earlier sign-in
                continue
        if "AuthenticationResult" not in result:
            raise SystemExit(f"sign-in needs a challenge: {result.get('ChallengeName')}")
        token = str(result["AuthenticationResult"]["AccessToken"])
        user = idp.admin_get_user(UserPoolId=pool_id, Username=username)
        admin = any(
            a["Name"] == "custom:roles" and "TENANT_ADMIN" in a["Value"]
            for a in user.get("UserAttributes", [])
        )
        if admin and "SOFTWARE_TOKEN_MFA" not in (user.get("UserMFASettingList") or []):
            _enrol(idp, pool_id, username, token)
            continue
        return token
    raise SystemExit(f"could not sign in as {username}")


def admin_token(idp: Any, pool_id: str, client_id: str, tenant_id: str = TENANT_ID) -> str:
    """Sign in as the synthetic tenant administrator, creating it if needed.

    Resolved from its token attributes alone: the authoriser needs only a tenant
    and TENANT_ADMIN to grant staff.create, so no person record is written.
    """
    username = f"smoke.admin.{tenant_id}@atria.invalid"
    secret = password()
    with contextlib.suppress(idp.exceptions.UsernameExistsException):
        idp.admin_create_user(
            UserPoolId=pool_id,
            Username=username,
            UserAttributes=[
                {"Name": "email", "Value": username},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:tenantId", "Value": tenant_id},
                {"Name": "custom:personId", "Value": f"p-smoke-admin-{tenant_id}"},
                {"Name": "custom:roles", "Value": "TENANT_ADMIN"},
            ],
            MessageAction="SUPPRESS",
        )
    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=username, Password=secret, Permanent=True
    )
    return sign_in(idp, pool_id, client_id, username, secret)


def create_staff(base: str, token: str, body: dict[str, object]) -> dict[str, Any]:
    """Create a staff account through the real API; stop the script if it fails."""
    status, raw, _headers = call(f"{base}/admin/staff", token, method="POST", body=body)
    if status != 201:
        raise SystemExit(f"could not create staff account: {status} {raw}")
    return dict(json.loads(raw))


def staff_token(idp: Any, pool_id: str, client_id: str, account: dict[str, Any]) -> str:
    """Give a new staff account a permanent password and sign in as it.

    A new account holds a temporary password; changing it is the client's
    first sign-in flow, which a script stands in for here.
    """
    secret = password()
    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=str(account["signInName"]), Password=secret, Permanent=True
    )
    time.sleep(2)
    return sign_in(idp, pool_id, client_id, str(account["signInName"]), secret)


def clinician_body(clinic_id: str, run: str, family_name: str = "Etoa") -> dict[str, object]:
    pack = region_pack(REGION_PACK_CODE)
    return {
        "givenName": "Paul",
        "familyName": family_name,
        "phoneE164": fictional_phone(),
        "clinicId": clinic_id,
        "roles": ["CLINICIAN"],
        "specialty": "Paediatrics",
        "registrationYear": 2012,
        "ordreNumber": f"CM-ONMC-{run}-{family_name}",
        "languages": list(pack["languages"]),
    }


def receptionist_body(clinic_id: str, role: str = "RECEPTIONIST") -> dict[str, object]:
    """A clinic scoped account with no clinician fields: a receptionist or a manager."""
    return {
        "givenName": "Ruth",
        "familyName": "Mba",
        "phoneE164": fictional_phone(),
        "clinicId": clinic_id,
        "roles": [role],
    }


def register_patient(idp: Any, pool_id: str, run: str, label: str = "patient") -> tuple[str, str]:
    """Sign a patient up through the patient client and confirm them.

    Confirming fires the post-confirmation trigger, which writes the person and
    the patient profile in the default tenant, exactly as a real sign-up does.
    The address is on the SES mailbox simulator, because signing up sends a
    code by email and a made-up domain would bounce. Returns the sign-in name
    and a permanent password, set here in place of the emailed code.
    """
    email = f"success+{label}-{run}@simulator.amazonses.com"
    secret = password()
    idp.sign_up(
        ClientId=app_client(idp, pool_id, "patient"),
        Username=email,
        Password=secret,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "phone_number", "Value": fictional_phone()},
            {"Name": "given_name", "Value": "Amina"},
            {"Name": "family_name", "Value": "Ngo"},
        ],
    )
    idp.admin_confirm_sign_up(UserPoolId=pool_id, Username=email)
    time.sleep(2)
    return email, secret


# ------------------------------------------------------------------- seeding
def put_region_pack(table: Any, code: str = REGION_PACK_CODE) -> dict[str, Any]:
    """The region pack exactly as the specification defines it."""
    pack = region_pack(code)
    item = {"pk": f"REGION#{code}", "sk": "PACK", "type": "REGION_PACK", **pack}
    # DynamoDB stores no None; an unconfirmed field is simply absent.
    item = {name: value for name, value in item.items() if value is not None}
    table.put_item(Item=item)
    return item


def put_tenant(table: Any, tenant_id: str = TENANT_ID) -> dict[str, Any]:
    """The tenant with the agreed settings (atria_spec.hospital), keeping what use has set.

    A re-seed must not unlock the region pack: firstAppointmentAt, and any
    setting an administrator has since changed, are kept.
    """
    existing = table.get_item(Key={"pk": f"TENANT#{tenant_id}", "sk": "META"}).get("Item") or {}
    item = {
        "pk": f"TENANT#{tenant_id}",
        "sk": "META",
        "type": "TENANT",
        "tenantId": tenant_id,
        "name": hospital.NAME,
        "regionPackCode": REGION_PACK_CODE,
        **hospital.TENANT_SETTINGS,
        "status": "ACTIVE",
        **{k: v for k, v in existing.items() if k not in ("pk", "sk", "type", "tenantId", "name")},
    }
    table.put_item(Item=item)
    return item


def weekday_hours(start: str = "08:00", end: str = "17:00", saturday_until: str = "12:00") -> dict:
    """Monday to Friday, a Saturday morning, closed on Sunday. Weekday 0 is Monday."""
    hours: dict[str, dict[str, str]] = {str(day): {"start": start, "end": end} for day in range(5)}
    hours["5"] = {"start": start, "end": saturday_until}
    return hours


def every_day_hours(start: str = "08:00", end: str = "17:00") -> dict:
    """Open all week, so a script's slot search does not depend on the day it runs."""
    return {str(day): {"start": start, "end": end} for day in range(7)}


def put_clinic(
    table: Any,
    clinic_id: str,
    *,
    name: str,
    city: str = "Buea",
    region: str = "Sud-Ouest",
    address: str | None = None,
    hours: dict | None = None,
    tenant_id: str = TENANT_ID,
    description: str | None = None,
    services: list[str] | None = None,
) -> dict[str, Any]:
    """A clinic (a unit, to the people using Atria) in a region the pack has.

    The pack names its regions in French, so an address people read is given
    in English as `address`; the region is still checked against the pack.
    """
    pack = region_pack(REGION_PACK_CODE)
    if region not in pack["administrativeRegions"]:
        raise SystemExit(f"{region} is not a region of the {pack['code']} pack")
    key = {"pk": f"TENANT#{tenant_id}#CLINIC#{clinic_id}", "sk": "PROFILE"}
    existing = table.get_item(Key=key).get("Item") or {}
    item = {
        **key,
        "type": "CLINIC",
        "clinicId": clinic_id,
        "tenantId": tenant_id,
        "name": name,
        "address": address or f"{city}, {region}",
        # Kept across re-seeds, so a unit's number does not change every run.
        "phone": existing.get("phone") or fictional_phone(),
        "openingHours": hours or weekday_hours(),
        **({"description": description} if description else {}),
        **({"services": services} if services else {}),
        # Listed in the tenant's directory, as atria.data.catalogue.clinic_listing does.
        "directoryKey": f"TENANT#{tenant_id}#CLINIC",
        "directorySort": f"{name.casefold()}#{clinic_id}",
    }
    table.put_item(Item=item)
    return item


APPOINTMENT_TYPES: dict[str, dict[str, Any]] = {
    # The general line queues rather than holding time, so it has no duration.
    "GEN_CONSULT": {
        "name": "General consultation",
        "serviceLine": "GENERAL",
        "durationUnits": None,
        "bufferUnits": 0,
        "bookableBy": "BOTH",
    },
    "SPEC_FIRST": {
        "name": "First specialist consultation",
        "serviceLine": "SPECIALIST",
        "durationUnits": 3,
        "bufferUnits": 1,
        "bookableBy": "BOTH",
    },
    # A procedure is sized and placed by staff (ADR 0005).
    "MINOR_PROC": {
        "name": "Minor procedure",
        "serviceLine": "PROCEDURE",
        "durationUnits": 6,
        "bufferUnits": 2,
        "bookableBy": "STAFF",
    },
}


def put_appointment_type(
    table: Any,
    type_id: str,
    *,
    code: str = "SPEC_FIRST",
    tenant_id: str = TENANT_ID,
    **overrides: Any,
) -> dict[str, Any]:
    item = {
        "pk": f"TENANT#{tenant_id}#TYPE#{type_id}",
        "sk": "TYPE",
        "type": "APPOINTMENT_TYPE",
        "appointmentTypeId": type_id,
        "tenantId": tenant_id,
        "code": code,
        **APPOINTMENT_TYPES.get(code, {}),
        "minNoticeMinutes": 30,
        "maxAdvanceDays": 60,
        "cancellationWindowMinutes": 1440,
        "active": True,
        **overrides,
    }
    # Listed, retired or not, as atria.data.catalogue.appointment_type_listing does.
    item["directoryKey"] = f"TENANT#{tenant_id}#TYPE"
    item["directorySort"] = f"{str(item['name']).casefold()}#{type_id}"
    item = {name: value for name, value in item.items() if value is not None}
    table.put_item(Item=item)
    return item


def put_patient(
    table: Any,
    run: str,
    *,
    email: str | None = None,
    phone: str | None = None,
    tenant_id: str = TENANT_ID,
) -> tuple[str, str]:
    """A synthetic person and their patient profile, written together.

    A profile always belongs to a person, because registration writes both;
    seeding one without the other once made every booking a job the notice
    sender could not resolve.
    """
    pack = region_pack(REGION_PACK_CODE)
    person_id = f"p-smoke-{run}"
    profile_id = f"pp-smoke-{run}"
    person = {
        "pk": f"PERSON#{person_id}",
        "sk": "PERSON",
        "type": "PERSON",
        "personId": person_id,
        "givenName": "Amina",
        "familyName": "Ngo",
        "phoneE164": phone or fictional_phone(),
        "preferredLanguage": pack["languages"][0],
    }
    if email:
        person["email"] = email
    table.put_item(Item=person)
    table.put_item(
        Item={
            "pk": f"TENANT#{tenant_id}#PAT#{profile_id}",
            "sk": "PROFILE",
            "type": "PATIENT_PROFILE",
            "patientProfileId": profile_id,
            "personId": person_id,
            "tenantId": tenant_id,
        }
    )
    return person_id, profile_id


def seed_baseline(table: Any) -> None:
    """The region pack and the tenant, identical for every script."""
    put_region_pack(table)
    put_tenant(table)
