"""Lifecycle guard.

The transitions come from the specification, so the state machine diagrams
(UML-07a, UML-07b, UML-07c) and the running code cannot disagree. A move that
is not in the specification is refused with a conflict, never ignored.
"""

from __future__ import annotations

from atria_spec import lifecycle as spec

from atria.core.errors import Conflict

Lifecycle = str

APPOINTMENT_STATES = tuple(spec.APPOINTMENT_STATES)
SESSION_STATES = tuple(spec.SESSION_STATES)
TICKET_STATES = tuple(spec.TICKET_STATES)
SCHEDULED_STATES = tuple(spec.SCHEDULED_STATES)
TERMINAL_APPOINTMENT_STATES = tuple(spec.TERMINAL_APPOINTMENT_STATES)


def can(lifecycle: Lifecycle, from_state: str | None, to_state: str | None) -> bool:
    """True when the lifecycle allows the move."""
    return spec.can(lifecycle, from_state, to_state)


def next_states(lifecycle: Lifecycle, from_state: str | None) -> list[str]:
    """Every state reachable from here, for a client that offers actions."""
    return spec.next_states(lifecycle, from_state)


def require(lifecycle: Lifecycle, from_state: str | None, to_state: str | None) -> None:
    """Raise Conflict unless the move is one the lifecycle allows."""
    if can(lifecycle, from_state, to_state):
        return
    allowed = next_states(lifecycle, from_state)
    raise Conflict(
        f"a {lifecycle} in {from_state} cannot move to {to_state}",
        detail={"from": from_state, "requested": to_state, "allowed": allowed},
    )


def is_scheduled(state: str) -> bool:
    """True while the appointment holds grid units and belongs on a calendar."""
    return state in SCHEDULED_STATES


def is_terminal(lifecycle: Lifecycle, state: str) -> bool:
    """True when nothing further can happen to the record."""
    return not next_states(lifecycle, state)
