"""A list response, a page at a time (NFR-PERF-04).

Every list endpoint returns at most PAGE_LIMIT items. The caller asks for a
page with `limit` (at most 50, the endpoint's default otherwise) and passes
back the `nextCursor` of one page as `cursor` to get the next; `nextCursor` is
null on the last page. `count` is how many items the whole list holds, so a
client can say "6 of 23" without reading every page.

The cursor is an offset into the list, which each endpoint returns in a fixed
order. It is opaque to the caller; decoding anything else is refused rather
than guessed at.
"""

from __future__ import annotations

import base64
from typing import Any

from atria.core.errors import Invalid
from atria.http import requests

PAGE_LIMIT = 50


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        offset = int(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode())
    except (ValueError, UnicodeDecodeError) as exc:
        raise Invalid("that cursor is not one this list gave out") from exc
    if offset < 0:
        raise Invalid("that cursor is not one this list gave out")
    return offset


def page_size(limit: str | None, *, default: int = PAGE_LIMIT) -> int:
    if not limit:
        return default
    try:
        size = int(limit)
    except ValueError as exc:
        raise Invalid("limit must be a whole number") from exc
    return max(1, min(PAGE_LIMIT, size))


def window[T](
    items: list[T], *, limit: str | None, cursor: str | None, default: int = PAGE_LIMIT
) -> tuple[list[T], dict[str, Any]]:
    """One page of `items`, and what to say about the rest."""
    size = page_size(limit, default=default)
    start = decode_cursor(cursor)
    after = start + size
    return items[start:after], {
        "count": len(items),
        "nextCursor": encode_cursor(after) if after < len(items) else None,
    }


def page[T](items: list[T], event: dict[str, Any]) -> tuple[list[T], dict[str, Any]]:
    """One page of `items`, as the request's `limit` and `cursor` ask."""
    return window(
        items,
        limit=requests.query_parameter(event, "limit"),
        cursor=requests.query_parameter(event, "cursor"),
    )
