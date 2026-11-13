"""Sessions and the general consultation queue (FR-BKG-09 to FR-BKG-11, FR-BKG-13).

    POST /clinics/{id}/sessions         a unit manager publishes a session
    GET  /clinics/{id}/sessions         the unit's sessions, today onwards, to book into
    GET  /sessions/{id}                 one session, with how full it is
    POST /sessions/{id}/tickets         a place in the queue, for oneself or at the desk
    GET  /sessions/{id}/queue           the desk's live queue, in position order
    POST /sessions/{id}/next            a doctor takes the next patient who has arrived
    POST /sessions/{id}/close           the manager closes it, recording what it achieved

The general line queues rather than holding time (D-01). A position is the
server's, from the order requests arrived in; a body that names a position is
refused, not ignored (guard SERVER_ASSIGNED_ORDER). Walk-ins join the same
queue at the desk, so online and physical tickets are one ordered list
(FR-BKG-13). No doctor is named until the patient is called in.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import replace
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import permissions, queue, schedule
from atria.core import settings as setting_rules
from atria.core.errors import Conflict, Forbidden, Invalid, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.catalogue import Catalogue
from atria.data.people import People
from atria.data.sessions import Sessions, window_of
from atria.http import requests
from atria.http.views import appointment_view
from atria.services.booking.appointments import booking, no_shows, role_used

logger = Logger(service="atria-queue")

_sessions: Sessions | None = None

SESSION_FIELDS = (
    "sessionId",
    "clinicId",
    "sessionDate",
    "startTime",
    "endTime",
    "rosteredClinicianCount",
    "expectedThroughputPerHour",
    "actualThroughputPerHour",
    "capacity",
    "issuedTickets",
    "status",
)

# Staff issue a general ticket to someone at the desk or on the phone.
TICKET_CHANNELS = ("WALK_IN", "PHONE")


def sessions() -> Sessions:
    global _sessions
    if _sessions is None:
        _sessions = Sessions(booking().repository, clock=booking().now)
    return _sessions


def use(store: Sessions | None) -> None:
    """Point the service at a store. For tests."""
    global _sessions
    _sessions = store


def part_of_day(start: str) -> str:
    hour = int(start[:2])
    return "MORNING" if hour < 12 else "AFTERNOON" if hour < 17 else "EVENING"


def session_view(session: dict[str, Any]) -> dict[str, Any]:
    shown = {name: session.get(name) for name in SESSION_FIELDS}
    capacity = int(session.get("capacity") or 0)
    issued = int(session.get("issuedTickets") or 0)
    return {
        **shown,
        "remaining": max(0, capacity - issued),
        "partOfDay": part_of_day(str(session.get("startTime") or "08:00")),
    }


def publish(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    data = booking()
    data.clinic(principal.tenant_id, clinic_id)
    permissions.require(
        principal, "session.publish", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    body = requests.json_body(event)
    if "capacity" in body:
        # Capacity is derived from the doctors and the pace, never typed (FR-BKG-10).
        raise Invalid("capacity is worked out from the doctors rostered and cannot be set")
    zone = data.zone(principal.tenant_id)
    tenant = data.tenant(principal.tenant_id)
    day, start, end, rostered = queue.validate_session(
        body,
        zone=zone,
        today=data.now().astimezone(zone).date(),
        minutes=rules.grid_unit_minutes(tenant),
    )
    store = sessions()
    clash = [
        s
        for s in store.for_unit(principal.tenant_id, clinic_id, day, day)
        if s.get("status") != "CLOSED"
        and not (end <= str(s["startTime"]) or start >= str(s["endTime"]))
    ]
    if clash:
        raise Conflict(
            "that overlaps a session already published", detail={"sessionId": clash[0]["sessionId"]}
        )
    per_hour = queue.throughput(store.closed_for_unit(principal.tenant_id, clinic_id))
    day_window = queue.SessionWindow(
        opens_at=dt.datetime.combine(day, dt.time.fromisoformat(start), tzinfo=zone),
        closes_at=dt.datetime.combine(day, dt.time.fromisoformat(end), tzinfo=zone),
    )
    made = store.publish(
        tenant_id=principal.tenant_id,
        clinic_id=clinic_id,
        day=day,
        start=start,
        end=end,
        rostered=rostered,
        per_hour=per_hour,
        capacity=queue.capacity(day_window, rostered=rostered, per_hour=per_hour),
        published_by=principal.person_id,
    )
    return session_view(made)


def list_for_unit(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    data = booking()
    data.clinic(principal.tenant_id, clinic_id)
    zone = data.zone(principal.tenant_id)
    today = data.now().astimezone(zone).date()
    raw_from = requests.query_parameter(event, "from")
    raw_to = requests.query_parameter(event, "to")
    first = schedule.parse_date(raw_from, name="from") if raw_from else today
    last = schedule.parse_date(raw_to, name="to") if raw_to else first + dt.timedelta(days=13)
    if (last - first).days > 31:
        raise Invalid("that range is wider than a month")
    found = sessions().for_unit(principal.tenant_id, clinic_id, first, last)
    if not principal.is_staff:
        # A patient sees what they can take a place in: not a session that
        # has closed, nor one whose hours are already over today.
        now = data.now()
        found = [
            s
            for s in found
            if s.get("status") != "CLOSED"
            and str(s["sessionDate"]) >= today.isoformat()
            and now < window_of(s, zone).closes_at
        ]
    return {
        "clinicId": clinic_id,
        "from": first.isoformat(),
        "to": last.isoformat(),
        "sessions": [session_view(s) for s in found],
    }


def one(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    session = sessions().session(principal.tenant_id, requests.path_parameter(event, "id"))
    return session_view(session)


def general_type(tenant_id: str, clinic_id: str) -> dict[str, Any]:
    """The general consultation this unit offers."""
    for kind in Catalogue(booking().repository).appointment_types(tenant_id):
        if kind.get("serviceLine") == "GENERAL" and setting_rules.offered_at(kind, clinic_id):
            return kind
    raise NotFound("this unit runs no general consultation queue")


def issue(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    body = requests.json_body(event) if event.get("body") else {}
    if "position" in body or "arrivalWindowStart" in body:
        raise Invalid(
            "a place in the queue is assigned by the server",
            detail={"rule": "SERVER_ASSIGNED_ORDER"},
        )
    store = sessions()
    data = booking()
    session = store.session(principal.tenant_id, requests.path_parameter(event, "id"))
    clinic_id = str(session["clinicId"])

    target = body.get("patientProfileId")
    # A staff member taking a place for themselves is a patient here
    # (guard SELF_SUBJECT_DROPS_STAFF_SCOPE).
    own = principal.patient_profile_id is not None and target in (
        None,
        principal.patient_profile_id,
    )
    caller = principal.as_patient() if principal.is_staff and own else principal
    by_patient = not caller.is_staff
    patient_id = caller.patient_profile_id if by_patient else str(target or "")
    if not patient_id:
        raise Invalid("patientProfileId is required")
    subject = Subject(
        tenant_id=principal.tenant_id, patient_profile_id=patient_id, clinic_id=clinic_id
    )
    # A patient's own place is a booking; staff adding someone is a walk-in,
    # which a clinician may do for their unit's queue though they book visits
    # only for themselves.
    permission = "appointment.create" if by_patient else "queue.add_walk_in"
    permissions.require(caller, permission, subject)
    data.patient_profile(principal.tenant_id, patient_id)

    if by_patient:
        channel = "ONLINE"
    else:
        channel = str(body.get("channel") or "WALK_IN").upper()
        if channel not in TICKET_CHANNELS:
            raise Invalid(
                "a queue ticket at the desk is a walk-in or a phone call",
                detail={"allowed": list(TICKET_CHANNELS)},
            )

    zone = data.zone(principal.tenant_id)
    today = data.now().astimezone(zone).date()
    if (
        str(session["sessionDate"]) < today.isoformat()
        or data.now() >= window_of(session, zone).closes_at
    ):
        raise Conflict("that session is over")
    kind = general_type(principal.tenant_id, clinic_id)
    if by_patient and str(kind.get("bookableBy", "BOTH")) == "STAFF":
        raise Invalid("this queue is joined at the desk")

    tickets = store.tickets(principal.tenant_id, str(session["sessionId"]))
    if any(
        t.get("patientProfileId") == patient_id and t.get("state") not in queue.DONE
        for t in tickets
    ):
        raise Conflict("this patient already has a place in that session")

    window = window_of(session, zone)
    ahead = sum(1 for t in tickets if t.get("state") in (*queue.WAITING, "ARRIVED"))
    start = queue.expected_start(
        window,
        ahead=ahead,
        rostered=int(session.get("rosteredClinicianCount") or 1),
        per_hour=float(
            str(session.get("expectedThroughputPerHour") or queue.SEEDED_THROUGHPUT_PER_HOUR)
        ),
        now=data.now(),
    )
    arrival = queue.arrival_window(start)
    if by_patient:
        rules.require_within_strikes(
            data.tenant(principal.tenant_id),
            no_shows=no_shows(
                data, principal.tenant_id, patient_id, data.tenant(principal.tenant_id)
            ),
            now=data.now(),
            start_at=arrival[0],
        )
    made = store.issue(
        tenant_id=principal.tenant_id,
        session=session,
        patient_profile_id=patient_id,
        appointment_type_id=str(kind["appointmentTypeId"]),
        channel=channel,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, permission),
        window=arrival,
    )
    tenant = data.tenant(principal.tenant_id)
    if not tenant.get("firstAppointmentAt"):
        data.mark_first_appointment(principal.tenant_id, str(made["createdAt"]))
    fresh = store.session(principal.tenant_id, str(session["sessionId"]))
    return {**appointment_view(made), **ticket_fields(made, fresh)}


def ticket_fields(appointment: dict[str, Any], session: dict[str, Any]) -> dict[str, Any]:
    """What a ticket shows beside the appointment: Nth of M, the window, the part of day."""
    return {
        "position": appointment.get("position"),
        "of": int(session.get("issuedTickets") or 0),
        "arrivalWindowStart": appointment.get("arrivalWindowStart"),
        "arrivalWindowEnd": appointment.get("arrivalWindowEnd"),
        "partOfDay": part_of_day(str(session.get("startTime") or "08:00")),
        "sessionStatus": session.get("status"),
    }


def recalculate(tenant_id: str, session_id: str) -> int:
    """Move waiting tickets' windows to the session's real pace. The count moved.

    Only a move past the tenant's threshold is written, and each written move
    texts the patient (services.notify.outbox), so a small drift is absorbed.
    """
    store = sessions()
    data = booking()
    session = store.session(tenant_id, session_id)
    if session.get("status") == "CLOSED":
        return 0
    zone = data.zone(tenant_id)
    threshold = int(data.tenant(tenant_id).get("queueMoveThresholdMinutes") or 30)
    window = window_of(session, zone)
    rostered = int(session.get("rosteredClinicianCount") or 1)
    per_hour = float(
        str(session.get("expectedThroughputPerHour") or queue.SEEDED_THROUGHPUT_PER_HOUR)
    )
    moved = 0
    ahead = 0
    for ticket in store.tickets(tenant_id, session_id):
        state = ticket.get("state")
        if state in queue.WAITING:
            start = queue.expected_start(
                window, ahead=ahead, rostered=rostered, per_hour=per_hour, now=data.now()
            )
            arrival = queue.arrival_window(start)
            if queue.moved_enough(
                str(ticket.get("arrivalWindowStart") or ""), arrival[0], threshold_minutes=threshold
            ):
                store.set_window(tenant_id, str(ticket["appointmentId"]), arrival)
                moved += 1
        if state in (*queue.WAITING, "ARRIVED"):
            ahead += 1
    if moved:
        logger.info("queue windows moved", extra={"sessionId": session_id, "moved": moved})
    return moved


def live_queue(principal: Principal, event: dict[str, Any], *, people: People) -> dict[str, Any]:
    session_id = requests.path_parameter(event, "id")
    store = sessions()
    session = store.session(principal.tenant_id, session_id)
    permissions.require(
        principal,
        "queue.read",
        Subject(tenant_id=principal.tenant_id, clinic_id=str(session["clinicId"])),
    )
    if not principal.is_staff:
        raise Forbidden("the live queue is the desk's")
    recalculate(principal.tenant_id, session_id)
    tickets = store.tickets(principal.tenant_id, session_id)
    seen = [t for t in tickets if t.get("state") in ("COMPLETED", "AWAITING_FEEDBACK")]
    window = window_of(session, booking().zone(principal.tenant_id))
    elapsed = max(
        0.0, (min(booking().now(), window.closes_at) - window.opens_at).total_seconds() / 3600
    )
    rostered = int(session.get("rosteredClinicianCount") or 1)
    return {
        **session_view(session),
        "appointments": [
            {**appointment_view(t), **ticket_flags(t, booking().now())} for t in tickets
        ],
        "patients": people.patient_names(
            principal.tenant_id, [str(t["patientProfileId"]) for t in tickets]
        ),
        "waiting": sum(1 for t in tickets if t.get("state") in queue.WAITING),
        "arrived": sum(1 for t in tickets if t.get("state") == "ARRIVED"),
        "inConsultation": sum(1 for t in tickets if t.get("state") == "IN_CONSULTATION"),
        "seen": len(seen),
        # Planned against actual so far (FR-BKG-13).
        "plannedPerHour": float(str(session.get("expectedThroughputPerHour") or 0)) * rostered,
        "actualPerHour": round(len(seen) / elapsed, 2) if elapsed >= 0.25 else None,
        "callPreview": call_preview(
            tickets, session, policy_in_force(principal.tenant_id, session)[0]
        ),
        "policy": policy_view(principal.tenant_id, session),
    }


def ticket_flags(ticket: dict[str, Any], now: dt.datetime) -> dict[str, Any]:
    """What the desk needs to see about a ticket beside its state (ADR 0022)."""
    waiting = ticket.get("state") in queue.WAITING
    return {
        "due": waiting and queue.is_due(ticket, now),
        "late": queue.is_late(ticket, now)
        if ticket.get("state") in (*queue.WAITING, "ARRIVED")
        else False,
        "bypassCount": int(str(ticket.get("bypassCount") or 0)),
        "urgent": bool(ticket.get("urgent")),
    }


def call_preview(
    tickets: list[dict[str, Any]], session: dict[str, Any], policy: queue.Policy
) -> dict[str, Any]:
    """What calling the next patient would do now, so the desk sees the cost first (R5)."""
    now = booking().now()
    decision = queue.next_call(tickets, now, policy)
    per_hour = float(
        str(session.get("expectedThroughputPerHour") or queue.SEEDED_THROUGHPUT_PER_HOUR)
    )
    minutes = queue.expected_consult_minutes(tickets, per_hour=per_hour)
    ends = now + dt.timedelta(minutes=minutes)
    bypassed = [
        {
            "appointmentId": str(t["appointmentId"]),
            "position": int(str(t.get("position") or 0)),
            "windowEnd": t.get("arrivalWindowEnd"),
        }
        for t in decision.bypassed
    ]
    breach = any((end := queue.window_end(t)) is not None and ends > end for t in decision.bypassed)
    return {
        "candidate": str(decision.candidate["appointmentId"]) if decision.candidate else None,
        "bypassed": bypassed,
        "hold": (
            {
                "appointmentId": decision.hold.appointment_id,
                "position": decision.hold.position,
                "until": rules.instant(decision.hold.until),
            }
            if decision.hold
            else None
        ),
        "expectedConsultMinutes": minutes,
        "wouldBreachWindow": breach,
    }


def policy_in_force(tenant_id: str, session: dict[str, Any]) -> tuple[queue.Policy, dict[str, str]]:
    """The queue rules in force for a session, and which level set each (ADR 0022)."""
    data = booking()
    unit = data.clinic(tenant_id, str(session["clinicId"])).get("queuePolicy")
    return queue.resolve_policy(
        data.tenant(tenant_id),
        unit if isinstance(unit, dict) else None,
        session.get("policy") if isinstance(session.get("policy"), dict) else None,
    )


def set_unit_policy(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """A unit's own queue rules, over the tenant's defaults. null clears one."""
    clinic_id = requests.path_parameter(event, "id")
    permissions.require(
        principal, "queue.configure", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    changes = queue.policy_changes(requests.json_body(event))
    data = booking()
    clinic = data.clinic(principal.tenant_id, clinic_id)
    current = clinic.get("queuePolicy")
    kept = dict(current) if isinstance(current, dict) else {}
    for name, value in changes.items():
        if value is None:
            kept.pop(name, None)
        else:
            kept[name] = value
    data.repository.update_existing(
        keys.clinic(principal.tenant_id, clinic_id), set_values={"queuePolicy": kept}, what="unit"
    )
    return policy_view(principal.tenant_id, {"clinicId": clinic_id, "policy": None})


def read_unit_policy(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The queue rules in force for a unit, and which level set each."""
    clinic_id = requests.path_parameter(event, "id")
    permissions.require(
        principal, "queue.read", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    return policy_view(principal.tenant_id, {"clinicId": clinic_id})


def set_session_policy(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The desk adjusts the rules for one session. null clears one."""
    store = sessions()
    session = store.session(principal.tenant_id, requests.path_parameter(event, "id"))
    permissions.require(
        principal,
        "queue.tune_session",
        Subject(tenant_id=principal.tenant_id, clinic_id=str(session["clinicId"])),
    )
    if session.get("status") == "CLOSED":
        raise Conflict("that session is closed")
    changes = queue.policy_changes(requests.json_body(event))
    current = session.get("policy")
    kept = dict(current) if isinstance(current, dict) else {}
    for name, value in changes.items():
        if value is None:
            kept.pop(name, None)
        else:
            kept[name] = value
    store.update(principal.tenant_id, str(session["sessionId"]), {"policy": kept})
    return policy_view(principal.tenant_id, {**session, "policy": kept})


def policy_view(tenant_id: str, session: dict[str, Any]) -> dict[str, Any]:
    policy, source = policy_in_force(tenant_id, session)
    return {
        "holdMinutes": policy.hold_minutes,
        "lateGraceMinutes": policy.late_grace_minutes,
        "maxBypass": policy.max_bypass,
        "source": source,
    }


def call_next(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """The next patient who is here goes in to a doctor (FR-BKG-13, ADR 0022).

    A doctor calls their own next patient; the desk may name the doctor. The
    doctor is assigned here, at check-in, and not before. The doctor never waits
    when someone is here, except that a booked patient already passed over once
    holds the next free doctor for a few minutes; the desk may override with a
    reason (overrideHold and reason in the body).
    """
    session_id = requests.path_parameter(event, "id")
    store = sessions()
    session = store.session(principal.tenant_id, session_id)
    clinic_id = str(session["clinicId"])
    body = requests.json_body(event) if event.get("body") else {}
    clinician_id = str(body.get("clinicianProfileId") or principal.staff_id or "")
    if not principal.has_role("CLINICIAN") and not body.get("clinicianProfileId"):
        raise Invalid("say which doctor is free")
    subject = Subject(
        tenant_id=principal.tenant_id, clinic_id=clinic_id, clinician_profile_id=clinician_id
    )
    permissions.require(principal, "queue.assign_next", subject)
    membership = booking().bookable_clinician(principal.tenant_id, clinician_id)
    if membership.get("clinicId") != clinic_id:
        raise Invalid("that doctor does not work in this unit")
    data = booking()
    now = data.now()
    override = bool(body.get("overrideHold"))
    reason = str(body.get("reason") or "").strip()
    if override and not reason:
        raise Invalid("say why the doctor is not waiting for the booked patient")
    # With an override the hold is not honoured, and the desk's reason is kept (ADR 0022 R5).
    in_force, _source = policy_in_force(principal.tenant_id, session)
    policy = replace(in_force, max_bypass=10**6) if override else in_force
    tickets = store.tickets(principal.tenant_id, session_id)
    decision = queue.next_call(tickets, now, policy)
    for appointment_id in decision.late:
        store.set_fields(principal.tenant_id, appointment_id, {"lateAt": rules.instant(now)})
    for appointment_id in decision.start_hold:
        store.set_fields(principal.tenant_id, appointment_id, {"holdStartedAt": rules.instant(now)})
    if decision.hold is not None:
        raise Conflict(
            "the doctor is held for a booked patient who has not arrived yet",
            detail={
                "rule": "HELD_FOR_BOOKED_PATIENT",
                "heldFor": decision.hold.appointment_id,
                "position": decision.hold.position,
                "until": rules.instant(decision.hold.until),
            },
        )
    ticket = decision.candidate
    if ticket is None:
        raise Conflict("nobody who has arrived is waiting")
    fields: dict[str, Any] = {
        "clinicianProfileId": clinician_id,
        "consultationStartedAt": rules.instant(now),
    }
    if decision.bypassed:
        fields["bypassedAppointmentIds"] = [str(t["appointmentId"]) for t in decision.bypassed]
    if override and reason:
        fields["bypassOverrideReason"] = reason[:200]
    moved, _event = data.move(
        tenant_id=principal.tenant_id,
        appointment=ticket,
        to_state="IN_CONSULTATION",
        kind="CONSULTATION_STARTED",
        actor_person_id=principal.person_id,
        actor_role=role_used(principal, "queue.assign_next"),
        fields=fields,
    )
    for passed in decision.bypassed:
        store.set_fields(
            principal.tenant_id,
            str(passed["appointmentId"]),
            {"bypassCount": int(str(passed.get("bypassCount") or 0)) + 1},
        )
    if session.get("status") == "OPEN":
        store.update(principal.tenant_id, session_id, {"status": "RUNNING"})
    recalculate(principal.tenant_id, session_id)
    return appointment_view(moved)


def close(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    session_id = requests.path_parameter(event, "id")
    store = sessions()
    session = store.session(principal.tenant_id, session_id)
    permissions.require(
        principal,
        "session.publish",
        Subject(tenant_id=principal.tenant_id, clinic_id=str(session["clinicId"])),
    )
    if session.get("status") == "CLOSED":
        raise Conflict("that session is already closed")
    data = booking()
    actual = queue.actual_throughput(
        store.tickets(principal.tenant_id, session_id),
        window=window_of(session, data.zone(principal.tenant_id)),
        rostered=int(session.get("rosteredClinicianCount") or 1),
        closed_at=data.now(),
    )
    closed = store.update(
        principal.tenant_id,
        session_id,
        {
            "status": "CLOSED",
            "closedAt": rules.instant(data.now()),
            "actualThroughputPerHour": str(actual),
        },
    )
    return session_view(closed)


def route(principal: Principal, event: dict[str, Any], *, people: People) -> dict[str, Any] | None:
    """The queue's routes on the booking function, or None when the route is not one."""
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    if resource.endswith("/clinics/{id}/sessions"):
        if method == "POST":
            return publish(principal, event)
        if method == "GET":
            return list_for_unit(principal, event)
    if method == "GET" and resource.endswith("/sessions/{id}"):
        return one(principal, event)
    if method == "POST" and resource.endswith("/sessions/{id}/tickets"):
        return issue(principal, event)
    if method == "GET" and resource.endswith("/sessions/{id}/queue"):
        return live_queue(principal, event, people=people)
    if method == "POST" and resource.endswith("/sessions/{id}/next"):
        return call_next(principal, event)
    if method == "POST" and resource.endswith("/sessions/{id}/close"):
        return close(principal, event)
    if method == "PATCH" and resource.endswith("/sessions/{id}/policy"):
        return set_session_policy(principal, event)
    if method == "PATCH" and resource.endswith("/clinics/{id}/queue-policy"):
        return set_unit_policy(principal, event)
    if method == "GET" and resource.endswith("/clinics/{id}/queue-policy"):
        return read_unit_policy(principal, event)
    return None
