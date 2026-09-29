"""Write app/env/dev.json from the deployed environment.

    python tools/app_env.py
    cd app && flutter run --dart-define-from-file=env/dev.json

The Flutter app needs the user pool, its patient and staff clients and the
API's base URL (ADR 0021). None of them is a secret, and they are read from
AWS rather than committed because they change when a stack is recreated. The
file is gitignored.
"""

from __future__ import annotations

import json
import pathlib
import sys

import devkit

TARGET = pathlib.Path(__file__).resolve().parent.parent / "app" / "env" / "dev.json"


def main() -> int:
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    values = {
        "ATRIA_REGION": devkit.REGION,
        "ATRIA_USER_POOL_ID": pool,
        "ATRIA_PATIENT_CLIENT_ID": devkit.app_client(idp, pool, "patient"),
        "ATRIA_STAFF_CLIENT_ID": devkit.app_client(idp, pool, "staff"),
        "ATRIA_API_BASE": devkit.api_base(),
        # Cognito's hosted sign-in, for Google (app/lib/auth/google.dart).
        "ATRIA_AUTH_DOMAIN": f"{idp.describe_user_pool(UserPoolId=pool)['UserPool']['Domain']}"
        f".auth.{devkit.REGION}.amazoncognito.com",
    }
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(json.dumps(values, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
