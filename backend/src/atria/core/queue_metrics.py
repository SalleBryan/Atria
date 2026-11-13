"""What the general queue measured over a period (ADR 0022, business lane B2).

Pure: given a unit's appointments, count and time what the queue did. These are
measurements and nothing else. No figure here is a price, a saving or a claim
about what the queue rules achieved (FR-MSR-04, CX-12); the report shows them
beside attendance and leaves the reading to people.

Read from stamps the queue already writes on the appointment: `arrivedAt`,
`consultationStartedAt`, `completedAt`, `bypassCount`, `lateAt`, `urgent`, the
arrival window and the assigned `clinicianProfileId`.

shortcut: the arrival window is the one last told to the patient. A window is
recalculated as the session runs and the first one is not kept, so a breach is
measured against the latest promise; add an original window to the ticket to
measure against the first.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter
from typing import Any

# Tickets the queue counts: a place cancelled before it was used says nothing.
CANCELLED = ("PATIENT_CANCELLED", "CLINIC_CANCELLED")

# What adds across units. Medians do not, so a hospital figure leaves them out.
SUMS = ("tickets", "seen", "arrivedInWindow", "promiseBreached", "bypassed", "urgent", "late")


def _at(value: object) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _minutes(start: dt.datetime, end: dt.datetime) -> float:
    return (end - start).total_seconds() / 60


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    value = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return round(value, 1)


def queue_figures(appointments: list[dict[str, Any]]) -> dict[str, Any] | None:
    """One unit's queue, or None when it had none in the period."""
    tickets = [a for a in appointments if a.get("sessionId") and a.get("state") not in CANCELLED]
    if not tickets:
        return None

    waits: list[float] = []
    consultations: list[float] = []
    breaches: list[float] = []
    in_window = 0
    seen = 0
    for ticket in tickets:
        arrived = _at(ticket.get("arrivedAt"))
        began = _at(ticket.get("consultationStartedAt"))
        done = _at(ticket.get("completedAt"))
        window_end = _at(ticket.get("arrivalWindowEnd"))
        if began:
            seen += 1
        if arrived and began and began >= arrived:
            waits.append(_minutes(arrived, began))
        if began and done and done > began:
            consultations.append(_minutes(began, done))
        # Someone who came in their window and was then seen after it ended.
        if arrived and began and window_end and arrived <= window_end:
            in_window += 1
            if began > window_end:
                breaches.append(_minutes(window_end, began))

    return {
        "tickets": len(tickets),
        "seen": seen,
        "byChannel": dict(
            sorted(Counter(str(t.get("channel") or "ONLINE") for t in tickets).items())
        ),
        "medianWaitMinutes": _median(waits),
        "medianConsultationMinutes": _median(consultations),
        "arrivedInWindow": in_window,
        "promiseBreached": len(breaches),
        "medianBreachMinutes": _median(breaches),
        "longestBreachMinutes": round(max(breaches), 1) if breaches else None,
        "bypassed": sum(int(str(t.get("bypassCount") or 0)) > 0 for t in tickets),
        "urgent": sum(bool(t.get("urgent")) for t in tickets),
        "late": sum(bool(t.get("lateAt")) for t in tickets),
        "doctorIdleWhileWaitingMinutes": _idle_while_waiting(tickets),
    }


def _idle_while_waiting(tickets: list[dict[str, Any]]) -> float:
    """Minutes a doctor sat free between two consultations while someone waited.

    A doctor's gap is the time from one consultation's end to their next one's
    start. It counts only where at least one patient of the unit had arrived and
    not yet been called. A doctor with nobody waiting, or still in a consultation,
    is not idle in this sense.
    """
    waiting = _merged(
        [
            (arrived, began)
            for t in tickets
            if (arrived := _at(t.get("arrivedAt")))
            and (began := _at(t.get("consultationStartedAt")))
            and began > arrived
        ]
    )
    by_doctor: dict[str, list[tuple[dt.datetime, dt.datetime]]] = {}
    for t in tickets:
        began, done = _at(t.get("consultationStartedAt")), _at(t.get("completedAt"))
        if began and done and done > began and t.get("clinicianProfileId"):
            by_doctor.setdefault(str(t["clinicianProfileId"]), []).append((began, done))

    idle = 0.0
    for spans in by_doctor.values():
        spans.sort()
        for (_, ended), (next_start, _) in zip(spans, spans[1:], strict=False):
            if next_start > ended:
                idle += sum(
                    _minutes(max(ended, a), min(next_start, b))
                    for a, b in waiting
                    if min(next_start, b) > max(ended, a)
                )
    return round(idle, 1)


def _merged(spans: list[tuple[dt.datetime, dt.datetime]]) -> list[tuple[dt.datetime, dt.datetime]]:
    """Overlapping spans joined, so a minute with two people waiting counts once."""
    joined: list[tuple[dt.datetime, dt.datetime]] = []
    for start, end in sorted(spans):
        if joined and start <= joined[-1][1]:
            joined[-1] = (joined[-1][0], max(joined[-1][1], end))
        else:
            joined.append((start, end))
    return joined


def merge(units: list[dict[str, Any] | None]) -> dict[str, Any] | None:
    """Every unit's queue added up for the hospital; medians do not add, so they are None."""
    present = [u for u in units if u]
    if not present:
        return None
    channels: Counter[str] = Counter()
    for u in present:
        channels.update(u["byChannel"])
    merged: dict[str, Any] = {name: sum(int(u[name]) for u in present) for name in SUMS}
    return {
        **merged,
        "byChannel": dict(sorted(channels.items())),
        "medianWaitMinutes": None,
        "medianConsultationMinutes": None,
        "medianBreachMinutes": None,
        "longestBreachMinutes": max(
            (u["longestBreachMinutes"] for u in present if u["longestBreachMinutes"] is not None),
            default=None,
        ),
        "doctorIdleWhileWaitingMinutes": round(
            sum(float(u["doctorIdleWhileWaitingMinutes"]) for u in present), 1
        ),
    }
