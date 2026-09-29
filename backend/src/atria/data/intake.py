"""Intake forms, and the care context a patient's answers become (AD-06).

Forms live in the main table: every version under the form's partition
(`V#<n>`), and the current one again under `CURRENT`, listed in the directory
so the tenant's forms are one query. A version is never overwritten, so an
answer always reads beside the question it answered.

Care context lives in its own table, on its own customer-managed key, with a
TTL (`expiresAt`), and only the booking service is granted it. One item per
appointment: saving again replaces the answers and keeps the history in the
consent records, not in the table.
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any

from atria.core import intake as rules
from atria.core.errors import NotFound
from atria.data import keys
from atria.data.catalogue import DIRECTORY_INDEX, directory_key
from atria.data.keys import Key
from atria.data.people import new_id
from atria.data.repository import Item, Repository

INTAKE_FORM = "FORM"
CARE_CONTEXT_TABLE_ENV = "CARE_CONTEXT_TABLE"


def _stamp(at: dt.datetime) -> str:
    return at.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def form_view(item: Item) -> dict[str, Any]:
    return {
        "intakeFormId": item.get("intakeFormId"),
        "name": item.get("name"),
        "version": int(item.get("version") or 1),
        "fields": item.get("fields") or [],
        "publishedAt": item.get("publishedAt"),
    }


class IntakeForms:
    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    def current(self, tenant_id: str, form_id: str) -> Item | None:
        return self._repo.get(keys.intake_form_current(tenant_id, form_id))

    def require(self, tenant_id: str, form_id: str) -> Item:
        found = self.current(tenant_id, form_id)
        if found is None:
            raise NotFound("no such intake form")
        return found

    def version(self, tenant_id: str, form_id: str, version: int) -> Item | None:
        return self._repo.get(keys.intake_form(tenant_id, form_id, version))

    def all(self, tenant_id: str) -> list[Item]:
        found = self._repo.query_index(
            DIRECTORY_INDEX, "directoryKey", directory_key(tenant_id, INTAKE_FORM)
        )
        return [f for f in found if f.get("tenantId") == tenant_id]

    def publish(
        self, tenant_id: str, fields: dict[str, Any], *, form_id: str | None = None, by: str
    ) -> Item:
        """A new form, or a new version of one; the old versions stay as they were."""
        current = self.current(tenant_id, form_id) if form_id else None
        if form_id and current is None:
            raise NotFound("no such intake form")
        form_id = form_id or new_id("if")
        version = int(current.get("version") or 0) + 1 if current else 1
        item = {
            "type": "INTAKE_FORM",
            "intakeFormId": form_id,
            "tenantId": tenant_id,
            "name": fields["name"],
            "version": version,
            "fields": fields["fields"],
            "publishedAt": _stamp(self._clock()),
            "publishedBy": by,
        }
        self._repo.put_new(keys.intake_form(tenant_id, form_id, version), item, what="intake form")
        listed = {
            **item,
            "directoryKey": directory_key(tenant_id, INTAKE_FORM),
            "directorySort": f"{str(fields['name']).casefold()}#{form_id}",
        }
        self._repo.put(keys.intake_form_current(tenant_id, form_id), listed)
        return item


class CareContexts:
    """The care context table: answers one appointment carries."""

    def __init__(self, repository: Repository | None = None, *, clock: Any = None) -> None:
        self._repo = repository or Repository(table_name=os.environ.get(CARE_CONTEXT_TABLE_ENV))
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    @property
    def repository(self) -> Repository:
        return self._repo

    def get(self, tenant_id: str, appointment_id: str) -> Item | None:
        return self._repo.get(keys.care_context(tenant_id, appointment_id), consistent=True)

    def save(
        self,
        *,
        tenant_id: str,
        appointment: Item,
        form: Item,
        answers: dict[str, Any],
        consent_record_id: str,
    ) -> Item:
        appointment_id = str(appointment["appointmentId"])
        end = dt.datetime.fromisoformat(
            str(appointment.get("endAt") or appointment["startAt"]).replace("Z", "+00:00")
        )
        item = {
            "type": "CARE_CONTEXT",
            "careContextId": f"cc-{appointment_id}",
            "appointmentId": appointment_id,
            "tenantId": tenant_id,
            "patientProfileId": appointment.get("patientProfileId"),
            "intakeFormId": form["intakeFormId"],
            "formVersion": int(form.get("version") or 1),
            "answers": answers,
            "consentRecordId": consent_record_id,
            "submittedAt": _stamp(self._clock()),
            # The TTL: the visit's review window after it ends (D-08).
            "expiresAt": rules.purge_after(max(end, self._clock())),
        }
        return self._repo.put(keys.care_context(tenant_id, appointment_id), item)

    def remove(self, tenant_id: str, appointment_id: str) -> None:
        self._repo.delete(keys.care_context(tenant_id, appointment_id))


def consent_item(
    *, subject_person_id: str, granted_by_person_id: str, method: str, at: dt.datetime
) -> tuple[Key, Item]:
    """A CARE_CONTEXT consent: who agreed to share answers, when and how."""
    granted = _stamp(at)
    consent_id = new_id("cr")
    return (
        keys.consent_record(subject_person_id, granted, consent_id),
        {
            "type": "CONSENT_RECORD",
            "consentRecordId": consent_id,
            "subjectPersonId": subject_person_id,
            "grantedByPersonId": granted_by_person_id,
            "purpose": "CARE_CONTEXT",
            "basis": "CONSENT",
            "method": method,
            "grantedAt": granted,
        },
    )
