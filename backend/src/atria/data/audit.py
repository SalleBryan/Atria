"""The audit trail: who did what to which record, when, and from where.

Every read and write of a patient's personal data by staff, and every other
privileged action, leaves one entry (FR-PRV-06, Law 2024/017 section 27). An
entry is written once and never changed: the only write this module makes is
a conditional create, and the deployed functions are refused UpdateItem and
DeleteItem on these keys by IAM (FR-ADM-04), so not even a bug here can edit
the past.

Entries are partitioned by the tenant's day, so a day is one query and a
month is thirty one of them, which is the widest range the log reads at once.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.data import keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository

# A month, as the rest of the console reads ranges. Wider is an export job,
# not a screen.
MAX_DAYS = 31

# The only flag the rules raise today (guard rule REASONED_AND_AUDITED).
POTENTIAL_SELF_BENEFIT = "POTENTIAL_SELF_BENEFIT"

READ = "READ"
WRITE = "WRITE"


def entry_item(
    *,
    tenant_id: str,
    occurred_at: str,
    actor_person_id: str,
    actor_staff_id: str | None,
    actor_role: str | None,
    action: str,
    kind: str,
    subject_type: str,
    subject_id: str,
    clinic_id: str | None,
    patient_profile_ids: list[str],
    reason: str | None,
    flags: list[str],
    source: dict[str, str],
    status: int,
    audit_entry_id: str | None = None,
) -> Item:
    return {
        "type": "AUDIT_ENTRY",
        "auditEntryId": audit_entry_id or new_id("au"),
        "tenantId": tenant_id,
        "actorPersonId": actor_person_id,
        "actorStaffId": actor_staff_id,
        "actorRole": actor_role,
        "action": action,
        "kind": kind,
        "subjectType": subject_type,
        "subjectId": subject_id,
        "clinicId": clinic_id,
        "patientProfileIds": patient_profile_ids,
        "reason": reason,
        "flags": flags,
        "source": source,
        "status": status,
        "occurredAt": occurred_at,
    }


class AuditLog:
    """Writes one entry at a time, and reads a range of days back."""

    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    @property
    def repository(self) -> Repository:
        return self._repo

    def now(self) -> dt.datetime:
        return self._clock()

    def record(self, item: Item) -> Item:
        """Create an entry. A second write of the same entry is refused, never merged."""
        occurred = str(item["occurredAt"])
        key = keys.audit_entry(
            str(item["tenantId"]), occurred[:10], occurred, str(item["auditEntryId"])
        )
        return self._repo.put_new(key, item, what="audit entry")

    def entries(self, tenant_id: str, first: dt.date, last: dt.date) -> list[Item]:
        """Every entry from `first` to `last` (UTC days, both included), newest first."""
        if last < first:
            raise ValueError("last is before first")
        if (last - first).days + 1 > MAX_DAYS:
            raise ValueError("wider than the log reads at once")
        found: list[Item] = []
        day = last
        while day >= first:
            partition = keys.audit_entry(tenant_id, day.isoformat(), "", "").pk
            found.extend(
                sorted(
                    self._repo.query_partition(partition),
                    key=lambda item: str(item.get("sk", "")),
                    reverse=True,
                )
            )
            day -= dt.timedelta(days=1)
        return found
