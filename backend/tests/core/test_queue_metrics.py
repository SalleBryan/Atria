"""Verifies the queue-quality measurements (ADR 0022, business lane B2, FR-MSR-01).

Measurements only: no figure is a price or a saving (FR-MSR-04). The tickets are
the general-queue appointments of one unit's period.
"""

from __future__ import annotations

from atria.core import queue_metrics as m
from atria.core import report

DAY = "2026-03-04T"


def t(
    window: tuple[str, str],
    *,
    arrived: str | None = None,
    began: str | None = None,
    done: str | None = None,
    doctor: str = "c-1",
    **more: object,
) -> dict:
    ticket: dict = {
        "sessionId": "s-1",
        "state": "COMPLETED" if done else "BOOKED",
        "channel": "ONLINE",
        "arrivalWindowStart": f"{DAY}{window[0]}:00Z",
        "arrivalWindowEnd": f"{DAY}{window[1]}:00Z",
        "clinicianProfileId": doctor,
    }
    for name, value in (
        ("arrivedAt", arrived),
        ("consultationStartedAt", began),
        ("completedAt", done),
    ):
        if value:
            ticket[name] = f"{DAY}{value}:00Z"
    return ticket | more


class TestNothingToMeasure:
    def test_a_unit_with_no_queue_has_no_figures(self):
        assert m.queue_figures([{"state": "COMPLETED"}]) is None

    def test_cancelled_places_are_not_counted(self):
        assert m.queue_figures([t(("08:00", "08:30"), state="PATIENT_CANCELLED")]) is None


class TestWaitAndConsultation:
    def test_the_wait_is_arrival_to_the_start_of_the_consultation(self):
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), arrived="08:10", began="08:20", done="08:50"),
                t(("08:30", "09:00"), arrived="08:40", began="09:10", done="09:30"),
            ]
        )
        assert found["seen"] == 2
        assert found["medianWaitMinutes"] == 20.0  # 10 and 30
        assert found["medianConsultationMinutes"] == 25.0  # 30 and 20

    def test_a_place_never_seen_has_no_wait(self):
        found = m.queue_figures([t(("08:00", "08:30"), arrived="08:10")])
        assert (found["seen"], found["medianWaitMinutes"]) == (0, None)


class TestPromise:
    def test_someone_who_arrived_in_time_and_was_seen_late_is_a_breach(self):
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), arrived="08:05", began="08:20", done="08:40"),  # kept
                t(("08:30", "09:00"), arrived="08:40", began="09:15", done="09:40"),  # 15 late
            ]
        )
        assert (found["arrivedInWindow"], found["promiseBreached"]) == (2, 1)
        assert found["medianBreachMinutes"] == 15.0
        assert found["longestBreachMinutes"] == 15.0

    def test_someone_who_arrived_after_their_window_is_not_counted(self):
        found = m.queue_figures(
            [t(("08:00", "08:30"), arrived="08:45", began="09:30", done="10:00")]
        )
        assert (found["arrivedInWindow"], found["promiseBreached"]) == (0, 0)
        assert found["medianBreachMinutes"] is None


class TestRules:
    def test_bypass_urgent_and_late_are_counted(self):
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), bypassCount=1),
                t(("08:30", "09:00"), urgent=True),
                t(("09:00", "09:30"), lateAt=f"{DAY}09:45:00Z"),
                t(("09:30", "10:00")),
            ]
        )
        assert (found["tickets"], found["bypassed"], found["urgent"], found["late"]) == (4, 1, 1, 1)

    def test_online_and_desk_places_are_counted_by_channel(self):
        found = m.queue_figures([t(("08:00", "08:30")), t(("08:30", "09:00"), channel="WALK_IN")])
        assert found["byChannel"] == {"ONLINE": 1, "WALK_IN": 1}


class TestDoctorIdle:
    def test_a_free_doctor_with_someone_waiting_is_idle_time(self):
        # c-1 finishes at 08:30 and starts the next at 08:50. A patient who arrived at 08:35
        # waited from then, so the doctor sat free for 15 of those 20 minutes.
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), arrived="08:00", began="08:00", done="08:30"),
                t(("08:30", "09:00"), arrived="08:35", began="08:50", done="09:20"),
            ]
        )
        assert found["doctorIdleWhileWaitingMinutes"] == 15.0

    def test_a_free_doctor_with_nobody_waiting_is_not_idle_time(self):
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), arrived="08:00", began="08:00", done="08:30"),
                t(("09:00", "09:30"), arrived="09:00", began="09:00", done="09:30"),
            ]
        )
        assert found["doctorIdleWhileWaitingMinutes"] == 0.0

    def test_a_busy_doctor_is_not_idle_however_long_people_wait(self):
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), arrived="08:00", began="08:00", done="08:40"),
                t(("08:30", "09:00"), arrived="08:10", began="08:40", done="09:10"),
            ]
        )
        assert found["doctorIdleWhileWaitingMinutes"] == 0.0

    def test_each_doctor_is_counted_on_their_own(self):
        found = m.queue_figures(
            [
                t(("08:00", "08:30"), arrived="08:00", began="08:00", done="08:30", doctor="c-1"),
                t(("08:00", "08:30"), arrived="08:00", began="08:00", done="08:10", doctor="c-2"),
                t(("08:30", "09:00"), arrived="08:15", began="08:30", done="09:00", doctor="c-1"),
            ]
        )
        # c-2 had no next consultation, c-1 never sat free: no idle time to state.
        assert found["doctorIdleWhileWaitingMinutes"] == 0.0


class TestMerge:
    def test_units_add_up_and_medians_are_left_out(self):
        one = m.queue_figures(
            [t(("08:00", "08:30"), arrived="08:05", began="08:20", done="08:40", bypassCount=1)]
        )
        two = m.queue_figures(
            [t(("08:30", "09:00"), arrived="08:40", began="09:15", done="09:40", channel="WALK_IN")]
        )
        merged = m.merge([one, two, None])
        assert (
            merged["tickets"],
            merged["seen"],
            merged["bypassed"],
            merged["promiseBreached"],
        ) == (2, 2, 1, 1)
        assert merged["byChannel"] == {"ONLINE": 1, "WALK_IN": 1}
        assert merged["medianWaitMinutes"] is None

    def test_no_unit_with_a_queue_gives_none(self):
        assert m.merge([None, None]) is None


class TestInTheReport:
    def test_the_weekly_figures_carry_the_queue(self):
        queue = [
            {
                **t(("08:00", "08:30"), arrived="08:05", began="08:20", done="08:40"),
                "appointmentId": "a-1",
            }
        ]
        found = report.week_figures(queue, reminders={}, ledger=[])
        assert found["queue"]["seen"] == 1

    def test_the_hospital_figures_add_the_units_queues(self):
        one = {"queue": m.queue_figures([t(("08:00", "08:30"))]), "ledger": {}}
        two = {"queue": m.queue_figures([t(("08:00", "08:30"))]), "ledger": {}}
        assert report.hospital_figures([one, two])["queue"]["tickets"] == 2
