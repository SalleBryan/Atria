"""Atria Rev B region packs.

Single source for what a region pack contains. The model says which fields a
pack has (REGION_PACK in model.py); this says what they hold for each country.
A second country is a new entry here, not a code change (D-13, FR-TEN-06).

A value this project could not confirm is None, with the reason beside it,
rather than a plausible guess. A wrong national ID pattern would refuse real
patients, and a wrong emergency number printed on a disruption notice is worse
than none.
"""

from __future__ import annotations

from typing import Any

CAMEROON: dict[str, Any] = {
    "code": "CM",
    "currency": "XAF",
    "dialCode": "+237",
    # Every Cameroonian mobile number is nine digits beginning with 6.
    "msisdnPattern": r"^\+2376\d{8}$",
    # French first: it is the default where a person states no preference.
    "languages": ["fr", "en"],
    # UTC+1 all year, with no daylight saving.
    "timezone": "Africa/Douala",
    "administrativeRegions": [
        "Adamaoua",
        "Centre",
        "Est",
        "Extreme-Nord",
        "Littoral",
        "Nord",
        "Nord-Ouest",
        "Ouest",
        "Sud",
        "Sud-Ouest",
    ],
    # To confirm: the CNI number format. A pattern that is wrong would refuse
    # real identity documents, so none is enforced until it is confirmed.
    "nationalIdPattern": None,
    # The fixed-date public holidays, as month and day. The movable ones, Good
    # Friday, Ascension, Eid al-Fitr and Eid al-Adha, fall on different dates
    # each year and are added per year by the tenant.
    "publicHolidays": [
        {"date": "01-01", "name": "Nouvel An"},
        {"date": "02-11", "name": "Fete de la Jeunesse"},
        {"date": "05-01", "name": "Fete du Travail"},
        {"date": "05-20", "name": "Fete Nationale"},
        {"date": "08-15", "name": "Assomption"},
        {"date": "12-25", "name": "Noel"},
    ],
    # To confirm with the pilot clinic before anything prints it (see the
    # module note on why no guess is made).
    "emergencyNumber": None,
    "smsSenderIdPolicy": (
        "A sender ID must be registered separately with MTN, Orange and Camtel. "
        "Unverified for this project: see open issue OI-04."
    ),
    # D-11: in Cameroon a rating never changes a fee, and the data layer
    # refuses a tenant setting that would link them.
    "allowsRatingFeeLink": False,
}

REGION_PACKS: dict[str, dict[str, Any]] = {"CM": CAMEROON}


def region_pack(code: str) -> dict[str, Any]:
    """The pack for a country code. An unknown code is an error, not a default."""
    try:
        return REGION_PACKS[code]
    except KeyError:
        raise KeyError(f"no region pack for {code}") from None
