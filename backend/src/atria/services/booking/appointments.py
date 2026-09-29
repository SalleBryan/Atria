"""Booking an appointment on the specialist line.

    POST /appointments      book a clinician and a time

The interesting part is not this module, it is the transaction in
atria.data.booking: the time is held by locking every grid unit the appointment
covers, so two patients asking for one minute produce one booking and one 409.

What this module owns is the order of the checks, and one rule the matrix
cannot express on its own. Where the caller is booking for their own patient
profile, every staff scope is dropped and only the patient row applies (guard
SELF_SUBJECT_DROPS_STAFF_SCOPE), so staff tooling cannot be turned on one's own
record.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import booking as rules
from atria.core import lifecycle, permissions
from atria.core.errors import AtriaError, Conflict, Forbidden, Invalid, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data import keys
from atria.data.audit import POTENTIAL_SELF_BENEFIT
from atria.data.booking import FUTURE_YEARS, HISTORY_YEARS, Booking
from atria.data.idempotency import COMPLETED, Idempotency, validate_key
from atria.data.ledger import Ledger, entry_view
from atria.data.repository import Repository
from atria.http import audit, paging, requests, responses
from atria.http.handler import api
from atria.http.views import appointment_view

logger = Logger(service="atria-booking")

WHEN = ("upcoming", "past", "all")

IDEMPOTENCY_HEADER = "Idempotency-Key"

_booking: Booking | None = None
_idempotency: Idempotency | None = None


def booking() -> Booking:
    global _booking
    if _booking is None:
        _booking = Booking(Repository())
    return _booking


def idempotency() -> Idempotency:
    global _idempotency
    if _idempotency is None:
        _idempotency = Idempotency(Repository())
    return _idempotency


def actor(principal: Principal, body: dict[str, Any]) -> tuple[Principal, bool]:
    """The caller as the matrix should see them, and whether they act as a patient.

    A staff member booking for their own patient profile is the self subject
    case, and is demoted before any permission is read.
    """
    if not principal.is_staff:
        return principal, True
    target = body.get("patientProfileId")
    if (
        principal.patient_profile_id is not None
        and isinstance(target, str)
        and target.strip() == principal.patient_profile_id
    ):
        return principal.as_patient(), True
    return principal, False


def role_used(principal: Principal, permission: str) -> str | None:
    """The role the permission was granted through, for the record of who booked.

    Blank where the patient booked for themselves, which is what the data model
    means by self service.
    """
    if not principal.is_staff:
        return None
    granting = [
        role for role in principal.acting_roles if permissions.scope_for(role, permission) != "none"
    ]
    if not granting:
        return None
    return max(granting, key=lambda r: permissions.SCOPE_RANK[permissions.scope_for(r, permission)])


def subject_of(appointment: dict[str, Any]) -> Subject:
    """The record an action is aimed at, as the matrix needs to see it."""
    return Subject(
        tenant_id=str(appointment.get("tenantId", "")),
        patient_profile_id=appointment.get("patientProfileId"),
        clinician_profile_id=appointment.get("clinicianProfileId"),
        clinic_id=appointment.get("clinicId"),
    )


# Guard REASONED_AND_AUDITED: how close the actor's own visit has to be to
# the one they move or cancel for the entry to be flagged. Either side, with
# the same clinician, which is the time a move could free up for them.
SELF_BENEFIT_WINDOW = dt.timedelta(hours=24)

# States in which the actor's own visit still holds time worth gaining.
HOLDING = ("BOOKED", "CONFIRMED", "RESCHEDULED", "ARRIVED")


def near_own_visit(caller: Principal, appointment: dict[str, Any], data: Booking) -> bool:
    """Whether the actor holds a visit with the same clinician near this one."""
    if not caller.is_staff or caller.patient_profile_id is None:
        return False
    start = rules.parse_instant(appointment["startAt"], name="startAt")
    own = data.appointments_for_patient(
        caller.tenant_id,
        caller.patient_profile_id,
        since=rules.instant(start - SELF_BENEFIT_WINDOW),
        until=rules.instant(start + SELF_BENEFIT_WINDOW),
    )
    return any(
        a.get("clinicianProfileId") == appointment.get("clinicianProfileId")
        and a.get("appointmentId") != appointment.get("appointmentId")
        and a.get("state") in HOLDING
        for a in own
    )


def flag_self_benefit(caller: Principal, appointment: dict[str, Any], data: Booking) -> None:
    """Flag a staff change made near the actor's own booking (POTENTIAL_SELF_BENEFIT).

    The flag puts the entry on the unit manager's weekly list, where a person
    decides whether it was what it looks like (FR-STF-13).
    """
    if near_own_visit(caller, appointment, data):
        audit.note(POTENTIAL_SELF_BENEFIT)


def no_shows(data: Booking, tenant_id: str, patient_profile_id: str, tenant: dict[str, Any]) -> int:
    """Missed visits in the tenant's rolling window, for the strike rule (FR-TEN-04)."""
    if not int(tenant.get("noShowStrikeThreshold") or 0):
        return 0
    days = int(tenant.get("noShowStrikeWindowDays") or 180)
    now = data.now()
    found = data.appointments_for_patient(
        tenant_id,
        patient_profile_id,
        since=rules.instant(now - dt.timedelta(days=days)),
        until=rules.instant(now),
    )
    return sum(1 for a in found if a.get("state") == "NO_SHOW")


