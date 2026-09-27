"""Writing a tenant's configuration: its settings, units, appointment types and fee bands.

The readers already exist (atria.data.catalogue lists units and types for the
directory); this is what changes them without a release (FR-ADM-03, FR-ADM-06).
A write keeps the directory listing in step with the record, through the same
listing helpers the catalogue applies, so a unit renamed here sorts under its
new name and a retired type leaves what a patient can pick.

A fee band is never changed in place. A new amount is a new version dated
from today, and the old one stays, because a ledger entry written last month
must still be explained by the amount in force last month (D-11).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.data import catalogue, keys
from atria.data.people import new_id
from atria.data.repository import Item, Repository

FEE = "FEE"


def fee_band_listing(tenant_id: str, band_id: str) -> dict[str, str]:
    return {"directoryKey": catalogue.directory_key(tenant_id, FEE), "directorySort": band_id}


class Settings:
    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    @property
    def repository(self) -> Repository:
        return self._repo

    def today(self) -> str:
        return self._clock().date().isoformat()

    # ------------------------------------------------------------------ tenant
    def tenant(self, tenant_id: str) -> Item:
        return self._repo.require(keys.tenant(tenant_id), what="tenant", consistent=True)

    def region_pack(self, code: str) -> Item:
        return self._repo.require(keys.region_pack(code), what="region pack")

    def update_tenant(self, tenant_id: str, changes: dict[str, Any]) -> Item:
        return self._repo.update_existing(keys.tenant(tenant_id), set_values=changes, what="tenant")

    # ------------------------------------------------------------------- units
    def clinic(self, tenant_id: str, clinic_id: str) -> Item:
        return self._repo.require(keys.clinic(tenant_id, clinic_id), what="unit")

    def update_clinic(self, tenant_id: str, clinic_id: str, changes: dict[str, Any]) -> Item:
        values = dict(changes)
        if "name" in values:
            values.update(catalogue.clinic_listing(tenant_id, clinic_id, str(values["name"])))
        return self._repo.update_existing(
            keys.clinic(tenant_id, clinic_id), set_values=values, what="unit"
        )

    # ------------------------------------------------------- appointment types
    def appointment_types(self, tenant_id: str) -> list[Item]:
        """Every type, retired ones too: the administrator's list, not the patient's."""
        return catalogue.Catalogue(self._repo).all_appointment_types(tenant_id)

    def appointment_type(self, tenant_id: str, type_id: str) -> Item:
        return self._repo.require(
            keys.appointment_type(tenant_id, type_id), what="appointment type"
        )

    def create_appointment_type(self, tenant_id: str, fields: dict[str, Any]) -> Item:
        type_id = new_id("at")
        item = {
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": type_id,
            "tenantId": tenant_id,
            **{name: value for name, value in fields.items() if value is not None},
            **catalogue.appointment_type_listing(
                tenant_id, type_id, str(fields["name"]), active=bool(fields.get("active"))
            ),
        }
        return self._repo.put_new(
            keys.appointment_type(tenant_id, type_id), item, what="appointment type"
        )

    def update_appointment_type(self, tenant_id: str, type_id: str, fields: dict[str, Any]) -> Item:
        listing = catalogue.appointment_type_listing(
            tenant_id, type_id, str(fields["name"]), active=bool(fields.get("active"))
        )
        present = {name: value for name, value in fields.items() if value is not None}
        # A null clears a field: durationUnits on a general type, clinicIds
        # when a type opens to every unit.
        cleared = [name for name, value in fields.items() if value is None]
        return self._repo.update_existing(
            keys.appointment_type(tenant_id, type_id),
            set_values={**present, **listing},
            remove=cleared,
            what="appointment type",
        )

    # --------------------------------------------------------------- fee bands
    def fee_bands(self, tenant_id: str) -> list[Item]:
        """The band in force for each practice: the newest version of each."""
        listed = self._repo.query_index(
            catalogue.DIRECTORY_INDEX, "directoryKey", catalogue.directory_key(tenant_id, FEE)
        )
        return sorted(
            (b for b in listed if b.get("tenantId") == tenant_id),
            key=lambda b: int(b.get("baseAmountMinor") or 0),
        )

    def fee_band_history(self, tenant_id: str, band_id: str) -> list[Item]:
        return self._repo.query_partition(f"{keys.TENANT}{tenant_id}#FEE#{band_id}")

    def set_fee_band(self, tenant_id: str, band_id: str, fields: dict[str, Any]) -> Item:
        """A new version from today; the one it replaces leaves the listing, and stays."""
        today = self.today()
        history = self.fee_band_history(tenant_id, band_id)
        current = [b for b in history if b.get("directoryKey")]
        item = {
            "type": "FEE_BAND",
            "feeBandId": band_id,
            "tenantId": tenant_id,
            **fields,
            "effectiveFrom": today,
            **fee_band_listing(tenant_id, band_id),
        }
        key = keys.fee_band(tenant_id, band_id, today)
        if any(b.get("effectiveFrom") == today for b in history):
            # A second change the same day replaces that day's version.
            self._repo.put(key, item)
        else:
            self._repo.put_new(key, item, what="fee band version")
        for previous in current:
            if previous.get("effectiveFrom") != today:
                self._repo.update_existing(
                    keys.fee_band(tenant_id, band_id, str(previous["effectiveFrom"])),
                    set_values={"supersededOn": today},
                    remove=["directoryKey", "directorySort"],
                    what="fee band version",
                )
        return {**item, **key.as_item()}

    def fee_band_on(self, tenant_id: str, band_id: str, day: str) -> Item | None:
        """The version in force on a day, for the ledger (FR-MSR-05)."""
        versions = sorted(
            self.fee_band_history(tenant_id, band_id), key=lambda b: str(b.get("effectiveFrom"))
        )
        chosen = None
        for version in versions:
            if str(version.get("effectiveFrom")) <= day:
                chosen = version
        return chosen or (versions[0] if versions else None)
