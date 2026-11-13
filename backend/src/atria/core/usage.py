"""A month's message usage, counted (ADR 0031).

Pure: given the message log rows that settled in a period, count them by unit,
kind, channel and state. This is reporting. Nothing here prices a message, and
no figure claims what messaging saved in currency (FR-MSR-04, CX-12).

A row is counted once, in the state it settled in: SENT, DELIVERED, FAILED or
CANCELLED. A reminder still waiting has no day in the log yet, so it is not
counted until it goes.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

# What a row with no unit is filed under, so it still counts in the totals.
NO_UNIT = "-"


def statement(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The counts: one line per unit, kind, channel and state, and the totals."""
    lines: Counter[tuple[str, str, str, str]] = Counter(
        (
            str(r.get("clinicId") or NO_UNIT),
            str(r.get("kind") or ""),
            str(r.get("channel") or ""),
            str(r.get("deliveryState") or ""),
        )
        for r in rows
    )
    return {
        "messages": len(rows),
        "lines": [
            {"clinicId": unit, "kind": kind, "channel": channel, "state": state, "count": n}
            for (unit, kind, channel, state), n in sorted(lines.items())
        ],
        "byKind": _totals(rows, "kind"),
        "byChannel": _totals(rows, "channel"),
        "byState": _totals(rows, "deliveryState"),
    }


def _totals(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    return dict(sorted(Counter(str(r.get(field) or "") for r in rows).items()))
