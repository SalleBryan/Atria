"""Verifies the usage statement's arithmetic (ADR 0031) and the period comparison (FR-MSR-01)."""

from __future__ import annotations

from atria.core import report, usage


def row(unit: str | None, kind: str, channel: str, state: str) -> dict:
    return {"clinicId": unit, "kind": kind, "channel": channel, "deliveryState": state}


class TestStatement:
    def test_rows_are_counted_by_unit_kind_channel_and_state(self):
        rows = [
            row("c-1", "APPOINTMENT_REMINDER", "SMS", "SENT"),
            row("c-1", "APPOINTMENT_REMINDER", "SMS", "SENT"),
            row("c-1", "APPOINTMENT_REMINDER", "SMS", "FAILED"),
            row("c-2", "BOOKING_CONFIRMATION", "EMAIL", "DELIVERED"),
        ]
        found = usage.statement(rows)
        assert found["messages"] == 4
        assert {(x["clinicId"], x["state"]): x["count"] for x in found["lines"]} == {
            ("c-1", "SENT"): 2,
            ("c-1", "FAILED"): 1,
            ("c-2", "DELIVERED"): 1,
        }
        assert found["byKind"] == {"APPOINTMENT_REMINDER": 3, "BOOKING_CONFIRMATION": 1}
        assert found["byChannel"] == {"EMAIL": 1, "SMS": 3}

    def test_a_row_with_no_unit_still_counts(self):
        found = usage.statement([row(None, "QUEUE_MOVED", "SMS", "SENT")])
        assert found["lines"][0]["clinicId"] == usage.NO_UNIT
        assert found["messages"] == 1

    def test_no_rows_is_an_empty_statement(self):
        assert usage.statement([]) == {
            "messages": 0,
            "lines": [],
            "byKind": {},
            "byChannel": {},
            "byState": {},
        }


class TestChange:
    def test_counts_differ_and_attendance_moves_in_points(self):
        before = {"booked": 10, "attended": 4, "noShow": 4, "attendance": 0.5}
        after = {"booked": 12, "attended": 7, "noShow": 3, "attendance": 0.7}
        found = report.change(before, after)
        assert found["counts"]["booked"] == {"before": 10, "after": 12, "change": 2}
        assert found["counts"]["noShow"]["change"] == -1
        assert found["attendance"]["points"] == 20.0

    def test_attendance_is_not_compared_when_a_period_decided_nothing(self):
        found = report.change({"booked": 3, "attendance": None}, {"booked": 5, "attendance": 0.6})
        assert found["attendance"] == {"before": None, "after": 0.6, "points": None}

    def test_a_missing_count_is_zero(self):
        assert report.change({}, {"open": 2})["counts"]["open"]["change"] == 2
