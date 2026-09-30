"""Make the Web Push VAPID key for an environment, once.

    python tools/vapid.py atria-dev

Stores the private key as an SSM SecureString at /<prefix>/vapid-private-key,
which the identity service and the notice sender read. It refuses to replace
an existing key: a new key silently breaks every browser already subscribed.
"""

from __future__ import annotations

import sys

import boto3

sys.path.insert(0, "backend/src")
from atria.core.webpush import Vapid  # noqa: E402


def main(prefix: str) -> None:
    name = f"/{prefix}/vapid-private-key"
    ssm = boto3.client("ssm")
    try:
        found = ssm.get_parameter(Name=name, WithDecryption=True)
        print("already made; public key:", Vapid.from_pem(found["Parameter"]["Value"]).public_key)
        return
    except ssm.exceptions.ParameterNotFound:
        pass
    key = Vapid.generate()
    ssm.put_parameter(Name=name, Value=key.pem(), Type="SecureString", Overwrite=False)
    print("made", name, "; public key:", key.public_key)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "atria-dev")
