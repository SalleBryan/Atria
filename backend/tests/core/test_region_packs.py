"""The region packs hold what the model says a pack holds, and nothing else.

FR-TEN-08: a region pack is data. These checks are what stop the data drifting
from the model, or naming a timezone the runtime cannot resolve.
"""

from __future__ import annotations

import datetime as dt
import re

import pytest
from atria_spec.model import MODEL
from atria_spec.region_packs import CAMEROON, REGION_PACKS, region_pack

from atria.core import schedule

PACK_FIELDS = {name for name, *_ in MODEL["Tenancy and configuration"]["REGION_PACK"][1]}


@pytest.mark.parametrize("code", sorted(REGION_PACKS))
def test_a_pack_has_exactly_the_model_fields(code: str) -> None:
    assert set(REGION_PACKS[code]) == PACK_FIELDS


@pytest.mark.parametrize("code", sorted(REGION_PACKS))
def test_a_pack_is_filed_under_its_own_code(code: str) -> None:
    assert REGION_PACKS[code]["code"] == code


@pytest.mark.parametrize("code", sorted(REGION_PACKS))
def test_the_timezone_resolves_at_runtime(code: str) -> None:
    zone = schedule.timezone_for(REGION_PACKS[code])
    assert zone.key == REGION_PACKS[code]["timezone"]


def test_cameroon_is_utc_plus_one_all_year() -> None:
    zone = schedule.timezone_for(CAMEROON)
    for month in (1, 7):
        offset = dt.datetime(2026, month, 1, 12, tzinfo=zone).utcoffset()
        assert offset == dt.timedelta(hours=1)


def test_the_cameroon_mobile_pattern() -> None:
    pattern = re.compile(CAMEROON["msisdnPattern"])
    assert pattern.match("+237650000000")
    assert not pattern.match("+237250000000")  # a fixed line, not a mobile
    assert not pattern.match("+23765000000")  # one digit short
    assert not pattern.match("+12025550142")
    assert CAMEROON["msisdnPattern"].startswith("^\\" + CAMEROON["dialCode"])


def test_french_is_the_default_language() -> None:
    assert CAMEROON["languages"][0] == "fr"


def test_the_ten_regions_are_distinct() -> None:
    regions = CAMEROON["administrativeRegions"]
    assert len(regions) == 10
    assert len(set(regions)) == 10


def test_holidays_are_real_month_and_day_pairs() -> None:
    for holiday in CAMEROON["publicHolidays"]:
        # 2024 is a leap year, so any real month and day parses.
        dt.date.fromisoformat(f"2024-{holiday['date']}")
        assert holiday["name"]


def test_cameroon_never_links_a_rating_to_a_fee() -> None:
    """D-11, enforced at the data layer from this flag."""
    assert CAMEROON["allowsRatingFeeLink"] is False


def test_an_unknown_code_is_an_error_not_a_default() -> None:
    with pytest.raises(KeyError, match="no region pack for ZZ"):
        region_pack("ZZ")
