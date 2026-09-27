"""A tenant's catalogue: its clinics and the appointment types it offers.

Both are listed through DirectoryIndex, beside the clinicians, each kind in
its own partition of the index: TENANT#<t>#CLINIC and TENANT#<t>#TYPE. Every
type is listed, retired ones too, because the administrator's list needs them;
what a patient can pick is the active ones (appointment_types), which is how
retiring a type drops it from booking without deleting it.

atria.data.settings writes both. The two listing helpers are what any writer
must apply, so a seeded item and a created one list alike.
"""

from __future__ import annotations

from typing import Any

from atria.data import keys
from atria.data.repository import Item, Repository

DIRECTORY_INDEX = "DirectoryIndex"

CLINIC = "CLINIC"
APPOINTMENT_TYPE = "TYPE"


def directory_key(tenant_id: str, kind: str) -> str:
    return f"{keys.TENANT}{tenant_id}#{kind}"


def clinic_listing(tenant_id: str, clinic_id: str, name: str) -> dict[str, str]:
    """The attributes that put a clinic in the directory, sorted by name."""
    return {
        "directoryKey": directory_key(tenant_id, CLINIC),
        "directorySort": f"{name.casefold()}#{clinic_id}",
    }


def appointment_type_listing(
    tenant_id: str, type_id: str, name: str, *, active: bool = True
) -> dict[str, str]:
    """The attributes that list an appointment type, retired or not (see the module note)."""
    del active  # kept in the signature: callers say what they are listing
    return {
        "directoryKey": directory_key(tenant_id, APPOINTMENT_TYPE),
        "directorySort": f"{name.casefold()}#{type_id}",
    }


class Catalogue:
    def __init__(self, repository: Repository) -> None:
        self._repo = repository

    def _listed(self, tenant_id: str, kind: str) -> list[Item]:
        found = self._repo.query_index(
            DIRECTORY_INDEX, "directoryKey", directory_key(tenant_id, kind)
        )
        # The partition names the tenant already; checked again, as every
        # directory read is, so a mislabelled item can never cross tenants.
        return [item for item in found if item.get("tenantId") == tenant_id]

    def clinics(self, tenant_id: str) -> list[Item]:
        return self._listed(tenant_id, CLINIC)

    def appointment_types(self, tenant_id: str) -> list[Item]:
        """What can be booked: the active types."""
        return [t for t in self.all_appointment_types(tenant_id) if t.get("active", True)]

    def all_appointment_types(self, tenant_id: str) -> list[Item]:
        return self._listed(tenant_id, APPOINTMENT_TYPE)


def as_listed(item: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: item.get(name) for name in fields}
