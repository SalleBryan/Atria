"""Web Push encryption and VAPID signing (RFC 8291, RFC 8292), and the store.

A browser's side is played by a key pair made here: what the sender seals, the
receiver's private key opens, and the VAPID token verifies against the public
key the browser subscribed with.
"""

from __future__ import annotations

import datetime as dt
import os

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from atria.core import webpush
from atria.data.push import Subscriptions
from atria.data.repository import Repository
from atria.services.notify import push


def browser() -> tuple[ec.EllipticCurvePrivateKey, str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return key, webpush.b64url(raw), webpush.b64url(os.urandom(16))


def test_a_sealed_notice_opens_with_the_browsers_key() -> None:
    key, p256dh, auth = browser()
    body = webpush.encrypt(b'{"title":"Hello"}', p256dh, auth)
    assert body[16:20] == webpush.RECORD_SIZE.to_bytes(4, "big")
    assert body[20] == 65
    assert webpush.decrypt(body, key, auth) == b'{"title":"Hello"}'


def test_the_vapid_token_verifies_against_the_public_key() -> None:
    vapid = webpush.Vapid.generate()
    header = vapid.authorization("https://fcm.googleapis.com/fcm/send/abc", now=1_000)
    token = header.split("t=")[1].split(",")[0]
    assert header.endswith(f"k={vapid.public_key}")
    claims = jwt.decode(
        token,
        vapid.private_key.public_key(),
        algorithms=["ES256"],
        audience="https://fcm.googleapis.com",
        options={"verify_exp": False},
    )
    assert claims["exp"] == 1_000 + 12 * 60 * 60


def test_a_key_survives_its_pem() -> None:
    vapid = webpush.Vapid.generate()
    assert webpush.Vapid.from_pem(vapid.pem()).public_key == vapid.public_key


def test_only_https_endpoints_are_sent_to() -> None:
    _, p256dh, auth = browser()
    with pytest.raises(ValueError, match="https"):
        webpush.send(
            webpush.Vapid.generate(),
            {"endpoint": "http://example.com/x", "p256dh": p256dh, "auth": auth},
            {},
        )


def test_notify_reaches_each_browser_and_forgets_gone_ones(
    monkeypatch: pytest.MonkeyPatch, repository: Repository
) -> None:
    store = Subscriptions(repository)
    push.use(webpush.Vapid.generate(), store)
    at = dt.datetime(2026, 9, 30, tzinfo=dt.UTC)
    for name in ("a", "b"):
        _, p256dh, auth = browser()
        push.subscribe(
            "p1",
            {
                "endpoint": f"https://fcm.googleapis.com/{name}",
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            at=at,
        )
    push.subscribe(
        "p1",
        {"endpoint": "https://fcm.googleapis.com/a", "keys": {"p256dh": p256dh, "auth": auth}},
        at=at,
    )
    assert len(store.of("p1")) == 2

    def fake_send(_key: object, item: dict[str, str], _payload: object) -> int:
        if item["endpoint"].endswith("/b"):
            raise webpush.Gone(item["endpoint"])
        return 201

    monkeypatch.setattr(webpush, "send", fake_send)
    assert push.notify("p1", title="t", body="b") == 1
    assert [i["endpoint"] for i in store.of("p1")] == ["https://fcm.googleapis.com/a"]
    push.use(None, None)


def test_a_subscription_needs_its_keys() -> None:
    from atria.core.errors import Invalid

    with pytest.raises(Invalid):
        push.subscribe("p1", {"endpoint": "https://x"}, at=dt.datetime.now(tz=dt.UTC))


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://127.0.0.1/internal",
        "https://169.254.169.254/metadata",
        "https://fcm.googleapis.com.attacker.example/x",
        "https://fcm.googleapis.com@localhost/x",
        "https://fcm.googleapis.com:8443/x",
        "https://fcm.googleapis.com/x#fragment",
        "https://user:secret@fcm.googleapis.com/x",
        "file:///etc/passwd",
    ],
)
def test_push_rejects_internal_and_spoofed_destinations(endpoint: str) -> None:
    with pytest.raises(ValueError, match="push endpoint"):
        webpush.validate_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/test",
        "https://updates.push.services.mozilla.com/wpush/v2/test",
        "https://web.push.apple.com/test",
        "https://test.notify.windows.com/test",
    ],
)
def test_push_accepts_browser_services(endpoint: str) -> None:
    webpush.validate_endpoint(endpoint)


def test_push_does_not_follow_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import MagicMock

    connection = MagicMock()
    connection.getresponse.return_value.status = 302
    connector = MagicMock(return_value=connection)
    monkeypatch.setattr(webpush.http.client, "HTTPSConnection", connector)
    _, p256dh, auth = browser()
    with pytest.raises(ValueError, match="redirects"):
        webpush.send(
            webpush.Vapid.generate(),
            {
                "endpoint": "https://fcm.googleapis.com/test",
                "p256dh": p256dh,
                "auth": auth,
            },
            {},
        )
    connector.assert_called_once_with("fcm.googleapis.com", timeout=10)
    connection.request.assert_called_once()
    connection.close.assert_called_once()
