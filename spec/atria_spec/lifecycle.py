"""Atria Rev B lifecycles.

Single source for the state machine diagrams (UML-07a, UML-07b, UML-07c), the
services that move records between states, and the tests that check no other
move is possible. A transition that is not listed here does not exist: the
services refuse it rather than ignoring it.

Each transition is (from_state, to_state, trigger, note). The from_state None
means the initial pseudostate, and to_state None means the final pseudostate.

Appointment entitlement at closure is recorded in the fee ledger, not here.
See spec/roles.py for who may cause a transition, and ADR 0007 for entitlement.
"""

# ----------------------------------------------------------------- appointment
APPOINTMENT_STATES = [
    "REQUESTED", "DECLINED", "BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED",
    "ARRIVED", "IN_CONSULTATION", "COMPLETED", "AWAITING_FEEDBACK",
    "CLINIC_CANCELLED", "PATIENT_CANCELLED", "NO_SHOW",
]

# The states inside the Scheduled composite state. A record in any of these is
# scheduled: it holds grid units and appears on a calendar.
SCHEDULED_STATES = ["BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED"]

# COMPLETED is not listed: where the tenant runs the quality programme it moves
# on to AWAITING_FEEDBACK, so it is an end state only for a tenant with the
# programme off. Use lifecycle.is_terminal for the general question.
TERMINAL_APPOINTMENT_STATES = [
    "DECLINED", "AWAITING_FEEDBACK",
    "CLINIC_CANCELLED", "PATIENT_CANCELLED", "NO_SHOW",
]

APPOINTMENT_TRANSITIONS = [
    (None, "BOOKED", "slot taken or ticket issued",
     "A specialist booking locks its units, or a general consultation is issued a ticket"),
    (None, "REQUESTED", "patient requests a procedure",
     "No time is held until staff size and place it. ADR 0005"),
    ("REQUESTED", "BOOKED", "staff size it and place it", "Staff set the duration and the start"),
    ("REQUESTED", "DECLINED", "staff decline", "Terminal; the patient is told why"),
    ("BOOKED", "CONFIRMED", "patient confirms", "Confirmation is the patient's own act"),
    ("BOOKED", "RESCHEDULED", "either side moves it", "New units are locked in the same transaction"),
    ("CONFIRMED", "RESCHEDULED", "either side moves it", "New units are locked in the same transaction"),
    ("RESCHEDULED", "BOOKED", "new units locked", "Back inside the scheduled states"),
    ("BOOKED", "DISRUPTED", "clinician unavailable", "Offers go out; nothing is imposed. ADR 0003"),
    ("CONFIRMED", "DISRUPTED", "clinician unavailable", "Offers go out; nothing is imposed. ADR 0003"),
    ("DISRUPTED", "BOOKED", "patient accepts a slot", "Auto-accept applies to same-day slots only"),
    ("DISRUPTED", "CLINIC_CANCELLED", "no alternative accepted",
     "Entitlement FULL, because the clinic caused it"),
    ("BOOKED", "ARRIVED", "staff record arrival", "Check-in at the desk"),
    ("CONFIRMED", "ARRIVED", "staff record arrival", "Check-in at the desk"),
    ("RESCHEDULED", "ARRIVED", "staff record arrival", "Check-in at the desk"),
    ("DISRUPTED", "ARRIVED", "staff record arrival", "The patient came anyway"),
    ("ARRIVED", "IN_CONSULTATION", "clinician assigned", "Assigned at check-in by whoever is free"),
    ("IN_CONSULTATION", "COMPLETED", "consultation closed", "Writes the fee ledger entry"),
    ("COMPLETED", "AWAITING_FEEDBACK", "quality programme on",
     "Only when the tenant runs the quality programme"),
    ("COMPLETED", None, "quality programme off", "Terminal without a feedback window"),
    ("AWAITING_FEEDBACK", None, "feedback given or window closes", "Terminal"),
    ("BOOKED", "CLINIC_CANCELLED", "clinic cancels", "Entitlement FULL"),
    ("CONFIRMED", "CLINIC_CANCELLED", "clinic cancels", "Entitlement FULL"),
    ("RESCHEDULED", "CLINIC_CANCELLED", "clinic cancels", "Entitlement FULL"),
    ("BOOKED", "PATIENT_CANCELLED", "patient cancels", "In window FULL, late PARTIAL"),
    ("CONFIRMED", "PATIENT_CANCELLED", "patient cancels", "In window FULL, late PARTIAL"),
    ("RESCHEDULED", "PATIENT_CANCELLED", "patient cancels", "In window FULL, late PARTIAL"),
    ("DISRUPTED", "PATIENT_CANCELLED", "patient cancels", "In window FULL, late PARTIAL"),
    ("BOOKED", "NO_SHOW", "scheduled end passes", "Entitlement NONE; a strike if the tenant counts them"),
    ("CONFIRMED", "NO_SHOW", "scheduled end passes", "Entitlement NONE; a strike if the tenant counts them"),
    ("RESCHEDULED", "NO_SHOW", "scheduled end passes", "Entitlement NONE; a strike if the tenant counts them"),
    ("DECLINED", None, "resolved", "Terminal"),
    ("CLINIC_CANCELLED", None, "resolved", "Terminal"),
    ("PATIENT_CANCELLED", None, "resolved", "Terminal"),
    ("NO_SHOW", None, "resolved", "Terminal"),
]

