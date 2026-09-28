"""Accounts waiting out their 30 days before they are erased (2026-09-29).

A deleted account is not erased at once: for GRACE_DAYS it can be restored,
by the patient who deleted it or by an administrator. Each one waiting has an
entry in one partition, sorted by the moment it becomes due, so the daily
purge reads only what is due:

    pk  DELETIONS
    sk  {purgeAt}#{tenantId}#{kind}#{subjectId}

kind is PATIENT (the subject is a patient profile) or STAFF (a staff
membership). The entry is removed on restore and after the purge.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.data.keys import Key
from atria.data.repository import Item, Repository

GRACE_DAYS = 30
PARTITION = "DELETIONS"
KINDS = ("PATIENT", "STAFF")


def stamp(instant: dt.datetime) -> str:
    return instant.astimezone(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def key(purge_at: str, tenant_id: str, kind: str, subject_id: str) -> Key:
    return Key(PARTITION, f"{purge_at}#{tenant_id}#{kind}#{subject_id}")


class Deletions:
    def __init__(self, repository: Repository) -> None:
        self._repo = repository

    def schedule(
        self,
        *,
        tenant_id: str,
        kind: str,
        subject_id: str,
        person_id: str,
        by: str,
        by_person_id: str,
        now: dt.datetime,
    ) -> dict[str, Any]:
        """Record a deletion and when it becomes final; returns what the record keeps."""
        requested = stamp(now)
        purge_at = stamp(now + dt.timedelta(days=GRACE_DAYS))
        pending = {
            "requestedAt": requested,
            "purgeAt": purge_at,
            "by": by,
            "byPersonId": by_person_id,
        }
        self._repo.put(
            key(purge_at, tenant_id, kind, subject_id),
            {
                "type": "DELETION",
                "tenantId": tenant_id,
                "kind": kind,
                "subjectId": subject_id,
                "personId": person_id,
                **pending,
            },
        )
        return pending

    def withdraw(self, *, tenant_id: str, kind: str, subject_id: str, purge_at: str) -> None:
        self._repo.delete(key(purge_at, tenant_id, kind, subject_id))

    def due(self, now: dt.datetime) -> list[Item]:
        """Every deletion whose 30 days are over, oldest first."""
        cutoff = stamp(now)
        return [e for e in self._repo.query_partition(PARTITION) if str(e["sk"]) <= cutoff]
