"""Sessions and their queue tickets (D-02, FR-BKG-10, FR-BKG-11, FR-BKG-13).

A session is TENANT#t#SESSION#id / SESSION, with its tickets in the same
partition under TICKET#<request time>#<ticket>, so a session and its queue are
one query in the order requests arrived. A listing entry per session,
TENANT#t#SESSIONS#<unit> / <date>#<start>#<id>, answers "the unit's sessions
this week" without an index.

Each ticket is also an appointment on the general line, with no clinician
until check-in, so a patient's visits, the desk's day, cancellation, arrival,
no-show, reminders, the audit trail and the fee ledger treat a ticket as the
visit it is. The appointment carries the session, the position and the arrival
window; the ticket item carries the order.

A position is taken by raising the session's issued count conditionally on
the count that was read, in the same transaction as the ticket and its
appointment: two requests at once cannot take one position, and the loser
simply reads again and takes the next (guard SERVER_ASSIGNED_ORDER).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria.core import booking as rules
from atria.core import queue
from atria.core.errors import Conflict, Invalid
from atria.data import keys
from atria.data.booking import event_item, reference
from atria.data.people import new_id
from atria.data.repository import Item, Repository

# How many times a ticket request re-reads the count after losing a race.
RETRIES = 5


def local_instant(day: dt.date, clock: str, zone: Any) -> dt.datetime:
    return dt.datetime.combine(day, dt.time.fromisoformat(clock), tzinfo=zone).astimezone(dt.UTC)


def window_of(session: Item, zone: Any) -> queue.SessionWindow:
    day = dt.date.fromisoformat(str(session["sessionDate"]))
    return queue.SessionWindow(
        opens_at=local_instant(day, str(session["startTime"]), zone),
        closes_at=local_instant(day, str(session["endTime"]), zone),
    )


class Sessions:
    def __init__(self, repository: Repository, *, clock: Any = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: dt.datetime.now(tz=dt.UTC))

    def now(self) -> dt.datetime:
        return self._clock()

    # ---------------------------------------------------------------- sessions
    def publish(
        self,
        *,
        tenant_id: str,
        clinic_id: str,
        day: dt.date,
        start: str,
        end: str,
        rostered: int,
        per_hour: float,
        capacity: int,
        published_by: str,
    ) -> Item:
        session_id = new_id("se")
        item: Item = {
            "type": "SESSION",
            "sessionId": session_id,
            "tenantId": tenant_id,
            "clinicId": clinic_id,
            "sessionDate": day.isoformat(),
            "startTime": start,
            "endTime": end,
            "rosteredClinicianCount": rostered,
            # Decimals, because DynamoDB takes no floats.
            "expectedThroughputPerHour": str(per_hour),
            "capacity": capacity,
            "issuedTickets": 0,
            "status": "OPEN",
            "publishedByPersonId": published_by,
            "publishedAt": rules.instant(self.now()),
        }
        listing = {
            "type": "SESSION_LISTING",
            "tenantId": tenant_id,
            "sessionId": session_id,
            "clinicId": clinic_id,
        }
        self._repo.write_together(
            [
                (keys.session(tenant_id, session_id), item),
                (
                    keys.session_listing(tenant_id, clinic_id, day.isoformat(), start, session_id),
                    listing,
                ),
            ]
        )
        return item

    def session(self, tenant_id: str, session_id: str) -> Item:
        found = self._repo.require(
            keys.session(tenant_id, session_id), what="session", consistent=True
        )
        if found.get("tenantId") != tenant_id:
            raise Invalid("no such session")
        return found

    def for_unit(self, tenant_id: str, clinic_id: str, first: dt.date, last: dt.date) -> list[Item]:
        """A unit's sessions from `first` to `last`, earliest first."""
        partition = keys.session_listing(tenant_id, clinic_id, "", "", "").pk
        listed = [
            e
            for e in self._repo.query_partition(partition)
            if first.isoformat() <= str(e["sk"])[:10] <= last.isoformat()
        ]
        wanted = [keys.session(tenant_id, str(e["sessionId"])) for e in listed]
        found = self._repo.get_many(wanted)
        sessions = [found[(k.pk, k.sk)] for k in wanted if (k.pk, k.sk) in found]
        return sorted(sessions, key=lambda s: (str(s["sessionDate"]), str(s["startTime"])))

    def closed_for_unit(self, tenant_id: str, clinic_id: str, *, days: int = 60) -> list[Item]:
        today = self.now().date()
        return [
            s
            # Forward too: a session closed early the day it ran is already evidence.
            for s in self.for_unit(
                tenant_id,
                clinic_id,
                today - dt.timedelta(days=days),
                today + dt.timedelta(days=days),
            )
            if s.get("status") == "CLOSED"
        ]

    def update(
        self,
        tenant_id: str,
        session_id: str,
        fields: dict[str, Any],
        *,
        expect: tuple[str, Any] | None = None,
    ) -> Item:
        return self._repo.update_existing(
            keys.session(tenant_id, session_id), set_values=fields, what="session", expect=expect
        )

    # ----------------------------------------------------------------- tickets
    def tickets(self, tenant_id: str, session_id: str) -> list[Item]:
        """The session's tickets in position order, each with its appointment."""
        found = self._repo.query_partition(
            keys.session(tenant_id, session_id).pk, sk_prefix="TICKET#"
        )
        wanted = [keys.appointment(tenant_id, str(t["appointmentId"])) for t in found]
        appointments = self._repo.get_many(wanted)
        joined = []
        for _ticket, key in zip(found, wanted, strict=True):
            appointment = appointments.get((key.pk, key.sk))
            if appointment:
                joined.append(appointment)
        return sorted(joined, key=lambda a: int(a.get("position") or 0))

    def issue(
        self,
        *,
        tenant_id: str,
        session: Item,
        patient_profile_id: str,
        appointment_type_id: str,
        channel: str,
        actor_person_id: str,
        actor_role: str | None,
        window: tuple[dt.datetime, dt.datetime],
        extra: dict[str, Any] | None = None,
    ) -> Item:
        """A ticket in the session at the next position, or Conflict when it is full."""
        session_id = str(session["sessionId"])
        current = session
        for _attempt in range(RETRIES):
            issued = int(current.get("issuedTickets") or 0)
            capacity = int(current.get("capacity") or 0)
            if current.get("status") == "CLOSED":
                raise Conflict("that session has closed")
            if issued >= capacity:
                raise Conflict("that session is full", detail={"capacity": capacity})
            position = issued + 1
            appointment_id = new_id("a")
            ticket_id = new_id("tk")
            occurred_at = rules.instant(self.now())
            appointment: Item = {
                "type": "APPOINTMENT",
                "appointmentId": appointment_id,
                "reference": reference(appointment_id),
                "tenantId": tenant_id,
                "clinicId": current["clinicId"],
                "patientProfileId": patient_profile_id,
                "appointmentTypeId": appointment_type_id,
                # No clinicianProfileId at all until check-in: it keys the
                # ClinicianIndex, and an index key may be absent but never null.
                "sessionId": session_id,
                "queueTicketId": ticket_id,
                "position": position,
                "startAt": rules.instant(window[0]),
                "endAt": rules.instant(window[1]),
                "arrivalWindowStart": rules.instant(window[0]),
                "arrivalWindowEnd": rules.instant(window[1]),
                "clinicDay": f"{current['clinicId']}#{current['sessionDate']}",
                "state": "BOOKED",
                "channel": channel,
                "bookedByPersonId": actor_person_id,
                "bookedByRole": actor_role,
                "version": 1,
                "createdAt": occurred_at,
                **(extra or {}),
            }
            ticket: Item = {
                "type": "QUEUE_TICKET",
                "queueTicketId": ticket_id,
                "sessionId": session_id,
                "tenantId": tenant_id,
                "patientProfileId": patient_profile_id,
                "appointmentId": appointment_id,
                "position": position,
                "requestedAt": occurred_at,
            }
            event = event_item(
                appointment_id=appointment_id,
                tenant_id=tenant_id,
                kind="BOOKED",
                from_state=None,
                to_state="BOOKED",
                actor_person_id=actor_person_id,
                actor_role=actor_role,
                reason=None,
                occurred_at=occurred_at,
            )
            try:
                self._repo.change_together(
                    creates=[
                        (keys.queue_ticket(tenant_id, session_id, occurred_at, ticket_id), ticket),
                        (keys.appointment(tenant_id, appointment_id), appointment),
                        (
                            keys.appointment_event(
                                tenant_id,
                                appointment_id,
                                occurred_at,
                                str(event["appointmentEventId"]),
                            ),
                            event,
                        ),
                    ],
                    updates=[
                        (
                            keys.session(tenant_id, session_id),
                            {"issuedTickets": position, "status": current.get("status") or "OPEN"},
                            ("issuedTickets", issued),
                        )
                    ],
                    conflict="the queue moved on",
                )
            except Conflict:
                # Somebody took that position first: read the count again.
                current = self.session(tenant_id, session_id)
                continue
            return appointment
        raise Conflict("the queue is busy; try again in a moment")

    def set_fields(self, tenant_id: str, appointment_id: str, fields: dict[str, Any]) -> None:
        """Set queue bookkeeping on a ticket: bypass count, hold clock, late and urgent marks."""
        self._repo.update_existing(
            keys.appointment(tenant_id, appointment_id), set_values=fields, what="appointment"
        )

    def set_window(
        self, tenant_id: str, appointment_id: str, window: tuple[dt.datetime, dt.datetime]
    ) -> None:
        self._repo.update_existing(
            keys.appointment(tenant_id, appointment_id),
            set_values={
                "arrivalWindowStart": rules.instant(window[0]),
                "arrivalWindowEnd": rules.instant(window[1]),
                "startAt": rules.instant(window[0]),
                "endAt": rules.instant(window[1]),
            },
            what="appointment",
        )
