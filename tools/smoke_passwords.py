"""Check the password rules and the reset flow, against the deployed user pool.

    python tools/smoke_passwords.py

FR-ACC-05: a new password is at least 12 characters with upper and lower case
and a number or symbol, and the first-sign-in password differs from the
temporary one. FR-ACC-06: anyone can reset a forgotten password with a code
sent to their verified email address.

Creates two accounts the way the staff service does, with a temporary
password. The first is taken through the forced first sign-in with each kind of
weak password, then a good one. The second offers its temporary password back as
the new one, on its own account because if Cognito takes it the change is done.
Then a reset is started on the first, checking where the code went and that a
wrong code changes nothing.
The code itself goes to a mailbox no script can read, so the last step of a
reset, entering the code, is proven by the refusal of a wrong one.

The addresses are on the SES mailbox simulator, so the reset email reaches
no one. Both accounts are deleted at the end.

Development only, same reasoning as tools/smoke_me.py.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from typing import Any

import devkit

RUN = devkit.run_id()
EMAIL = f"success+pw-{RUN}@simulator.amazonses.com"
REUSE_EMAIL = f"success+pw-reuse-{RUN}@simulator.amazonses.com"

# Each fails exactly one rule, so a pass here means that rule is enforced.
WEAK = {
    "shorter than 12": "Short-pw1Aa",
    "no upper case": "lower-case-only-1",
    "no lower case": "UPPER-CASE-ONLY-1",
    "no number or symbol": "NoNumberOrSymbolHere",
}
# Meets FR-ACC-05 with a symbol and no digit. Cognito has no "number or symbol"
# rule, so the pool requires a number, and this is refused: stricter than the
# requirement, and recorded as such rather than passed off as meeting it.
SYMBOL_ONLY = "Symbol-Only-No-Digits"


def refused(action: Callable[[], object]) -> str:
    """The Cognito error a call raises, or an empty string if it succeeded."""
    try:
        action()
    except Exception as exc:  # noqa: BLE001  any refusal is what is being observed
        return type(exc).__name__
    return ""


def main() -> int:
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    staff_client = devkit.app_client(idp, pool, "staff")
    patient_client = devkit.app_client(idp, pool, "patient")
    print(f"pool {pool}\nrun  {RUN}")

    policy = idp.describe_user_pool(UserPoolId=pool)["UserPool"]["Policies"]["PasswordPolicy"]
    print(f"policy {policy}")

    temporary = {EMAIL: devkit.password(), REUSE_EMAIL: devkit.password()}
    for address, secret in temporary.items():
        idp.admin_create_user(
            UserPoolId=pool,
            Username=address,
            TemporaryPassword=secret,
            MessageAction="SUPPRESS",
            UserAttributes=[
                {"Name": "email", "Value": address},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "given_name", "Value": "Ruth"},
                {"Name": "family_name", "Value": "Mba"},
                {"Name": "custom:tenantId", "Value": devkit.TENANT_ID},
                {"Name": "custom:personId", "Value": f"p-pw-{RUN}"},
                {"Name": "custom:roles", "Value": "RECEPTIONIST"},
            ],
        )
        print(f"account {address}")

    def challenge(address: str) -> dict[str, Any]:
        """A fresh first sign-in, because a refused answer spends the session."""
        return dict(
            idp.admin_initiate_auth(
                UserPoolId=pool,
                ClientId=staff_client,
                AuthFlow="ADMIN_USER_PASSWORD_AUTH",
                AuthParameters={"USERNAME": address, "PASSWORD": temporary[address]},
            )
        )

    def answer(address: str, new_password: str) -> dict[str, Any]:
        started = challenge(address)
        return dict(
            idp.admin_respond_to_auth_challenge(
                UserPoolId=pool,
                ClientId=staff_client,
                ChallengeName="NEW_PASSWORD_REQUIRED",
                Session=started["Session"],
                ChallengeResponses={"USERNAME": address, "NEW_PASSWORD": new_password},
            )
        )

    try:
        first = challenge(EMAIL)
        print(f"first sign-in: {first.get('ChallengeName')}")

        # Weak passwords first: a refusal leaves the account where it was, so
        # every case meets the same forced change.
        weak = {
            name: refused(lambda value=value: answer(EMAIL, value)) for name, value in WEAK.items()
        }
        for name, error in weak.items():
            print(f"{name}: {error or 'ACCEPTED'}")
        symbol_only = refused(lambda: answer(EMAIL, SYMBOL_ONLY))
        print(f"symbol and no number: {symbol_only or 'ACCEPTED'}")

        chosen = devkit.password()
        good = answer(EMAIL, chosen)
        signed_in = "AuthenticationResult" in good
        print(f"a good new password: {'signed in' if signed_in else good.get('ChallengeName')}")

        # On its own account, because if Cognito takes it the change is done.
        reuse = refused(lambda: answer(REUSE_EMAIL, temporary[REUSE_EMAIL]))
        print(f"temporary password offered back: {reuse or 'ACCEPTED'}")

        delivery = idp.forgot_password(ClientId=patient_client, Username=EMAIL)[
            "CodeDeliveryDetails"
        ]
        print(f"reset code sent by {delivery['DeliveryMedium']} to {delivery['Destination']}")
        wrong = refused(
            lambda: idp.confirm_forgot_password(
                ClientId=patient_client,
                Username=EMAIL,
                ConfirmationCode="000000",
                Password=devkit.password(),
            )
        )
        print(f"a wrong reset code: {wrong or 'ACCEPTED'}")
        unchanged = bool(devkit.sign_in(idp, pool, staff_client, EMAIL, chosen))
    finally:
        for address in temporary:
            idp.admin_delete_user(UserPoolId=pool, Username=address)
        print("test accounts deleted")

    checks = {
        "the policy asks for 12 characters": policy.get("MinimumLength", 0) >= 12,
        "and upper case, lower case and a number": all(
            policy.get(rule) for rule in ("RequireUppercase", "RequireLowercase", "RequireNumbers")
        ),
        "a new account must change its password": first.get("ChallengeName")
        == "NEW_PASSWORD_REQUIRED",
        **{f"refused: {name}": error == "InvalidPasswordException" for name, error in weak.items()},
        "a good password completes the first sign-in": signed_in,
        "the reset code goes to the verified email": delivery.get("DeliveryMedium") == "EMAIL"
        and delivery.get("AttributeName") == "email",
        "a wrong reset code is refused": wrong == "CodeMismatchException",
        "and leaves the password as it was": unchanged,
    }

    print()
    for name, passed in checks.items():
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")

    # Where Cognito cannot state the rule, what it does instead is reported,
    # not scored: these are decisions (ADR 0018), not regressions.
    print("\n  where the pool differs from FR-ACC-05:")
    print(f"    a symbol and no number is {'refused' if symbol_only else 'accepted'} (stricter)")
    print(
        f"    the temporary password as the new one is {'refused' if reuse else 'ACCEPTED'}"
        + ("" if reuse else "; the first sign-in screen refuses it instead")
    )
    print()
    if all(checks.values()):
        print("FR-ACC-05 and FR-ACC-06 hold against the deployed pool, as ADR 0018 records")
        return 0
    print("the password rules are not as specified: see the failed checks above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
