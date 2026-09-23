"""Idempotency records, so a retried request does not book twice.

A client that does not hear back cannot tell a lost response from a lost
request, so it retries. The slot locks already stop the second attempt becoming
a second appointment, but they turn it into a 409, which tells a patient their
booking failed when it actually succeeded. This gives the retry the original
answer instead (FR-BKG-04).

The record is claimed before the work starts, not written after it. Two
requests arriving together would otherwise both find nothing recorded and both
proceed, which is exactly the double click this exists to absorb. The claim is
a conditional put, so one request owns the key and the other is told the work
is already in flight.

A key is also tied to the request it was first used with. Reusing one key for a
different booking is a client bug, and answering it with the earlier
appointment would be worse than refusing it.

Records expire after 24 hours through the table's TTL, so nothing here is ever
deleted by this module.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from typing import Any

from atria.core.errors import Conflict, Invalid
from atria.data import keys
from atria.data.repository import Item, Repository

IN_PROGRESS = "IN_PROGRESS"
COMPLETED = "COMPLETED"

# How long a repeated request gets the original answer (FR-BKG-04).
WINDOW = dt.timedelta(hours=24)

# Long enough to be unguessable, short enough to keep in a header.
MIN_KEY_LENGTH = 8
MAX_KEY_LENGTH = 200


def fingerprint(body: dict[str, Any]) -> str:
    """A stable digest of the request, so one key cannot serve two requests.

    Sorted keys, because a client that reorders its JSON has not changed what
    it asked for.
    """
    rendered = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(rendered.encode()).hexdigest()


def validate_key(value: str) -> str:
    key = value.strip()
    if not MIN_KEY_LENGTH <= len(key) <= MAX_KEY_LENGTH:
        raise Invalid(
            "Idempotency-Key must be between 8 and 200 characters",
            detail={"minimum": MIN_KEY_LENGTH, "maximum": MAX_KEY_LENGTH},
        )
    return key


class Idempotency:
    """Claims a key, then records what the work returned."""

    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    def claim(self, tenant_id: str, key: str, *, request: dict[str, Any]) -> Item | None:
        """Take ownership of a key, or return the record that already holds it.

        None means this caller owns it and should do the work. Anything else is
        a repeat, and the caller decides what to do with it.
        """
        digest = fingerprint(request)
        now = self._clock()
        try:
            self._repo.put_new(
                keys.idempotency(tenant_id, key),
                {
                    "type": "IDEMPOTENCY",
                    "tenantId": tenant_id,
                    "idempotencyKey": key,
                    "fingerprint": digest,
                    "status": IN_PROGRESS,
                    "claimedAt": now.isoformat(timespec="seconds"),
                    "expiresAt": int((now + WINDOW).timestamp()),
                },
                what="idempotency key",
            )
        except Conflict:
            held = self._repo.get(keys.idempotency(tenant_id, key), consistent=True)
            if held is None:  # pragma: no cover  expired between the write and the read
                return None
            if str(held.get("fingerprint")) != digest:
                raise Conflict(
                    "that Idempotency-Key was already used for a different request",
                    detail={"idempotencyKey": key},
                ) from None
            return held
        return None

    def record(self, tenant_id: str, key: str, *, response: dict[str, Any]) -> None:
        """Keep what the work returned, so a later retry can be given it."""
        self._repo.update_existing(
            keys.idempotency(tenant_id, key),
            set_values={"status": COMPLETED, "response": response},
            what="idempotency key",
        )

    def release(self, tenant_id: str, key: str) -> None:
        """Give the key up because the work failed.

        Without this a request that failed for its own reasons would leave the
        key claimed, and the client's retry would be refused for 24 hours
        rather than being allowed to try again.
        """
        self._repo.delete(keys.idempotency(tenant_id, key))
