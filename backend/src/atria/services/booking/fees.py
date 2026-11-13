"""The fee a visit of one type will be asked for on one day (AD-07).

One lookup serves a whole day: the fee band of each distinct appointment type is
read once, however many places carry that type. Only an amount and its currency
leave here. A fee carries no rating or score, and nothing in Atria moves money.
"""

from __future__ import annotations

from typing import Any

from atria.data import keys
from atria.data.repository import Repository
from atria.data.settings import Settings

Fee = dict[str, Any]


class FeeLookup:
    """Fees for the types seen on one tenant's local day, each looked up once."""

    def __init__(self, repository: Repository, tenant_id: str, day: str) -> None:
        self._repo = repository
        self._tenant_id = tenant_id
        self._day = day
        self._seen: dict[str, Fee | None] = {}
        self._currency: str | None = None

    def currency(self) -> str:
        if self._currency is None:
            tenant = self._repo.get(keys.tenant(self._tenant_id)) or {}
            pack = self._repo.get(keys.region_pack(str(tenant.get("regionPackCode") or "CM")))
            self._currency = str((pack or {}).get("currency") or "XAF")
        return self._currency

    def for_type(self, type_id: object) -> Fee | None:
        """The band in force on the day, or None when the type has no fee band."""
        if not type_id:
            return None
        key = str(type_id)
        if key not in self._seen:
            self._seen[key] = self._lookup(key)
        return self._seen[key]

    def _lookup(self, type_id: str) -> Fee | None:
        kind = self._repo.get(keys.appointment_type(self._tenant_id, type_id)) or {}
        band_id = kind.get("feeBandId")
        if not band_id:
            return None
        band = Settings(self._repo).fee_band_on(self._tenant_id, str(band_id), self._day)
        if not band or band.get("baseAmountMinor") is None:
            return None
        return {"amountMinor": int(str(band["baseAmountMinor"])), "currency": self.currency()}
