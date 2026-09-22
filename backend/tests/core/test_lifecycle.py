"""The lifecycle guard refuses every move the state machines do not draw.

Verifies FR-VIS-01 (the appointment lifecycle), FR-VIS-03 (a second cancel is
refused) and the state machine diagrams UML-07a, UML-07b and UML-07c.
"""

from __future__ import annotations

import pytest
from atria_spec import lifecycle as spec

from atria.core import lifecycle
from atria.core.errors import Conflict


class TestAppointmentLifecycle:
    def test_booking_starts_at_booked_or_requested(self):
        assert lifecycle.can("appointment", None, "BOOKED")
        assert lifecycle.can("appointment", None, "REQUESTED")

    def test_a_patient_confirms_a_booking(self):
        assert lifecycle.can("appointment", "BOOKED", "CONFIRMED")

    def test_completed_is_reached_only_from_the_consultation(self):
        sources = [frm for frm, to, _t, _n in spec.APPOINTMENT_TRANSITIONS if to == "COMPLETED"]
        assert sources == ["IN_CONSULTATION"]

    def test_a_cancelled_appointment_cannot_be_cancelled_again(self):
        # FR-VIS-03: a second cancel returns 409 rather than silently succeeding.
        with pytest.raises(Conflict) as raised:
            lifecycle.require("appointment", "PATIENT_CANCELLED", "PATIENT_CANCELLED")
        assert raised.value.status == 409

    def test_a_declined_request_cannot_become_booked(self):
        with pytest.raises(Conflict):
            lifecycle.require("appointment", "DECLINED", "BOOKED")

    def test_no_show_needs_a_scheduled_appointment(self):
        assert lifecycle.can("appointment", "CONFIRMED", "NO_SHOW")
        assert not lifecycle.can("appointment", "ARRIVED", "NO_SHOW")

    def test_disruption_can_be_resolved_or_cancelled(self):
        assert lifecycle.next_states("appointment", "DISRUPTED") == [
            "ARRIVED",
            "BOOKED",
            "CLINIC_CANCELLED",
            "PATIENT_CANCELLED",
        ]

    def test_scheduled_states_hold_grid_units(self):
        for state in ("BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED"):
            assert lifecycle.is_scheduled(state)
        for state in ("REQUESTED", "COMPLETED", "NO_SHOW"):
            assert not lifecycle.is_scheduled(state)

    @pytest.mark.parametrize("state", lifecycle.TERMINAL_APPOINTMENT_STATES)
    def test_terminal_states_have_no_way_out(self, state):
        assert lifecycle.is_terminal("appointment", state)

    def test_the_conflict_says_what_is_allowed_instead(self):
        with pytest.raises(Conflict) as raised:
            lifecycle.require("appointment", "REQUESTED", "COMPLETED")
        assert raised.value.detail["allowed"] == ["BOOKED", "DECLINED"]


class TestSessionLifecycle:
    def test_a_session_opens_before_it_runs(self):
        assert lifecycle.can("session", "PLANNED", "OPEN")
        assert not lifecycle.can("session", "PLANNED", "RUNNING")

    def test_a_disrupted_session_returns_to_running(self):
        assert lifecycle.can("session", "DISRUPTED", "RUNNING")

    def test_a_closed_session_does_not_reopen(self):
        assert lifecycle.next_states("session", "CLOSED") == []


class TestTicketLifecycle:
    def test_a_ticket_may_arrive_early(self):
        # ADR 0002: arriving before the window is accepted, the order still holds.
        assert lifecycle.can("ticket", "ISSUED", "ARRIVED")

    def test_no_show_follows_a_sent_window(self):
        assert lifecycle.can("ticket", "NOTIFIED", "NO_SHOW")
        assert not lifecycle.can("ticket", "ISSUED", "NO_SHOW")

    def test_withdrawal_is_terminal(self):
        assert lifecycle.is_terminal("ticket", "WITHDRAWN")


class TestEveryStateIsUsable:
    @pytest.mark.parametrize("name", list(spec.LIFECYCLES))
    def test_every_state_can_be_reached(self, name):
        states, transitions = spec.LIFECYCLES[name]
        reachable = {to for _f, to, _t, _n in transitions}
        assert set(states) <= reachable

    @pytest.mark.parametrize("name", list(spec.LIFECYCLES))
    def test_no_transition_names_an_unknown_state(self, name):
        states, transitions = spec.LIFECYCLES[name]
        known = set(states) | {None}
        for frm, to, _trigger, _note in transitions:
            assert frm in known
            assert to in known
