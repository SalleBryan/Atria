"""The patient register: finding a patient by name, phone or patient number (FR-STF-06).

A register is what the front desk asks first, and the table has no index that
answers "whose name starts with Ngo" or "whose number is +2376...". Rather than
a new index, each patient has a handful of small entries in one partition per
tenant, TENANT#<t>#REG, with sort keys that begin with what is searched:

    NAME#<family given>#<profile>   and   NAME#<given family>#<profile>
    PHONE#<e164>#<profile>
    NUM#<patient number>#<profile>

so each search is one begins_with query, and an entry carries what a result
row shows. The names are folded (no case, no accents) so "ngo" finds "Ngô".

Entries are written with the profile they describe, in the same transaction
where the profile is created (registration, and the desk's minimal record),
and replaced when the details change. tools/backfill_register.py adds them for
patients registered before the register existed.

A patient number is the hospital's own identifier, given once at creation from
a counter on the tenant: prefix, a dash, six digits.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from atria.data import keys
from atria.data.repository import Item, Repository

REG = "REG"
DEFAULT_PREFIX = "P"

# The most a search answers: a desk refines rather than scrolls.
MAX_RESULTS = 20


def fold(text: str) -> str:
    """Lower case, no accents, single spaces: how names are stored and searched."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", plain.lower())).strip()


def partition(tenant_id: str) -> str:
    return keys.register_entry(tenant_id, "", "", "").pk


def patient_number(prefix: str, n: int) -> str:
    return f"{prefix}-{n:06d}"


def entries(
    *,
    tenant_id: str,
    patient_profile_id: str,
    person_id: str,
    given_name: str,
    family_name: str,
    phone_e164: str | None,
    patient_number: str | None,
    date_of_birth: str | None = None,
) -> list[tuple[keys.Key, Item]]:
    """Every register entry for one patient, each carrying what a result row shows."""
    shown: Item = {
        "type": "REGISTER_ENTRY",
        "tenantId": tenant_id,
        "patientProfileId": patient_profile_id,
        "personId": person_id,
        "givenName": given_name,
        "familyName": family_name,
        "phoneE164": phone_e164,
        "patientNumber": patient_number,
        "dateOfBirth": date_of_birth,
    }
    found: list[tuple[str, str]] = []
    family_first = fold(f"{family_name} {given_name}")
    given_first = fold(f"{given_name} {family_name}")
    if family_first:
        found.append(("NAME", family_first))
    if given_first and given_first != family_first:
        found.append(("NAME", given_first))
    if phone_e164:
        found.append(("PHONE", phone_e164))
    if patient_number:
        found.append(("NUM", patient_number.upper()))
    item = {k: v for k, v in shown.items() if v is not None}
    return [
        (keys.register_entry(tenant_id, kind, value, patient_profile_id), item)
        for kind, value in found
    ]


def search_prefix(query: str) -> str | None:
    """The sort key prefix a query means, or None when it is too short to mean anything."""
    raw = query.strip()
    digits = re.sub(r"[\s().-]", "", raw)
    if re.fullmatch(r"\+?\d{6,15}", digits):
        # A number: with its country code, or as a person would say it locally.
        return f"PHONE#{digits if digits.startswith('+') else '+' + digits}"
    if re.fullmatch(r"[A-Za-z]{1,4}-?\d{2,}", raw):
        letters, number = re.match(r"([A-Za-z]+)-?(\d+)", raw).groups()  # type: ignore[union-attr]
        return f"NUM#{letters.upper()}-{number}"
    folded = fold(raw)
    if len(folded) < 2:
        return None
    return f"NAME#{folded}"


class Register:
    def __init__(self, repository: Repository) -> None:
        self._repo = repository

    def search(self, tenant_id: str, query: str, *, dial_code: str = "+237") -> list[Item]:
        """Patients matching a name, phone or number, each once, at most MAX_RESULTS."""
        prefix = search_prefix(query)
        if prefix is None:
            return []
        found = self._repo.query_partition(partition(tenant_id), sk_prefix=prefix)
        if (
            not found
            and prefix.startswith("PHONE#+")
            and not prefix.startswith(f"PHONE#{dial_code}")
        ):
            # "691 78 34 85" is a local number: try it with the country code.
            local = prefix.removeprefix("PHONE#+")
            found = self._repo.query_partition(
                partition(tenant_id), sk_prefix=f"PHONE#{dial_code}{local}"
            )
        seen: dict[str, Item] = {}
        for entry in found:
            if entry.get("tenantId") != tenant_id:
                continue
            seen.setdefault(str(entry["patientProfileId"]), entry)
            if len(seen) >= MAX_RESULTS:
                break
        return list(seen.values())

    def by_phone(self, tenant_id: str, phone_e164: str) -> list[Item]:
        return [
            e
            for e in self._repo.query_partition(
                partition(tenant_id), sk_prefix=f"PHONE#{phone_e164}#"
            )
            if e.get("tenantId") == tenant_id
        ]

    def next_number(self, tenant_id: str, prefix: str = DEFAULT_PREFIX) -> str:
        return patient_number(
            prefix, self._repo.increment(keys.counter(tenant_id, "patientNumber"), "value")
        )

    def replace(
        self, tenant_id: str, patient_profile_id: str, new: list[tuple[keys.Key, Item]]
    ) -> None:
        """Put a patient's entries as they are now, dropping ones that no longer apply."""
        current = [
            e
            for e in self._repo.query_partition(partition(tenant_id))
            if e.get("patientProfileId") == patient_profile_id
        ]
        keep = {key.sk for key, _ in new}
        for key, item in new:
            self._repo.put(key, item)
        for entry in current:
            if entry["sk"] not in keep:
                self._repo.delete(keys.Key(str(entry["pk"]), str(entry["sk"])))


def view(entry: dict[str, Any]) -> dict[str, Any]:
    """A search result: who, and enough to tell two people of one name apart."""
    return {
        "patientProfileId": entry.get("patientProfileId"),
        "givenName": entry.get("givenName"),
        "familyName": entry.get("familyName"),
        "phoneE164": entry.get("phoneE164"),
        "patientNumber": entry.get("patientNumber"),
        "dateOfBirth": entry.get("dateOfBirth"),
    }