# --------------------------------------------------------------------- session
SESSION_STATES = ["PLANNED", "OPEN", "RUNNING", "DISRUPTED", "CLOSED"]

SESSION_TRANSITIONS = [
    (None, "PLANNED", "rota published", "The clinic manager publishes the rota"),
    ("PLANNED", "OPEN", "booking window opens", "Tickets can be issued"),
    ("OPEN", "RUNNING", "first patient checked in", "The queue is live"),
    ("OPEN", "CLOSED", "session cancelled", "Every ticket is entitled FULL"),
    ("RUNNING", "DISRUPTED", "clinician away", "Arrival windows are recalculated"),
    ("DISRUPTED", "RUNNING", "recalculated", "Patients are told the new windows"),
    ("RUNNING", "CLOSED", "last ticket resolved", "Nothing is outstanding"),
    ("CLOSED", None, "throughput written", "Session throughput is recorded for reporting"),
]

# ---------------------------------------------------------------- queue ticket
TICKET_STATES = [
    "ISSUED", "NOTIFIED", "ARRIVED", "IN_CONSULTATION", "COMPLETED",
    "NO_SHOW", "WITHDRAWN",
]

TICKET_TRANSITIONS = [
    (None, "ISSUED", "position assigned by the server",
     "Order comes from the server request timestamp, never from the client. Guard SERVER_ASSIGNED_ORDER"),
    ("ISSUED", "NOTIFIED", "arrival window sent", "The window, not a named doctor. ADR 0002"),
    ("ISSUED", "WITHDRAWN", "patient withdraws", "Terminal"),
    ("ISSUED", "ARRIVED", "arrives early", "Accepted; the queue order still holds"),
    ("NOTIFIED", "ARRIVED", "patient checks in", "At the desk or by self check-in"),
    ("NOTIFIED", "NO_SHOW", "no arrival", "The window passed"),
    ("ARRIVED", "IN_CONSULTATION", "first free clinician assigned", "Whoever is free. ADR 0002"),
    ("IN_CONSULTATION", "COMPLETED", "consultation closed", "Writes the fee ledger entry"),
    ("COMPLETED", None, "resolved", "Terminal"),
    ("NO_SHOW", None, "resolved", "Terminal"),
    ("WITHDRAWN", None, "resolved", "Terminal"),
]

LIFECYCLES = {
    "appointment": (APPOINTMENT_STATES, APPOINTMENT_TRANSITIONS),
    "session": (SESSION_STATES, SESSION_TRANSITIONS),
    "ticket": (TICKET_STATES, TICKET_TRANSITIONS),
}


def can(lifecycle: str, from_state: str | None, to_state: str | None) -> bool:
    """True when the move is one the lifecycle allows."""
    _, transitions = LIFECYCLES[lifecycle]
    return any(f == from_state and t == to_state for f, t, _trigger, _note in transitions)


def next_states(lifecycle: str, from_state: str | None) -> list[str]:
    _, transitions = LIFECYCLES[lifecycle]
    return sorted({t for f, t, _trigger, _note in transitions if f == from_state and t})


if __name__ == "__main__":
    for name, (states, transitions) in LIFECYCLES.items():
        print(f"{name}: {len(states)} states, {len(transitions)} transitions")
        unreachable = [s for s in states if not any(t == s for _f, t, _tr, _n in transitions)]
        stuck = [s for s in states if not any(f == s for f, _t, _tr, _n in transitions)]
        print(f"  unreachable: {unreachable or 'none'}")
        print(f"  no way out:  {stuck or 'none'}")
