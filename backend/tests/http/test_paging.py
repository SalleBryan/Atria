"""Every list comes a page at a time (NFR-PERF-04)."""

from __future__ import annotations

import pytest

from atria.core.errors import Invalid
from atria.http import paging

FIVE = ["a", "b", "c", "d", "e"]


def test_a_page_is_never_longer_than_fifty():
    shown, more = paging.window(list(range(120)), limit="500", cursor=None)
    assert len(shown) == paging.PAGE_LIMIT == 50
    assert more["count"] == 120


def test_the_next_cursor_walks_the_list_and_stops_at_its_end():
    seen = []
    cursor = None
    while True:
        shown, more = paging.window(FIVE, limit="2", cursor=cursor)
        seen += shown
        cursor = more["nextCursor"]
        if cursor is None:
            break
    assert seen == FIVE


def test_the_endpoint_default_applies_without_a_limit():
    shown, _more = paging.window(FIVE, limit=None, cursor=None, default=3)
    assert shown == ["a", "b", "c"]


@pytest.mark.parametrize("cursor", ["not-a-cursor", paging.encode_cursor(-4)])
def test_a_cursor_the_list_did_not_give_out_is_refused(cursor):
    with pytest.raises(Invalid):
        paging.window(FIVE, limit=None, cursor=cursor)


def test_a_limit_that_is_not_a_number_is_refused():
    with pytest.raises(Invalid):
        paging.page_size("ten")
