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
        assert {
            name: source[name] for name in ("holdMinutes", "lateGraceMinutes", "maxBypass")
        } == {
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


class TestInvitationSettings:
    """ADR 0022 R4 knobs are settings on the same three levels, never constants."""

    def test_the_built_in_fallbacks_for_invitations(self):
        policy, source = queue.resolve_policy()
        assert (
            policy.invite_lead_minutes,
            policy.invite_fanout,
            policy.invite_open_minutes,
            policy.early_call_invites,
        ) == (5, 3, 20, "desk")
        assert source["inviteFanout"] == source["earlyCallInvites"] == "default"

    def test_the_most_specific_level_wins_for_each_invitation_knob(self):
        tenant = {
            "queueInviteFanout": 5,
            "queueInviteOpenMinutes": 30,
            "queueEarlyCallInvites": "auto",
        }
        unit = {"inviteFanout": 2}
        session = {"earlyCallInvites": "desk", "inviteLeadMinutes": 10}
        policy, source = queue.resolve_policy(tenant, unit, session)
        assert policy.invite_fanout == 2
        assert policy.invite_open_minutes == 30
        assert policy.invite_lead_minutes == 10
        assert policy.early_call_invites == "desk"
        assert source["inviteFanout"] == "unit"
        assert source["inviteOpenMinutes"] == "tenant"
        assert source["inviteLeadMinutes"] == "session"
        assert source["earlyCallInvites"] == "session"

    def test_an_invitation_change_is_checked_against_the_limits(self):
        good = {"inviteFanout": 0, "inviteOpenMinutes": 5, "earlyCallInvites": "auto"}
        assert queue.policy_changes(good) == good
        assert queue.policy_changes({"earlyCallInvites": None}) == {"earlyCallInvites": None}
        for bad in (
            {"inviteFanout": 11},
            {"inviteLeadMinutes": 31},
            {"inviteOpenMinutes": 4},
            {"inviteOpenMinutes": 121},
            {"earlyCallInvites": "always"},
            {"earlyCallInvites": True},
        ):
            with pytest.raises(Invalid):
                queue.policy_changes(bad)


class TestInvitations:
    """ADR 0022 R4: invite in parallel, never hold the doctor, never reorder."""

    def pick(self, tickets, policy=None, rostered=1):
        found = queue.invite_targets(
            tickets, NOW, policy or queue.Policy(), rostered=rostered, per_hour=4
        )
        return [t["appointmentId"] for t in found]

    def test_r4_a_free_doctor_and_nobody_here_invites_the_next_absent_tickets(self):
        tickets = [ticket(n) for n in range(1, 6)]
        assert self.pick(tickets) == ["a1", "a2", "a3"]

    def test_r4_the_fan_out_is_a_setting(self):
        tickets = [ticket(n) for n in range(1, 6)]
        assert self.pick(tickets, queue.Policy(invite_fanout=1)) == ["a1"]
        assert self.pick(tickets, queue.Policy(invite_fanout=0)) == []

    def test_r4_nobody_is_invited_while_someone_is_here(self):
        """The doctor takes the patient who is here at once (R1); inviting would add nothing."""
        assert self.pick([ticket(1), ticket(2, "ARRIVED")]) == []

    def test_r4_nobody_is_invited_while_every_doctor_is_busy_for_long(self):
        busy = ticket(1, "IN_CONSULTATION", consultationStartedAt=at(-2))
        assert self.pick([busy, ticket(2), ticket(3)]) == []

    def test_r4_a_doctor_about_to_finish_counts_as_free_within_the_lead(self):
        busy = ticket(1, "IN_CONSULTATION", consultationStartedAt=at(-12))
        # 15 minutes is the seeded pace at 4 an hour, so this one ends in 3 minutes.
        assert self.pick([busy, ticket(2)]) == ["a2"]
        assert self.pick([busy, ticket(2)], queue.Policy(invite_lead_minutes=2)) == []

    def test_r4_one_of_two_doctors_free_is_enough(self):
        busy = ticket(1, "IN_CONSULTATION", consultationStartedAt=at(-2))
        assert self.pick([busy, ticket(2)], rostered=2) == ["a2"]

    def test_r4_a_ticket_is_invited_once_and_open_ones_use_up_the_fan_out(self):
        sent = {"inviteSentAt": at(-1), "inviteExpiresAt": at(19)}
        tickets = [ticket(1, **sent), ticket(2, **sent), ticket(3), ticket(4), ticket(5)]
        assert self.pick(tickets) == ["a3"]

    def test_r4_a_closed_or_declined_invitation_frees_its_place_but_is_not_repeated(self):
        expired = {"inviteSentAt": at(-30), "inviteExpiresAt": at(-10)}
        declined = {"inviteSentAt": at(-3), "inviteExpiresAt": at(17), "inviteAnswer": "NO"}
        tickets = [ticket(1, **expired), ticket(2, **declined), ticket(3), ticket(4)]
        assert self.pick(tickets, queue.Policy(invite_fanout=2)) == ["a3", "a4"]

    def test_r4_an_accepted_patient_on_the_way_still_counts_until_their_eta(self):
        yes = {
            "inviteSentAt": at(-3),
            "inviteExpiresAt": at(17),
            "inviteAnswer": "YES",
            "inviteEta": at(15),
        }
        tickets = [ticket(1, **yes), ticket(2), ticket(3)]
        assert self.pick(tickets, queue.Policy(invite_fanout=1)) == []
        assert self.pick(tickets, queue.Policy(invite_fanout=2)) == ["a2"]

    def test_r4_only_waiting_tickets_are_invited(self):
        tickets = [ticket(1, "CANCELLED"), ticket(2, "IN_CONSULTATION"), ticket(3, "COMPLETED")]
        tickets[1]["consultationStartedAt"] = at(-14)
        assert self.pick(tickets) == []

    def test_r4_an_invitation_never_changes_who_is_called(self):
        """Inviting is a record on a ticket; the call decision reads none of it."""
        plain = [ticket(1), ticket(2, "ARRIVED")]
        invited = [ticket(1, inviteSentAt=at(-1), inviteAnswer="YES"), ticket(2, "ARRIVED")]

        def ids(call):
            return (
                call.candidate and call.candidate["appointmentId"],
                [t["appointmentId"] for t in call.bypassed],
                call.hold,
                call.start_hold,
                call.late,
            )

        assert ids(queue.next_call(plain, NOW)) == ids(queue.next_call(invited, NOW))

    def test_r4_the_status_of_an_invitation(self):
        assert queue.invite_status(ticket(1), NOW) is None
        sent = {"inviteSentAt": at(-1), "inviteExpiresAt": at(19)}
        assert queue.invite_status(ticket(1, **sent), NOW) == "open"
        assert (
            queue.invite_status(ticket(1, inviteSentAt=at(-30), inviteExpiresAt=at(-10)), NOW)
            == "expired"
        )
        assert queue.invite_status(ticket(1, inviteAnswer="YES", **sent), NOW) == "accepted"
        assert queue.invite_status(ticket(1, inviteAnswer="NO", **sent), NOW) == "declined"
