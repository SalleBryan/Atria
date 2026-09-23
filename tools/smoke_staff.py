"""Call staff provisioning end to end, against deployed infrastructure.

    python tools/smoke_staff.py

Signs in as a synthetic tenant administrator, creates a receptionist account
through POST /admin/staff, then signs in as that new account and calls GET
/me. The second sign-in is the point of this script: it proves the person
record path end to end, not just the token attribute fallback that
tools/smoke_me.py already covers. GET /me for the new account must show
RECEPTIONIST with its clinic, which only happens if the pre-token trigger
resolved the person record People.create_staff_account wrote.

Development only, same reasoning as tools/smoke_me.py: the admin password
auth flow is enabled for dev alone, and every account here is synthetic.
"""

from __future__ import annotations

import json
import secrets
import sys
import time
import urllib.error
import urllib.request

import boto3
import devkit

REGION = "us-east-1"
PREFIX = "atria-dev"

ADMIN_USERNAME = "smoke.admin@atria.invalid"
TENANT_ID = "t-cm-smoke"
ADMIN_PERSON_ID = "p-smoke-admin"

RECEPTIONIST_BODY = {
    "givenName": "Smoke",
    "familyName": "Receptionist",
    "phoneE164": devkit.fictional_phone(),
    "clinicId": "c-smoke-01",
    "roles": ["RECEPTIONIST"],
}


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


def ensure_admin(idp, pool_id: str) -> str:  # noqa: ANN001  boto3 client
    """A synthetic tenant administrator, resolved by token attributes alone.

    No person record is needed for the caller of POST /admin/staff: the
    authoriser only needs a tenant and TENANT_ADMIN to grant staff.create.
    """
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    attributes = [
        {"Name": "email", "Value": ADMIN_USERNAME},
        {"Name": "email_verified", "Value": "true"},
        {"Name": "given_name", "Value": "Smoke"},
        {"Name": "family_name", "Value": "Admin"},
        {"Name": "custom:tenantId", "Value": TENANT_ID},
        {"Name": "custom:personId", "Value": ADMIN_PERSON_ID},
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


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=REGION)
    pool_id = find_user_pool(idp)
    staff_client_id = find_client(idp, pool_id, "staff")
    base = api_base()
    print(f"pool {pool_id}\napi  {base}")

    admin_password = ensure_admin(idp, pool_id)
    admin_token = sign_in(idp, pool_id, staff_client_id, ADMIN_USERNAME, admin_password)
    print(f"admin signed in, token acquired, {len(admin_token)} characters")

    status, body = call(f"{base}/admin/staff", admin_token, method="POST", body=RECEPTIONIST_BODY)
    print(f"\nPOST /admin/staff: {status}")
    if status != 201:
        print(body)
        print("\nstaff provisioning is not working: create failed")
        return 1
    created = json.loads(body)
    print(json.dumps({k: v for k, v in created.items() if k != "temporaryPassword"}, indent=2))
    print(f"temporaryPassword: {len(created['temporaryPassword'])} characters, not printed")

    sign_in_name = str(created["signInName"])

    # A temporary password needs a permanent one set before it can sign in
    # normally; that is the patient/staff app's first-sign-in flow, which does
    # not exist yet, so the smoke test sets a permanent password directly,
    # the same shortcut ensure_admin uses.
    new_password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=sign_in_name, Password=new_password, Permanent=True
    )
    # The person, membership and clinician profile were written in the same
    # transaction as the pool account, so they are already there; this is
    # just giving Cognito's own state a moment to settle after the password
    # change before signing in.
    time.sleep(2)
    receptionist_token = sign_in(idp, pool_id, staff_client_id, sign_in_name, new_password)
    print(f"\nnew receptionist signed in, token acquired, {len(receptionist_token)} characters")

    status, body = call(f"{base}/me", receptionist_token)
    print(f"\nGET /me as the new receptionist: {status}")
    me = json.loads(body) if body else {}
    print(json.dumps(me, indent=2))

    resolved_ok = (
        status == 200
        and me.get("roles") == ["RECEPTIONIST"]
        and me.get("clinicId") == RECEPTIONIST_BODY["clinicId"]
        and me.get("staffId") == created["staffId"]
    )

    print()
    if resolved_ok:
        print(
            "staff provisioning works end to end: created, signed in, "
            "resolved from the person record with its clinic and staff id"
        )
        return 0
    print("staff provisioning is not working: the new account did not resolve correctly")
    return 1


if __name__ == "__main__":
    sys.exit(main())
