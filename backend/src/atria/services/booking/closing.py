"""Visits whose day is over are closed (2026-10-06).

A visit nobody acted on stayed Booked for good: four of a patient's visits
from late September still read Booked a week on. The lifecycle has always had
the move for it (BOOKED, CONFIRMED and RESCHEDULED to NO_SHOW, "scheduled end
passes"), but only staff ever made it, and only when they remembered.

Run every hour by an EventBridge schedule. A visit is closed once the day it
was on has ended on the hospital's own clock, not as soon as its grace runs
out: through the day the desk is still asked whether the patient came
(core.booking.no_show_due), and a patient seen late but not checked in can
still be recorded as arrived. After the day, nobody is going to.

    BOOKED, CONFIRMED, RESCHEDULED  NO_SHOW, its fee ledger entry written,
                                    as a no-show recorded at the desk is
    DISRUPTED                       CLINIC_CANCELLED, with a full refund: the
                                    hospital moved it and no new time was
                                    chosen (lifecycle: no alternative accepted)

A visit that arrived but was never closed by the clinician is left alone. The
lifecycle has no move for it that a clock could make honestly: the patient
was there, and whether they were seen is the clinician's to say.

Each visit is closed on its own; one that fails stays open and is tried again
the next hour. The days looked at reach back LOOKBACK_DAYS, so a run that
missed a day, or the first run after this was deployed, catches up.
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.data.catalogue import Catalogue
from atria.data.ledger import CLOSING, Ledger
from atria.services.booking.appointments import booking

logger = Logger(service="atria-closing")

# Phase 1 runs one tenant, the one patients join (identity/post_confirmation).
# A tenant list arrives with the second tenant, not before.
TENANT_ID = os.environ.get("DEFAULT_TENANT_ID", "")

LOOKBACK_DAYS = 31

# Who the closing step says acted. Not a person, and not a role anyone holds.
ACTOR = "system"
ACTOR_ROLE = "SYSTEM"

NOT_ATTENDED = ("BOOKED", "CONFIRMED", "RESCHEDULED")

NO_SHOW_REASON = "Closed automatically: no arrival was recorded by the end of the day."
DISRUPTED_REASON = "Closed automatically: no new time was chosen by the end of the day."


def _no_show(tenant_id: str, appointment: dict[str, Any], now: dt.datetime) -> None:
    data = booking()
    entry = Ledger(data.repository).entry_for(
        tenant_id=tenant_id,
        appointment=appointment,
        outcome=CLOSING["NO_SHOW"],
        occurred_at=rules.instant(now),
        zone=data.zone(tenant_id),
    )
    data.move(
        tenant_id=tenant_id,
        appointment=appointment,
        to_state="NO_SHOW",
        kind="NO_SHOW",
        actor_person_id=ACTOR,
        actor_role=ACTOR_ROLE,
        reason=NO_SHOW_REASON,
        fields={"noShowAt": rules.instant(now)},
        also=[entry],
    )


def _hospital_cancelled(tenant_id: str, appointment: dict[str, Any], now: dt.datetime) -> None:
    data = booking()
    kind = data.appointment_type(tenant_id, str(appointment["appointmentTypeId"]))
    decided = rules.cancellation(
        cancelled_by="CLINIC",
        start_at=rules.parse_instant(appointment["startAt"], name="startAt"),
        now=now,
        cancellation_window_minutes=int(kind.get("cancellationWindowMinutes") or 0),
    )
    entry = Ledger(data.repository).entry_for(
        tenant_id=tenant_id,
        appointment=appointment,
        outcome=decided.outcome,
        occurred_at=rules.instant(now),
        zone=data.zone(tenant_id),
    )
    data.cancel(
        tenant_id=tenant_id,
        appointment=appointment,
        cancellation=decided,
        actor_person_id=ACTOR,
        actor_role=ACTOR_ROLE,
        reason=DISRUPTED_REASON,
        minutes=rules.grid_unit_minutes(data.tenant(tenant_id)),
        also=[entry],
    )


def close_past(tenant_id: str, now: dt.datetime) -> dict[str, int]:
    """Close every open visit on a day that has ended, in each of the tenant's units."""
    data = booking()
    today = now.astimezone(data.zone(tenant_id)).date()
    closed = failed = 0
    for clinic in Catalogue(data.repository).clinics(tenant_id):
        clinic_id = str(clinic["clinicId"])
        for back in range(1, LOOKBACK_DAYS + 1):
            day = (today - dt.timedelta(days=back)).isoformat()
            for appointment in data.clinic_day(tenant_id, clinic_id, day):
                state = str(appointment.get("state") or "")
                if state not in (*NOT_ATTENDED, "DISRUPTED") or not appointment.get("endAt"):
                    continue
                try:
                    if state == "DISRUPTED":
                        _hospital_cancelled(tenant_id, appointment, now)
                    else:
                        _no_show(tenant_id, appointment, now)
                    closed += 1
                except Exception:
                    failed += 1
                    logger.exception(
                        "could not close a visit",
                        extra={"appointmentId": appointment.get("appointmentId")},
                    )
    logger.info("closing finished", extra={"closed": closed, "failed": failed})
    return {"closed": closed, "failed": failed}


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    return close_past(TENANT_ID, dt.datetime.now(tz=dt.UTC))
