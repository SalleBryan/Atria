"""Web Push (RFC 8030), encrypted (RFC 8291) and signed with VAPID (RFC 8292).

A browser that allows notifications hands the web client a subscription: an
endpoint at its vendor's push service and two keys. A notice is encrypted to
those keys, so the push service carries it without reading it, and signed with
the hospital's VAPID key, so the push service knows who sent it. No account
with any vendor is needed; the VAPID key pair is the only credential.

Written on `cryptography` and PyJWT, which the Lambda layer already carries,
rather than pulling in a push library and its HTTP client.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# One record holds the whole notice; 4096 is the size RFC 8188 suggests.
RECORD_SIZE = 4096

# A notice nobody receives within a day is no longer worth showing.
TTL_SECONDS = 24 * 60 * 60

# Who the push services contact about misuse (RFC 8292 "sub").
CONTACT = os.environ.get("PUSH_CONTACT", "mailto:support@atria.health")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass(frozen=True, slots=True)
class Vapid:
    """The hospital's VAPID key pair."""

    private_key: ec.EllipticCurvePrivateKey

    @classmethod
    def from_pem(cls, pem: str) -> Vapid:
        key = serialization.load_pem_private_key(pem.encode("ascii"), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("a VAPID key is an elliptic curve key")
        return cls(key)

    @classmethod
    def generate(cls) -> Vapid:
        return cls(ec.generate_private_key(ec.SECP256R1()))

    def pem(self) -> str:
        return self.private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("ascii")

    @property
    def public_key(self) -> str:
        """The application server key a browser subscribes with, base64url."""
        raw = self.private_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return b64url(raw)

    def authorization(self, endpoint: str, *, now: float | None = None) -> str:
        parts = urlsplit(endpoint)
        claims = {
            "aud": f"{parts.scheme}://{parts.netloc}",
            "exp": int((now or time.time()) + 12 * 60 * 60),
            "sub": CONTACT,
        }
        token = jwt.encode(claims, self.private_key, algorithm="ES256")
        return f"vapid t={token}, k={self.public_key}"


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(
    plaintext: bytes,
    p256dh: str,
    auth: str,
    *,
    sender: ec.EllipticCurvePrivateKey | None = None,
    salt: bytes | None = None,
) -> bytes:
    """The aes128gcm body for one subscription (RFC 8291 section 3)."""
    ua_public = unb64url(p256dh)
    auth_secret = unb64url(auth)
    sender = sender or ec.generate_private_key(ec.SECP256R1())
    salt = salt or os.urandom(16)
    as_public = sender.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    receiver = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = sender.exchange(ec.ECDH(), receiver)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    # The last (and only) record ends with the delimiter 0x02.
    sealed = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + sealed


def decrypt(body: bytes, receiver: ec.EllipticCurvePrivateKey, auth: str) -> bytes:
    """The browser's side, for tests: read back what `encrypt` sealed."""
    salt, idlen = body[:16], body[20]
    as_public = body[21 : 21 + idlen]
    ua_public = receiver.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    sender = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    shared = receiver.exchange(ec.ECDH(), sender)
    ikm = _hkdf(unb64url(auth), shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    opened = AESGCM(cek).decrypt(nonce, body[21 + idlen :], None)
    return opened.rstrip(b"\x00")[:-1]


class Gone(Exception):  # noqa: N818  named for what the push service says
    """The browser unsubscribed or the subscription expired: forget it."""


def send(vapid: Vapid, subscription: dict[str, Any], payload: dict[str, Any]) -> int:
    """Deliver one notice to one subscription and return the HTTP status.

    Raises Gone for 404 and 410, which say the subscription no longer exists.
    """
    endpoint = str(subscription["endpoint"])
    if not endpoint.startswith("https://"):
        raise ValueError("a push endpoint is an https URL")
    body = encrypt(
        json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        str(subscription["p256dh"]),
        str(subscription["auth"]),
    )
    request = urllib.request.Request(  # noqa: S310  https only, checked above
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL_SECONDS),
            "Urgency": "high",
            "Authorization": vapid.authorization(endpoint),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            return int(response.status)
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            raise Gone(endpoint) from exc
        raise
