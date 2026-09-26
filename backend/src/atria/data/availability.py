"""A clinician's working hours and the time taken away from them.

Both live in the clinician's own partition, next to each other, so the free
search reads them in one query:

    AVAIL#<weekday>               one working span per weekday (FR-DIR-03)
    EXC#<date>#<exceptionId>      one taken-away span per date (FR-DIR-04, 05)

An exception is always kind UNAVAILABLE, which is what the free search reads;
`source` says how it was taken (a block, leave, or the clinician marked
unavailable), which decides what happened to the visits inside it.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core.errors import NotFound
from atria.data import keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository


class Availability:
    def __init__(self, repository: Repository) -> None:
        self._repo = repository

    def _partition(self, tenant_id: str, clinician_id: str) -> str:
        return keys.availability_template(tenant_id, clinician_id, 0).pk

    def hours(self, tenant_id: str, clinician_id: str) -> list[Item]:
        """The clinician's working spans, Monday first. Empty means the unit's hours."""
        found = self._repo.query_partition(
            self._partition(tenant_id, clinician_id), sk_prefix="AVAIL#"
        )
        return sorted(found, key=lambda item: int(item.get("weekday", 0)))

    def set_hours(
        self,
        *,
        tenant_id: str,
        clinician_id: str,
        clinic_id: str,
        hours: dict[int, tuple[str, str]],
        actor_person_id: str,
        at: str,
    ) -> list[Item]:
        """Replace the week. A weekday not given is a day off, so its span goes."""
        written: list[Item] = []
        for weekday in range(7):
            key = keys.availability_template(tenant_id, clinician_id, weekday)
            if weekday not in hours:
                self._repo.delete(key)
                continue
            start, end = hours[weekday]
            item = {
                "type": "AVAILABILITY_TEMPLATE",
                "availabilityTemplateId": f"{clinician_id}#{weekday}",
                "tenantId": tenant_id,
                "clinicianProfileId": clinician_id,
                "clinicId": clinic_id,
                "weekday": weekday,
                "startTime": start,
                "endTime": end,
                "updatedAt": at,
                "updatedByPersonId": actor_person_id,
            }
            self._repo.put(key, item)
            written.append(item)
        return written

    def exceptions(
        self, tenant_id: str, clinician_id: str, *, since: str | None = None
    ) -> list[Item]:
        """Time taken away, earliest date first, from `since` (a date) when given."""
        found = self._repo.query_partition(
            self._partition(tenant_id, clinician_id), sk_prefix="EXC#"
        )
        if since:
            found = [item for item in found if str(item.get("exceptionDate", "")) >= since]
        return sorted(
            found,
            key=lambda item: (str(item.get("exceptionDate")), str(item.get("startTime") or "")),
        )

    def add_exceptions(
        self,
        *,
        tenant_id: str,
        clinician_id: str,
        days: list[dt.date],
        start: str | None,
        end: str | None,
        source: str,
        reason: str,
        actor_person_id: str,
        at: str,
    ) -> list[Item]:
        """One exception per date, sharing a group id so leave can be undone as one."""
        group = new_id("x")
        written: list[Item] = []
        for day in days:
            exception_id = f"{group}-{day.isoformat()}"
            item: dict[str, Any] = {
                "type": "AVAILABILITY_EXCEPTION",
                "availabilityExceptionId": exception_id,
                "groupId": group,
                "tenantId": tenant_id,
                "clinicianProfileId": clinician_id,
                "exceptionDate": day.isoformat(),
                "kind": "UNAVAILABLE",
                "source": source,
                "startTime": start,
                "endTime": end,
                "reason": reason,
                "createdAt": at,
                "createdByPersonId": actor_person_id,
            }
            self._repo.put(
                keys.availability_exception(
                    tenant_id, clinician_id, f"{day.isoformat()}#{exception_id}"
                ),
                item,
            )
            written.append(item)
        return written

    def remove_group(self, tenant_id: str, clinician_id: str, group_id: str) -> list[Item]:
        """Give back every date of one block or leave. NotFound when there is none."""
        found = [
            item
            for item in self._repo.query_partition(
                self._partition(tenant_id, clinician_id), sk_prefix="EXC#"
            )
            if item.get("groupId") == group_id
        ]
        if not found:
            raise NotFound("no such time off for that clinician")
        for item in found:
            self._repo.delete(
                keys.availability_exception(
                    tenant_id,
                    clinician_id,
                    f"{item['exceptionDate']}#{item['availabilityExceptionId']}",
                )
            )
        return found
