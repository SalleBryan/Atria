"""Push notices to the browsers a person allowed notifications on.

Push rides beside SMS and email, never instead of them: a notice that cannot
be pushed is still texted and emailed, so nothing here ever fails a job. The
VAPID private key lives in an SSM SecureString parameter and is read once per
container.
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any

import boto3
from aws_lambda_powertools import Logger

from atria.core import webpush
from atria.core.errors import Invalid
from atria.data.push import Subscriptions
from atria.data.repository import Repository

logger = Logger(service="atria-push")

VAPID_PARAMETER = os.environ.get("VAPID_PARAMETER", "")

_vapid: webpush.Vapid | None = None
_subscriptions: Subscriptions | None = None


def vapid() -> webpush.Vapid | None:
    """The hospital's VAPID key, or None where push is not configured."""
    global _vapid
    if _vapid is None and VAPID_PARAMETER:
        found = boto3.client("ssm").get_parameter(Name=VAPID_PARAMETER, WithDecryption=True)
        _vapid = webpush.Vapid.from_pem(str(found["Parameter"]["Value"]))
    return _vapid


def use(key: webpush.Vapid | None, store: Subscriptions | None = None) -> None:
    """For tests: the key and the store to use."""
    global _vapid, _subscriptions
    _vapid = key
    _subscriptions = store


def subscriptions() -> Subscriptions:
    global _subscriptions
    if _subscriptions is None:
        _subscriptions = Subscriptions(Repository())
    return _subscriptions


def subscribe(person_id: str, body: dict[str, Any], *, at: dt.datetime) -> dict[str, Any]:
    """Keep a browser's subscription, as PushSubscription.toJSON() gives it."""
    endpoint = str(body.get("endpoint") or "")
    given = body.get("keys")
    found: dict[str, Any] = given if isinstance(given, dict) else {}
    p256dh, auth = str(found.get("p256dh") or ""), str(found.get("auth") or "")
    if not endpoint.startswith("https://") or len(endpoint) > 1000 or not p256dh or not auth:
        raise Invalid("a subscription has an https endpoint and its p256dh and auth keys")
    label = str(body.get("label") or "")[:80] or None
    subscriptions().add(person_id, endpoint, p256dh, auth, label=label, at=at)
    return {"subscribed": True}


def notify(person_id: str, *, title: str, body: str, url: str = "/") -> int:
    """Push one notice to every browser the person allowed; return how many took it."""
    key = vapid()
    if key is None:
        return 0
    delivered = 0
    for item in subscriptions().of(person_id):
        try:
            webpush.send(key, item, {"title": title, "body": body, "url": url})
            delivered += 1
        except webpush.Gone:
            subscriptions().remove(person_id, str(item["endpoint"]))
        except Exception:
            logger.exception("a push could not be delivered", extra={"personId": person_id})
    return delivered
