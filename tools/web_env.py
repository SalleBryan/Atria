"""Write web/.env.local from the deployed environment.

    python tools/web_env.py

The web client needs the user pool, its two app clients, the hosted sign-in
domain and the API's origin. None of them is a secret: every one is sent to the
browser. They are read from AWS rather than committed, because they change when
a stack is recreated, and a stale ID fails in ways that look like a code bug.
The file is gitignored.
"""

from __future__ import annotations

import pathlib
import sys

import devkit

TARGET = pathlib.Path(__file__).resolve().parent.parent / "web" / ".env.local"


def main() -> int:
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    domain = idp.describe_user_pool(UserPoolId=pool)["UserPool"].get("Domain")
    if not domain:
        raise SystemExit("the user pool has no hosted domain; deploy the identity stack")
    base = devkit.api_base()
    origin, stage = base.rsplit("/", 1)

    values = {
        "VITE_REGION": devkit.REGION,
        "VITE_USER_POOL_ID": pool,
        "VITE_PATIENT_CLIENT_ID": devkit.app_client(idp, pool, "patient"),
        "VITE_STAFF_CLIENT_ID": devkit.app_client(idp, pool, "staff"),
        "VITE_AUTH_DOMAIN": f"{domain}.auth.{devkit.REGION}.amazoncognito.com",
        # Read by the dev server's proxy only, never sent to the browser.
        "ATRIA_API_ORIGIN": origin,
        "ATRIA_API_STAGE": f"/{stage}",
    }
    TARGET.write_text("".join(f"{k}={v}\n" for k, v in values.items()), encoding="utf-8")
    print(f"wrote {TARGET}")
    for key, value in values.items():
        print(f"  {key}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
