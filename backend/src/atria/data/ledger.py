"""The fee ledger: one entry per visit, written when it closes (FR-MSR-05 to FR-MSR-07).

An entry holds the fee band the visit's type carries, the band's amount on
the day of the visit (the version in force then, atria.data.settings), the
currency of the tenant's region pack, the outcome and what it entitles the
patient to. It is written in the same transaction as the closing transition,
so a closed visit always has its entry and a visit never has two.

Nothing settles. settledAt stays null throughout Phase 2 and no payment,
card, wallet or refund exists anywhere (FR-MSR-07): an entitlement is a
record of what the rules say, never money moved or owed.

Outcomes map to entitlement as FR-MSR-06 lists them:

    ATTENDED             NONE
    CANCELLED_IN_WINDOW  FULL
    CANCELLED_LATE       PARTIAL
    NO_SHOW              NONE
    CLINIC_CANCELLED     FULL
    CLINIC_RESCHEDULED   NONE   recorded on the move's event; the visit stays open
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from zoneinfo import ZoneInfo

from atria.data import keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository
from atria.data.settings import Settings

ENTITLEMENT = {
    "ATTENDED": "NONE",
    "CANCELLED_IN_WINDOW": "FULL",
    "CANCELLED_LATE": "PARTIAL",
    "NO_SHOW": "NONE",
    "CLINIC_CANCELLED": "FULL",
    "CLINIC_RESCHEDULED": "NONE",
}

# The closing transitions that are not cancellations, and the outcome each records.
CLOSING = {"COMPLETED": "ATTENDED", "NO_SHOW": "NO_SHOW"}


class Ledger:
    def __init__(self, repository: Repository) -> None:
        self._repo = repository

    def entry(self, tenant_id: str, appointment_id: str) -> Item | None:
        return self._repo.get(keys.fee_ledger_entry(tenant_id, appointment_id))

    def entry_for(
        self,
        *,
        tenant_id: str,
        appointment: dict[str, Any],
        outcome: str,
        occurred_at: str,
        zone: ZoneInfo,
    ) -> tuple[keys.Key, Item]:
        """The entry a closing visit writes, to go in its closing transaction."""
        if outcome not in ENTITLEMENT:
            raise ValueError(f"unknown outcome {outcome}")
        kind = (
            self._repo.get(
                keys.appointment_type(tenant_id, str(appointment.get("appointmentTypeId")))
            )
            or {}
        )
        band_id = kind.get("feeBandId")
        start = dt.datetime.fromisoformat(str(appointment["startAt"]).replace("Z", "+00:00"))
        day = start.astimezone(zone).date().isoformat()
        band = Settings(self._repo).fee_band_on(tenant_id, str(band_id), day) if band_id else None
        tenant = self._repo.get(keys.tenant(tenant_id)) or {}
        pack = self._repo.get(keys.region_pack(str(tenant.get("regionPackCode") or "CM"))) or {}
        appointment_id = str(appointment["appointmentId"])
        item: Item = {
            "type": "FEE_LEDGER_ENTRY",
            "feeLedgerEntryId": new_id("fl"),
            "appointmentId": appointment_id,
            "tenantId": tenant_id,
            "clinicId": appointment.get("clinicId"),
            "patientProfileId": appointment.get("patientProfileId"),
            "appointmentTypeId": appointment.get("appointmentTypeId"),
            "feeBandId": band_id,
            "practice": band.get("practice") if band else None,
            "bandEffectiveFrom": band.get("effectiveFrom") if band else None,
            # Whole francs; a type with no band records none rather than a guess.
            "amountMinor": int(band.get("baseAmountMinor") or 0) if band else None,
            "currency": pack.get("currency") or "XAF",
            "visitDay": day,
            "outcome": outcome,
            "entitlement": ENTITLEMENT[outcome],
            "closedAt": occurred_at,
            # Nothing settles before Phase 3 (FR-MSR-07).
            "settledAt": None,
        }
        return keys.fee_ledger_entry(tenant_id, appointment_id), {
            k: v for k, v in item.items() if v is not None or k == "settledAt"
        }


def entry_view(entry: dict[str, Any] | None) -> dict[str, Any] | None:
    if not entry:
        return None
    return {
        name: entry.get(name)
        for name in (
            "feeBandId",
            "practice",
            "amountMinor",
            "currency",
            "visitDay",
            "outcome",
            "entitlement",
            "closedAt",
            "settledAt",
        )
    }
