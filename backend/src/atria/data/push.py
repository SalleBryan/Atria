"""Where a person allowed notifications: one item per browser subscription.

Kept on the person, not on a tenant, because notices follow the person across
hospitals like their phone number does. The subscription's identity is a hash
of its endpoint, so allowing notifications twice on one browser keeps one item.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from typing import Any

from atria.data import keys
from atria.data.repository import Item, Repository

PREFIX = "PUSH#"


def subscription_id(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:32]


class Subscriptions:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    def add(
        self,
        person_id: str,
        endpoint: str,
        p256dh: str,
        auth: str,
        *,
        label: str | None,
        at: dt.datetime,
    ) -> Item:
        sid = subscription_id(endpoint)
        item: dict[str, Any] = {
            "type": "PUSH_SUBSCRIPTION",
            "personId": person_id,
            "subscriptionId": sid,
            "endpoint": endpoint,
            "p256dh": p256dh,
            "auth": auth,
            "label": label,
            "createdAt": at.isoformat().replace("+00:00", "Z"),
        }
        return self.repository.put(keys.push_subscription(person_id, sid), item)

    def remove(self, person_id: str, endpoint: str) -> None:
        self.repository.delete(keys.push_subscription(person_id, subscription_id(endpoint)))

    def of(self, person_id: str) -> list[Item]:
        return self.repository.query_partition(f"PERSON#{person_id}", sk_prefix=PREFIX)
