"""Care context: the answers a patient sends ahead of one visit (FR-BKG-15, FR-PRV-10).

    GET /appointments/{id}/care-context    the form the visit asks, and any answers
    PUT /appointments/{id}/care-context    the patient's answers, with their consent

Only the patient and the assigned clinician read them (care_context.read is
own for both, none for the front desk, the unit manager and the
administrator, with no override: guard TENANT_ADMIN_NEVER_READS_CARE_CONTEXT).
Everyone else is refused with 403, whoever they are and whatever they hold.

The answers are given at booking (POST /appointments carries `intake`), or
added and changed later from the visit, until the visit starts. Each save
records a CARE_CONTEXT consent, by the patient or by their guardian, and the
answers live in their own table on their own key, gone 90 days after the visit.
"""

from __future__ import annotations

from typing import Any

from atria.core import booking as rules
from atria.core import intake, permissions
from atria.core.errors import Conflict, Forbidden, Invalid
from atria.core.principal import Principal
from atria.data.intake import CareContexts, IntakeForms, consent_item, form_view
from atria.data.repository import Item
from atria.http import requests
from atria.services.booking.appointments import booking, subject_of

# States in which a visit is still to come, so its answers can still change.
OPEN = ("REQUESTED", "BOOKED", "CONFIRMED", "RESCHEDULED", "DISRUPTED")
METHODS = ("APP", "WEB")

_care: CareContexts | None = None


def care() -> CareContexts:
    global _care
    if _care is None:
        _care = CareContexts()
    return _care


def use(store: CareContexts | None) -> None:
    """For tests: the care context store to use."""
    global _care
    _care = store


def forms() -> IntakeForms:
    return IntakeForms(booking().repository)


def form_for(tenant_id: str, appointment: Item) -> Item | None:
    """The form the visit's type asks, in its current version, if it has one."""
    kind = booking().appointment_type(tenant_id, str(appointment["appointmentTypeId"]))
    form_id = kind.get("intakeFormId")
    return forms().current(tenant_id, str(form_id)) if form_id else None


def _open(appointment: Item) -> bool:
    if str(appointment.get("state")) not in OPEN:
        return False
    if appointment.get("state") == "REQUESTED":
        return True
    start = rules.parse_instant(str(appointment["startAt"]), name="startAt")
    return start > booking().now()


def _view(
    appointment: Item, form: Item | None, held: Item | None, *, editable: bool
) -> dict[str, Any]:
    return {
        "appointmentId": appointment["appointmentId"],
        "patientProfileId": appointment.get("patientProfileId"),
        "form": form_view(form) if form else None,
        "answers": held.get("answers") if held else None,
        "submittedAt": held.get("submittedAt") if held else None,
        "editable": editable,
    }


def read(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    tenant_id = principal.tenant_id
    appointment = booking().appointment(tenant_id, requests.path_parameter(event, "id"))
    permissions.require(principal, "care_context.read", subject_of(appointment))
    held = care().get(tenant_id, str(appointment["appointmentId"]))
    form: Item | None
    if held:
        # The answers read beside the questions they answered.
        form = forms().version(
            tenant_id, str(held["intakeFormId"]), int(held.get("formVersion") or 1)
        )
    else:
        form = form_for(tenant_id, appointment)
    mine = principal.patient_profile_id == appointment.get("patientProfileId")
    return _view(appointment, form, held, editable=mine and _open(appointment) and form is not None)


def save(
    principal: Principal,
    appointment: Item,
    body: dict[str, Any],
    *,
    method_default: str = "WEB",
) -> dict[str, Any]:
    """Check and store answers for one visit, with the consent they need."""
    tenant_id = principal.tenant_id
    permissions.require(principal, "care_context.write", subject_of(appointment))
    if principal.patient_profile_id != appointment.get("patientProfileId"):
        # The clinician reads them; the answers are the patient's to give.
        raise Forbidden("only the patient answers the questions for their visit")
    if not _open(appointment):
        raise Conflict("the visit has started or is over, so its answers are kept as they were")
    form = form_for(tenant_id, appointment)
    if form is None:
        raise Invalid("this visit asks no questions")
    if body.get("consent") is not True:
        raise Invalid("sharing answers needs your consent: set consent to true")
    method = str(body.get("method") or method_default).upper()
    if method not in METHODS:
        raise Invalid("method must be one of these", detail={"allowed": list(METHODS)})
    cleaned = intake.answers(form, body.get("answers"))

    data = booking()
    profile = data.patient_profile(tenant_id, str(appointment["patientProfileId"]))
    # A minor's answers are consented to by their guardian (Law 2024/017).
    subject = str(profile.get("personId") or principal.person_id)
    granted_by = str(profile.get("guardianPersonId") or principal.person_id)
    key, consent = consent_item(
        subject_person_id=subject, granted_by_person_id=granted_by, method=method, at=data.now()
    )
    data.repository.put(key, consent)
    held = care().save(
        tenant_id=tenant_id,
        appointment=appointment,
        form=form,
        answers=cleaned,
        consent_record_id=str(consent["consentRecordId"]),
    )
    return _view(appointment, form, held, editable=True)


def write(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    appointment = booking().appointment(principal.tenant_id, requests.path_parameter(event, "id"))
    return save(principal, appointment, requests.json_body(event))


def check_at_booking(principal: Principal, appointment_type: Item, given: object) -> None:
    """Refuse a booking's answers before any time is held, so a slip in the form
    never leaves a booking without them or holds a slot for nothing."""
    if not isinstance(given, dict):
        raise Invalid("intake is an object: answers, consent")
    form_id = appointment_type.get("intakeFormId")
    if not form_id:
        raise Invalid("this visit asks no questions")
    form = forms().require(principal.tenant_id, str(form_id))
    if given.get("consent") is not True:
        raise Invalid("sharing answers needs your consent: set consent to true")
    intake.answers(form, given.get("answers"))


def route(principal: Principal, event: dict[str, Any]) -> dict[str, Any] | None:
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    if not resource.endswith("/appointments/{id}/care-context"):
        return None
    if method == "GET":
        return read(principal, event)
    if method == "PUT":
        return write(principal, event)
    return None
