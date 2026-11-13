"""Who a free doctor takes next.

Verifies FR-BKG-13 and ADR 0022: the doctor never idles when someone is here (R1),
a present patient is called ahead of an absent due ticket at most once (R2), the
doctor is then held for them briefly and lateness forfeits priority (R3), and an
urgent ticket outranks position (R6).
"""

from __future__ import annotations

import datetime as dt

import pytest

from atria.core import queue
from atria.core.errors import Invalid

NOW = dt.datetime(2026, 3, 4, 10, 0, tzinfo=dt.UTC)


def at(minutes: int) -> str:
    return (NOW + dt.timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def ticket(n, state="BOOKED", opens=-5, closes=25, **more):
    return {
        "appointmentId": f"a{n}",
        "position": n,
        "state": state,
        "arrivalWindowStart": at(opens),
        "arrivalWindowEnd": at(closes),
        **more,
    }


class TestNeverIdle:
    def test_r1_the_earliest_present_ticket_is_called_now(self):
        tickets = [ticket(1, "ARRIVED"), ticket(2, "ARRIVED")]
        assert queue.next_call(tickets, NOW).candidate["appointmentId"] == "a1"

    def test_r1_nobody_here_nobody_called(self):
        assert queue.next_call([ticket(1), ticket(2)], NOW).candidate is None

    def test_r1_a_walk_in_is_seen_when_the_booked_patient_is_not_due_yet(self):
        tickets = [ticket(1, opens=40, closes=70), ticket(2, "ARRIVED", opens=-5)]
        call = queue.next_call(tickets, NOW)
        assert call.candidate["appointmentId"] == "a2"
        assert call.bypassed == ()


class TestBoundedBypass:
    def test_r2_an_absent_due_ticket_is_passed_over_once(self):
        tickets = [ticket(1), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW)
        assert call.candidate["appointmentId"] == "a2"
        assert [t["appointmentId"] for t in call.bypassed] == ["a1"]

    def test_r2_after_one_bypass_the_doctor_is_held_for_them(self):
        tickets = [ticket(1, bypassCount=1), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW)
        assert call.candidate is None
        assert call.hold is not None
        assert call.hold.appointment_id == "a1"
        assert call.start_hold == ("a1",)
        assert call.hold.until == NOW + dt.timedelta(minutes=5)

    def test_r2_the_hold_clock_runs_from_when_it_started(self):
        tickets = [ticket(1, bypassCount=1, holdStartedAt=at(-3)), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW)
        assert call.hold.until == NOW + dt.timedelta(minutes=2)
        assert call.start_hold == ()

    def test_r3_when_the_hold_is_spent_they_are_late_and_the_doctor_moves_on(self):
        tickets = [ticket(1, bypassCount=1, holdStartedAt=at(-6)), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW)
        assert call.candidate["appointmentId"] == "a2"
        assert call.late == ("a1",)

    def test_r2_a_ticket_not_yet_due_is_never_waited_for(self):
        tickets = [ticket(1, opens=10, closes=40, bypassCount=1), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW)
        assert call.candidate["appointmentId"] == "a2"
        assert call.hold is None


class TestLateness:
    def test_r3_a_ticket_past_its_window_and_grace_is_late(self):
        assert queue.is_late(ticket(1, closes=-20), NOW)
        assert not queue.is_late(ticket(1, closes=-10), NOW)

    def test_r3_a_late_arrival_goes_behind_everyone_present(self):
        late = ticket(1, "ARRIVED", closes=-30, arrivedAt=at(-1))
        on_time = ticket(2, "ARRIVED", arrivedAt=at(-2))
        assert queue.next_call([late, on_time], NOW).candidate["appointmentId"] == "a2"

    def test_r3_a_late_arrival_is_seen_when_nobody_else_is_here(self):
        late = ticket(1, "ARRIVED", closes=-30, arrivedAt=at(-1))
        assert queue.next_call([late], NOW).candidate["appointmentId"] == "a1"

    def test_a_late_candidate_passes_over_nobody(self):
        late = ticket(2, "ARRIVED", closes=-30, arrivedAt=at(-1))
        call = queue.next_call([ticket(1), late], NOW)
        assert call.candidate["appointmentId"] == "a2"
        assert call.bypassed == ()


class TestUrgent:
    def test_r6_an_urgent_ticket_outranks_position_and_costs_nobody_a_bypass(self):
        tickets = [ticket(1, "ARRIVED"), ticket(2, "ARRIVED", urgent=True), ticket(3)]
        call = queue.next_call(tickets, NOW)
        assert call.candidate["appointmentId"] == "a2"
        assert call.bypassed == ()

    def test_r6_urgent_is_not_held_for_an_absent_ticket(self):
        tickets = [ticket(1, bypassCount=1), ticket(2, "ARRIVED", urgent=True)]
        assert queue.next_call(tickets, NOW).candidate["appointmentId"] == "a2"


class TestHowLongAConsultationTakes:
    def test_the_median_of_the_sessions_consultations(self):
        def done(start, end):
            return {"consultationStartedAt": at(start), "completedAt": at(end)}

        spans = [done(-60, -50), done(-40, -20), done(-15, -5)]
        assert queue.expected_consult_minutes(spans, per_hour=4) == 10.0

    def test_the_pace_stands_in_before_anything_is_measured(self):
        assert queue.expected_consult_minutes([], per_hour=4) == 15.0


class TestWhoSetsTheRules:
    """ADR 0022: the tenant sets defaults, a unit overrides them, a session overrides both."""

    def test_the_built_in_defaults_apply_when_nothing_is_set(self):
        policy, source = queue.resolve_policy()
        assert (policy.hold_minutes, policy.late_grace_minutes, policy.max_bypass) == (5, 15, 1)
        assert set(source.values()) == {"default"}

    def test_the_most_specific_level_wins_per_knob(self):
        tenant = {"queueHoldMinutes": 10, "queueLateGraceMinutes": 20, "queueMaxBypass": 2}
        unit = {"holdMinutes": 3}
        session = {"maxBypass": 0}
        policy, source = queue.resolve_policy(tenant, unit, session)
        assert (policy.hold_minutes, policy.late_grace_minutes, policy.max_bypass) == (3, 20, 0)
        assert source == {
            "holdMinutes": "unit",
            "lateGraceMinutes": "tenant",
            "maxBypass": "session",
        }

    def test_a_value_read_back_from_the_table_as_a_decimal_counts(self):
        from decimal import Decimal

        policy, _ = queue.resolve_policy({"queueHoldMinutes": Decimal("8")})
        assert policy.hold_minutes == 8

    def test_a_change_is_checked_against_the_limits(self):
        assert queue.policy_changes({"holdMinutes": 0, "maxBypass": None}) == {
            "holdMinutes": 0,
            "maxBypass": None,
        }
        for bad in (
            {"holdMinutes": 31},
            {"lateGraceMinutes": -1},
            {"maxBypass": 4},
            {"holdMinutes": True},
            {"holdMinutes": 2.5},
        ):
            with pytest.raises(Invalid):
                queue.policy_changes(bad)

    def test_an_unknown_or_empty_change_is_refused(self):
        for bad in ({}, {"coffeeMinutes": 5}):
            with pytest.raises(Invalid):
                queue.policy_changes(bad)

    def test_with_no_hold_a_passed_over_patient_is_late_at_once(self):
        tickets = [ticket(1, bypassCount=1), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW, queue.Policy(hold_minutes=0))
        assert call.candidate["appointmentId"] == "a2"
        assert call.late == ("a1",)

    def test_with_no_bypass_allowed_the_doctor_is_held_at_once(self):
        tickets = [ticket(1), ticket(2, "ARRIVED")]
        call = queue.next_call(tickets, NOW, queue.Policy(max_bypass=0))
        assert call.candidate is None
        assert call.hold is not None