def mine(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """A patient's own appointments, upcoming or past, earliest first (FR-VIS-01).

    The four range views are a later concern; what this answers is the
    question a patient actually starts with, which is what is coming up and
    what has already happened.
    """
    if principal.patient_profile_id is None:
        raise Invalid("this account holds no patient profile")
    permissions.require(
        principal,
        "appointment.read",
        Subject(
            tenant_id=principal.tenant_id,
            patient_profile_id=principal.patient_profile_id,
        ),
    )

    when = (requests.query_parameter(event, "when") or "all").lower()
    if when not in WHEN:
        raise Invalid("unknown value for when", detail={"allowed": list(WHEN)})

    data = booking()
    now = rules.instant(data.now())
    horizon = data.now().replace(year=data.now().year - HISTORY_YEARS)
    future = data.now().replace(year=data.now().year + FUTURE_YEARS)
    since, until = {
        "upcoming": (now, rules.instant(future)),
        "past": (rules.instant(horizon), now),
        "all": (rules.instant(horizon), rules.instant(future)),
    }[when]

    found = data.appointments_for_patient(
        principal.tenant_id, principal.patient_profile_id, since=since, until=until
    )
    shown, more = paging.page(found, event)
    return {
        "when": when,
        "from": since,
        "to": until,
        **more,
        "appointments": [appointment_view(a) for a in shown],
    }


def one(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """One appointment, if it is inside the caller's scope (FR-VIS-02)."""
    appointment_id = requests.path_parameter(event, "id")
    appointment = booking().appointment(principal.tenant_id, appointment_id)
    subject = subject_of(appointment)
    # A staff member reading their own appointment is a patient here, the same
    # as when booking it (guard SELF_SUBJECT_DROPS_STAFF_SCOPE).
    caller = permissions.effective_principal(principal, subject)
    permissions.require(caller, "appointment.read", subject)
    shown = appointment_view(appointment)
    data = booking()
    ledger = Ledger(data.repository)
    if permissions.allows(caller, "fee_ledger.read", subject):
        shown["ledger"] = entry_view(ledger.entry(principal.tenant_id, appointment_id))
    if appointment.get("state") in lifecycle_cancellable():
        try:
            shown["cancellationPreview"] = cancellation_preview(
                data, ledger, principal.tenant_id, appointment
            )
        except NotFound:
            # A type since removed: the visit still reads, without a preview.
            shown["cancellationPreview"] = None
    return shown


def lifecycle_cancellable() -> tuple[str, ...]:
    return ("BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED")


def cancellation_preview(
    data: Booking, ledger: Ledger, tenant_id: str, appointment: dict[str, Any]
) -> dict[str, Any]:
    """What cancelling now would record, for the cancel screen to say first (FR-MSR-06)."""
    kind = data.appointment_type(tenant_id, str(appointment["appointmentTypeId"]))
    window = int(kind.get("cancellationWindowMinutes") or 0)
    start = rules.parse_instant(appointment["startAt"], name="startAt")
    decided = rules.cancellation(
        cancelled_by="PATIENT", start_at=start, now=data.now(), cancellation_window_minutes=window
    )
    _key, entry = ledger.entry_for(
        tenant_id=tenant_id,
        appointment=appointment,
        outcome=decided.outcome,
        occurred_at=rules.instant(data.now()),
        zone=data.zone(tenant_id),
    )
    return {
        "outcome": decided.outcome,
        "entitlement": decided.entitlement,
        "amountMinor": entry.get("amountMinor"),
        "currency": entry.get("currency"),
        "freeUntil": rules.instant(start - dt.timedelta(minutes=window)),
    }


def cancel(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """Cancel a booked appointment and free its time (FR-VIS-03).

    A patient cancels their own; staff cancel within their clinic and have to
    say whether the patient or the clinic called it off, because the two land
    in different states and owe the patient different things. A patient can
    only ever cancel as the patient.
    """
    appointment_id = requests.path_parameter(event, "id")
    data = booking()
    appointment = data.appointment(principal.tenant_id, appointment_id)
    subject = subject_of(appointment)
    caller = permissions.effective_principal(principal, subject)
    permissions.require(caller, "appointment.cancel", subject)

    body = requests.json_body(event) if event.get("body") else {}
    if caller.is_staff:
        cancelled_by = str(body.get("cancelledBy") or "").upper()
        if not cancelled_by:
            raise Invalid(
                "cancelledBy is required, because the entitlement depends on it",
                detail={"allowed": list(rules.CANCELLED_BY)},
            )
    else:
        # A patient cannot declare that the clinic cancelled.
        cancelled_by = "PATIENT"

    appointment_type = data.appointment_type(
        principal.tenant_id, str(appointment["appointmentTypeId"])
    )
    decided = rules.cancellation(
        cancelled_by=cancelled_by,
        start_at=rules.parse_instant(appointment["startAt"], name="startAt"),
        now=data.now(),
        cancellation_window_minutes=int(appointment_type.get("cancellationWindowMinutes") or 0),
    )

    flag_self_benefit(caller, appointment, data)
    # FR-MSR-05: the ledger entry closes with the visit, in one transaction.
    entry = Ledger(data.repository).entry_for(
        tenant_id=principal.tenant_id,
        appointment=appointment,
        outcome=decided.outcome,
        occurred_at=rules.instant(data.now()),
        zone=data.zone(principal.tenant_id),
    )
    cancelled, _event = data.cancel(
        tenant_id=principal.tenant_id,
        appointment=appointment,
        cancellation=decided,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "appointment.cancel"),
        reason=rules.require_reason(
            str(body.get("reason") or "") or None, by_staff=caller.is_staff, action="cancel"
        ),
        minutes=rules.grid_unit_minutes(data.tenant(principal.tenant_id)),
        also=[entry],
    )
    logger.info(
        "appointment cancelled",
        extra={
            "appointmentId": appointment_id,
            "state": decided.state,
            "entitlement": decided.entitlement,
        },
    )
    return {
        **appointment_view(cancelled),
        "outcome": decided.outcome,
        "entitlement": decided.entitlement,
        "note": "The time is free again. Nothing is settled; the entitlement is a record.",
    }


def create(principal: Principal, body: dict[str, Any]) -> dict[str, Any]:
    """Book a specialist appointment, holding its grid units in one transaction."""
    caller, by_patient = actor(principal, body)

    # Asked before anything is read, so a role that cannot book at all learns
    # nothing about which clinicians or patients exist.
    permissions.require(caller, "appointment.create")

    request = rules.validate(
        body, by_patient=by_patient, own_patient_profile_id=caller.patient_profile_id
    )

    data = booking()
    if by_patient:
        # A deleted account waiting out its 30 days books nothing until restored.
        me = data.repository.get(keys.person(caller.person_id)) or {}
        if me.get("deletion"):
            raise Conflict("this account is deleted; restore it to book again")
    membership = data.bookable_clinician(caller.tenant_id, request.clinician_profile_id)
    clinic_id = str(membership["clinicId"])

    permissions.require(
        caller,
        "appointment.create",
        Subject(
            tenant_id=caller.tenant_id,
            patient_profile_id=request.patient_profile_id,
            clinician_profile_id=request.clinician_profile_id,
            clinic_id=clinic_id,
        ),
    )

    # The patient has to exist before their time is held, or a mistyped
    # identifier would lock a clinician's morning for nobody.
    data.patient_profile(caller.tenant_id, request.patient_profile_id)

    appointment_type = data.appointment_type(caller.tenant_id, request.appointment_type_id)
    tenant = data.tenant(caller.tenant_id)
    minutes = rules.grid_unit_minutes(tenant)
    rules.require_on_grid(request.start_at, minutes=minutes)
    rules.require_bookable(
        appointment_type,
        by_patient=by_patient,
        now=data.now(),
        start_at=request.start_at,
    )
    rules.require_offered(appointment_type, clinic_id)
    # The intake answers (FR-BKG-15) are checked before any time is held.
    given_intake = body.get("intake")
    if given_intake is not None:
        from atria.services.booking import care

        if not by_patient:
            # The desk never sees or gives care context (FR-PRV-10).
            raise Forbidden("intake answers are the patient's to give")
        care.check_at_booking(caller, appointment_type, given_intake)
    if (
        request.channel == "REFERRAL"
        and appointment_type.get("serviceLine") not in rules.REFERRAL_LINES
    ):
        raise Invalid("a referral is for a specialist visit or a procedure")
    if request.channel == "WALK_IN":
        zone = data.zone(caller.tenant_id)
        if request.start_at.astimezone(zone).date() != data.now().astimezone(zone).date():
            # A walk-in is someone at the desk now; a later day is a phone or a referral.
            raise Invalid("a walk-in is booked for today")
    if by_patient:
        rules.require_within_strikes(
            tenant,
            no_shows=no_shows(data, caller.tenant_id, request.patient_profile_id, tenant),
            now=data.now(),
            start_at=request.start_at,
        )

    occupancy = rules.occupancy(
        request.start_at,
        duration_units=int(appointment_type.get("durationUnits") or 0),
        buffer_units=int(appointment_type.get("bufferUnits") or 0),
        minutes=minutes,
    )
    lifecycle.require("appointment", None, "BOOKED")

    appointment, _event = data.book_specialist(
        tenant_id=caller.tenant_id,
        clinic_id=clinic_id,
        request=request,
        occupancy=occupancy,
        actor_person_id=caller.person_id,
        actor_role=role_used(caller, "appointment.create"),
        local_day=occupancy.start_at.astimezone(data.zone(caller.tenant_id)).date().isoformat(),
    )
    if not tenant.get("firstAppointmentAt"):
        # FR-TEN-07: the region pack and grid lock from here on.
        data.mark_first_appointment(
            caller.tenant_id, str(appointment.get("createdAt") or rules.instant(data.now()))
        )
    logger.info(
        "appointment booked",
        extra={
            "appointmentId": appointment["appointmentId"],
            "clinicId": clinic_id,
            "units": len(occupancy.units),
        },
    )
    view = appointment_view(appointment)
    if given_intake is not None:
        from atria.services.booking import care

        try:
            care.save(caller, appointment, dict(given_intake))
            view["careContext"] = "SAVED"
        except Exception:
            # The booking stands; the answers can be sent again from the visit.
            logger.exception(
                "intake answers not saved", extra={"appointmentId": appointment["appointmentId"]}
            )
            view["careContext"] = "NOT_SAVED"
    return view


def book(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    """POST /appointments, absorbing a retry that carries the same key.

    Without a key this is simply a booking. With one, the key is claimed before
    the work starts, so two requests arriving together cannot both proceed, and
    a repeat is answered with the original appointment rather than the 409 the
    slot locks would otherwise produce (FR-BKG-04).
    """
    body = requests.json_body(event)
    supplied = requests.header(event, IDEMPOTENCY_HEADER)
    if supplied is None:
        return responses.created(create(principal, body))

    key = validate_key(supplied)
    store = idempotency()
    held = store.claim(principal.tenant_id, key, request=body)
    if held is not None:
        if str(held.get("status")) != COMPLETED:
            # The first attempt is still running. Retrying again later is the
            # right answer; returning a half finished booking is not.
            raise Conflict(
                "a request with that Idempotency-Key is still being processed",
                detail={"idempotencyKey": key},
            )
        logger.info("idempotent replay", extra={"idempotencyKey": key})
        return responses.created(held.get("response"), headers={"Idempotency-Replayed": "true"})

    try:
        booked = create(principal, body)
    except Exception:
        # The key goes back, or the client's retry would be refused for a day
        # because of a failure that had nothing to do with the key.
        store.release(principal.tenant_id, key)
        raise
    store.record(principal.tenant_id, key, response=booked)
    return responses.created(booked)


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """POST /appointments, GET /patients/me/appointments, GET /appointments/{id},
    DELETE /appointments/{id}, POST /appointments/{id}/<action> (visits.py) and
    GET and PUT /appointments/{id}/care-context (care.py)."""
    # Imported here: visits, the queue and requests build on this module's helpers.
    from atria.data.people import People
    from atria.services.booking import care, queue, visits
    from atria.services.booking import requests as procedure_requests

    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))

    answered = care.route(principal, event)
    if answered is not None:
        return responses.ok(answered)

    staff_people = People(booking().repository)
    queued = queue.route(principal, event, people=staff_people)
    if queued is not None:
        created = method == "POST" and (
            resource.endswith("/sessions") or resource.endswith("/tickets")
        )
        return responses.created(queued) if created else responses.ok(queued)
    if method == "POST" and resource.endswith("/procedure-requests"):
        return responses.created(procedure_requests.request(principal, event))
    if method == "GET" and resource.endswith("/clinics/{id}/requests"):
        return responses.ok(procedure_requests.inbox(principal, event, people=staff_people))

    if method == "POST" and resource.startswith("/appointments/{id}/"):
        action = visits.ACTIONS.get(resource.rsplit("/", 1)[-1])
        if action is not None:
            return responses.ok(action(principal, event))

    if method == "POST" and resource.endswith("/appointments"):
        return book(principal, event)
    if method == "GET" and resource.endswith("/patients/me/appointments"):
        return responses.ok(mine(principal, event))
    if method == "GET" and resource.endswith("/appointments/{id}"):
        return responses.ok(one(principal, event))
    if method == "DELETE" and resource.endswith("/appointments/{id}"):
        cancelled = cancel(principal, event)
        if cancelled.get("sessionId"):
            # A place freed moves everyone behind it forward.
            queue.recalculate(principal.tenant_id, str(cancelled["sessionId"]))
        return responses.ok(cancelled)

    # Every route on this function is listed above, so this is a wiring mistake
    # in the API stack rather than anything the caller did.
    raise AtriaError(f"no handler for {method} {resource}")


# The states a visit is still to come in, and so can be called off.
STILL_AHEAD = ("BOOKED", "CONFIRMED", "RESCHEDULED")


def cancel_ahead(
    *,
    tenant_id: str,
    patient_profile_id: str,
    cancelled_by: str,
    actor_person_id: str,
    actor_role: str | None,
    reason: str,
) -> int:
    """Call off every visit and queue place a patient still has ahead, one cancellation each.

    For an account being deleted (2026-09-29): each visit goes through the
    same closure a cancellation does, so its time is freed, the ledger
    records the outcome and the patient is told. Returns how many.
    """
    data = booking()
    now = data.now()
    # From a day back: a queue ticket's arrival window may already have
    # opened today while the patient is still waiting for their turn.
    ahead = data.appointments_for_patient(
        tenant_id,
        patient_profile_id,
        since=rules.instant(now - dt.timedelta(days=1)),
        until=rules.instant(now + dt.timedelta(days=400)),
    )
    minutes = rules.grid_unit_minutes(data.tenant(tenant_id))
    done = 0
    for appointment in ahead:
        if appointment.get("state") not in STILL_AHEAD:
            continue
        ticket = bool(appointment.get("sessionId"))
        ends = rules.parse_instant(appointment["endAt"], name="endAt")
        starts = rules.parse_instant(appointment["startAt"], name="startAt")
        if (ticket and ends < now) or (not ticket and starts <= now):
            continue
        kind = data.appointment_type(tenant_id, str(appointment["appointmentTypeId"]))
        decided = rules.cancellation(
            cancelled_by=cancelled_by,
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
            actor_person_id=actor_person_id,
            actor_role=actor_role,
            reason=reason,
            minutes=minutes,
            also=[entry],
        )
        done += 1
    return done
