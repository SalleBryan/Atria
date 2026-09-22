"""Call the deployed GET /me end to end, as a real signed-in staff account.

This is the walking skeleton's proof: token verification, the authoriser, the
permission matrix and the response all working against deployed
infrastructure rather than a test double.

    python tools/smoke_me.py

It reads the stack outputs from CloudFormation, creates the development staff
account if it is missing, signs in, calls the API and prints what came back.
Development only: it relies on the admin password auth flow, which is enabled
for the dev environment alone (see infra/atria_infra/config.py), and it writes
a synthetic account, never a real person.
"""

from __future__ import annotations

import json
import secrets
import sys
import urllib.error
import urllib.request

import boto3

REGION = "us-east-1"
PREFIX = "atria-dev"

# A synthetic staff account. The tenant, person and roles are what the
# authoriser reads out of the token.
USERNAME = "smoke.receptionist@atria.invalid"
TENANT_ID = "t-cm-smoke"
PERSON_ID = "p-smoke-001"
ROLES = "RECEPTIONIST"


def stack_outputs(name: str) -> dict[str, str]:
    client = boto3.client("cloudformation", region_name=REGION)
    stacks = client.describe_stacks(StackName=name)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in stacks[0].get("Outputs", [])}


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
    """The stage URL, read from the API Gateway rather than guessed."""
    apigateway = boto3.client("apigateway", region_name=REGION)
    for item in apigateway.get_rest_apis(limit=500)["items"]:
        if item["name"] == f"{PREFIX}-api":
            return f"https://{item['id']}.execute-api.{REGION}.amazonaws.com/dev"
    raise SystemExit(f"no REST API named {PREFIX}-api")


def ensure_user(idp, pool_id: str) -> str:  # noqa: ANN001  boto3 client
    """Create the synthetic account if needed and return a usable password."""
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    attributes = [
        {"Name": "email", "Value": USERNAME},
        {"Name": "email_verified", "Value": "true"},
        {"Name": "given_name", "Value": "Smoke"},
        {"Name": "family_name", "Value": "Receptionist"},
        {"Name": "custom:tenantId", "Value": TENANT_ID},
        {"Name": "custom:personId", "Value": PERSON_ID},
        {"Name": "custom:roles", "Value": ROLES},
    ]
    try:
        idp.admin_create_user(
            UserPoolId=pool_id,
            Username=USERNAME,
            UserAttributes=attributes,
            MessageAction="SUPPRESS",
        )
        print(f"created {USERNAME}")
    except idp.exceptions.UsernameExistsException:
        # The immutable attributes cannot be updated, and do not need to be.
        print(f"{USERNAME} already exists")

    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=USERNAME, Password=password, Permanent=True
    )
    return password


def sign_in(idp, pool_id: str, client_id: str, password: str) -> str:  # noqa: ANN001
    response = idp.admin_initiate_auth(
        UserPoolId=pool_id,
        ClientId=client_id,
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": USERNAME, "PASSWORD": password},
    )
    if "AuthenticationResult" not in response:
        raise SystemExit(f"sign-in needs a challenge: {response.get('ChallengeName')}")
    return str(response["AuthenticationResult"]["AccessToken"])


def call(url: str, token: str | None) -> tuple[int, str]:
    request = urllib.request.Request(url, method="GET")  # noqa: S310  https only, built above
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
    client_id = find_client(idp, pool_id, "staff")
    base = api_base()
    print(f"pool {pool_id}, client {client_id}\napi  {base}")

    password = ensure_user(idp, pool_id)
    token = sign_in(idp, pool_id, client_id, password)
    print(f"token acquired, {len(token)} characters")

    status, body = call(f"{base}/me", token)
    print(f"\nGET /me with a token: {status}")
    print(json.dumps(json.loads(body), indent=2) if body else "(no body)")
    signed_in_ok = status == 200

    # The same call without a token must be refused by the authoriser.
    status_anon, body_anon = call(f"{base}/me", None)
    print(f"\nGET /me without a token: {status_anon} {body_anon.strip()[:120]}")
    refused_ok = status_anon in (401, 403)

    print()
    if signed_in_ok and refused_ok:
        print("walking skeleton works: signed in 200, anonymous refused")
        return 0
    print("walking skeleton is not working")
    return 1


if __name__ == "__main__":
    sys.exit(main())
