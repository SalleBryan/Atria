"""Recording staff access to patient data, in one place for every route.

The API wrapper (handler.api) calls `after` with each successful response.
Which requests are recorded is decided by the ROUTES table below rather than
by each service remembering to, because a route that forgot would be a gap in
a legal record that nobody would notice (FR-PRV-06).

What is recorded:

    a staff request that returned patients' data, with every patient on it;
    a staff request that changed a patient's appointment;
    every other privileged change (staff accounts, hours, time off), and
    an export of the audit log itself.

A patient reading their own record is not recorded, and neither is a staff
member acting on their own appointment, which the services already treat as
the patient doing it (guard SELF_SUBJECT_DROPS_STAFF_SCOPE).

Recording a read fails closed: if the entry cannot be written the caller gets
a 500 rather than data nobody will know they saw. A change has already
happened by the time it is recorded, so a failure there is logged loudly
instead, and the caller still learns the outcome.

A service adds what only it knows, such as a flag, through `note`.
"""

from __future__ import annotations

import contextvars
import json
from dataclasses import dataclass
from typing import Any

from aws_lambda_powertools import Logger

from atria.core.principal import Principal
from atria.data import audit as store
from atria.data.repository import Repository
from atria.http import requests

logger = Logger(service="atria-audit")

MAX_REASON = 500
MAX_AGENT = 200

# Highest first: the role an entry names when an account holds several.
ROLE_ORDER = ("TENANT_ADMIN", "CLINIC_MANAGER", "CLINICIAN", "RECEPTIONIST")


@dataclass(frozen=True, slots=True)
class Route:
    action: str
    kind: str
    subject_type: str
    subject_param: str | None = None
    """The path parameter naming the subject; None when the response names it."""
    subject_field: str | None = None
    """The response field naming the subject, for a create."""
    patient_data: bool = True
    """Recorded only when patients other than the actor are on it."""


READ, WRITE = store.READ, store.WRITE

VISIT_ACTIONS = (
    "reschedule",
    "confirm",
    "arrive",
    "start",
    "complete",
    "no-show",
    "place",
    "decline",
)

ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/appointments/{id}"): Route("appointment.read", READ, "APPOINTMENT", "id"),
    ("DELETE", "/appointments/{id}"): Route("appointment.cancel", WRITE, "APPOINTMENT", "id"),
    ("POST", "/appointments"): Route(
        "appointment.create", WRITE, "APPOINTMENT", subject_field="appointmentId"
    ),
    **{
        ("POST", f"/appointments/{{id}}/{name}"): Route(
            f"appointment.{name.replace('-', '_')}", WRITE, "APPOINTMENT", "id"
        )
        for name in VISIT_ACTIONS
    },
    # Care context (FR-PRV-10): a clinician reading a patient's answers is a
    # read of patient data like any other, and recorded as one.
    ("GET", "/appointments/{id}/care-context"): Route(
        "care_context.read", READ, "APPOINTMENT", "id"
    ),
    ("PUT", "/appointments/{id}/care-context"): Route(
        "care_context.write", WRITE, "APPOINTMENT", "id"
    ),
    ("GET", "/sessions/{id}/queue"): Route("queue.read", READ, "SESSION", "id"),
    ("POST", "/sessions/{id}/tickets"): Route("queue.ticket", WRITE, "SESSION", "id"),
    ("POST", "/sessions/{id}/next"): Route("queue.call_next", WRITE, "SESSION", "id"),
    ("POST", "/clinics/{id}/sessions"): Route(
        "session.publish", WRITE, "CLINIC", "id", patient_data=False
    ),
    ("POST", "/sessions/{id}/close"): Route(
        "session.close", WRITE, "SESSION", "id", patient_data=False
    ),
    ("GET", "/clinics/{id}/requests"): Route("request.inbox", READ, "CLINIC", "id"),
    ("GET", "/patients"): Route("patient.search", READ, "REGISTER"),
    ("GET", "/patients/{id}"): Route("patient.read", READ, "PATIENT", "id"),
    ("POST", "/patients"): Route(
        "patient.create", WRITE, "PATIENT", subject_field="patientProfileId"
    ),
    ("GET", "/clinicians/{id}/calendar"): Route("schedule.calendar", READ, "CLINICIAN", "id"),
    ("GET", "/clinics/{id}/day"): Route("schedule.day", READ, "CLINIC", "id"),
    ("PUT", "/clinicians/{id}/hours"): Route(
        "availability.hours", WRITE, "CLINICIAN", "id", patient_data=False
    ),
    ("POST", "/clinicians/{id}/time-off"): Route(
        "availability.time_off", WRITE, "CLINICIAN", "id", patient_data=False
    ),
    ("DELETE", "/clinicians/{id}/time-off/{groupId}"): Route(
        "availability.give_back", WRITE, "CLINICIAN", "id", patient_data=False
    ),
    ("POST", "/admin/staff"): Route(
        "staff.create", WRITE, "STAFF", subject_field="staffId", patient_data=False
    ),
    ("PATCH", "/admin/staff/{id}/roles"): Route(
        "staff.update_roles", WRITE, "STAFF", "id", patient_data=False
    ),
    ("PUT", "/admin/staff/{id}/priority-allowance"): Route(
        "staff.priority_allowance", WRITE, "STAFF", "id", patient_data=False
    ),
    ("POST", "/admin/staff/{id}/suspend"): Route(
        "staff.suspend", WRITE, "STAFF", "id", patient_data=False
    ),
    ("POST", "/admin/staff/{id}/temporary-password"): Route(
        "staff.reset_password", WRITE, "STAFF", "id", patient_data=False
    ),
    ("PATCH", "/admin/settings"): Route("settings.tenant", WRITE, "TENANT", patient_data=False),
    ("POST", "/admin/clinics"): Route(
        "settings.unit_create", WRITE, "CLINIC", subject_field="clinicId", patient_data=False
    ),
    ("PATCH", "/admin/clinics/{id}"): Route(
        "settings.unit", WRITE, "CLINIC", "id", patient_data=False
    ),
    ("DELETE", "/admin/clinics/{id}"): Route(
        "settings.unit_delete", WRITE, "CLINIC", "id", patient_data=False
    ),
    ("POST", "/admin/appointment-types"): Route(
        "settings.type_create",
        WRITE,
        "APPOINTMENT_TYPE",
        subject_field="appointmentTypeId",
        patient_data=False,
    ),
    ("POST", "/admin/intake-forms"): Route(
        "settings.form_create",
        WRITE,
        "INTAKE_FORM",
        subject_field="intakeFormId",
        patient_data=False,
    ),
    ("PUT", "/admin/intake-forms/{id}"): Route(
        "settings.form_change", WRITE, "INTAKE_FORM", "id", patient_data=False
    ),
    ("PATCH", "/admin/appointment-types/{id}"): Route(
        "settings.type_change", WRITE, "APPOINTMENT_TYPE", "id", patient_data=False
    ),
    ("PUT", "/admin/fee-bands/{id}"): Route(
        "settings.fee_band", WRITE, "FEE_BAND", "id", patient_data=False
    ),
    ("GET", "/audit/export"): Route("audit.export", READ, "AUDIT_LOG", patient_data=False),
}

# Response fields that carry appointments, each naming its patient.
LIST_FIELDS = ("appointments", "disrupted", "results")

_log: store.AuditLog | None = None
_flags: contextvars.ContextVar[tuple[str, ...]] = contextvars.ContextVar("audit_flags", default=())


def audit_log() -> store.AuditLog:
    global _log
    if _log is None:
        _log = store.AuditLog(Repository())
    return _log


def use(log: store.AuditLog | None) -> None:
    """Point the recorder at a log, or back at the deployed table with None. For tests."""
    global _log
    _log = log


def note(*flags: str) -> None:
    """Add flags to the entry this request will write, if it writes one."""
    _flags.set(tuple(dict.fromkeys((*_flags.get(), *flags))))


def begin() -> None:
    """Forget the last invocation's notes. A warm container runs many."""
    _flags.set(())


def route_for(event: dict[str, Any]) -> Route | None:
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    for (verb, path), route in ROUTES.items():
        if verb == method and resource.endswith(path) and _same_depth(resource, path):
            return route
    return None


def _same_depth(resource: str, path: str) -> bool:
    # "/appointments" must not match "/patients/me/appointments".
    return resource.count("/") == path.count("/")


def patients_in(body: Any) -> list[str]:
    """Every patient profile a response names, in the order it names them."""
    if not isinstance(body, dict):
        return []
    found: list[str] = []
    if body.get("patientProfileId"):
        found.append(str(body["patientProfileId"]))
    for field in LIST_FIELDS:
        for item in body.get(field) or []:
            if isinstance(item, dict) and item.get("patientProfileId"):
                found.append(str(item["patientProfileId"]))
    return list(dict.fromkeys(found))


def clinic_in(body: Any, principal: Principal) -> str | None:
    """The clinic an entry belongs to, which is what a unit manager's view filters on."""
    if isinstance(body, dict):
        if body.get("clinicId"):
            return str(body["clinicId"])
        for field in LIST_FIELDS:
            for item in body.get(field) or []:
                if isinstance(item, dict) and item.get("clinicId"):
                    return str(item["clinicId"])
    return principal.clinic_id


def role_of(principal: Principal) -> str | None:
    return next((role for role in ROLE_ORDER if principal.has_role(role)), None)


def source_of(event: dict[str, Any]) -> dict[str, str]:
    context = event.get("requestContext") or {}
    identity = context.get("identity") or {}
    return {
        "ip": str(identity.get("sourceIp") or ""),
        "userAgent": str(requests.header(event, "User-Agent") or "")[:MAX_AGENT],
        "requestId": str(context.get("requestId") or ""),
    }


def reason_in(event: dict[str, Any]) -> str | None:
    raw = event.get("body")
    if not raw:
        return None
    try:
        body = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    reason = body.get("reason") if isinstance(body, dict) else None
    return str(reason).strip()[:MAX_REASON] or None if reason else None


def entry_for(event: dict[str, Any], response: dict[str, Any]) -> dict[str, Any] | None:
    """The entry a response calls for, or None when there is nothing to record."""
    route = route_for(event)
    status = int(response.get("statusCode") or 0)
    if route is None or not 200 <= status < 300:
        return None
    try:
        principal = requests.principal_from(event)
    except Exception:
        return None
    if not principal.is_staff:
        return None

    try:
        body = json.loads(response.get("body") or "null")
    except (TypeError, json.JSONDecodeError):
        body = None

    patients = [p for p in patients_in(body) if p != principal.patient_profile_id]
    if route.patient_data and not patients:
        # Nobody else's data was on it: an empty day, or the actor's own visit.
        return None

    if route.subject_param:
        subject_id = str((event.get("pathParameters") or {}).get(route.subject_param) or "")
    elif route.subject_field and isinstance(body, dict):
        subject_id = str(body.get(route.subject_field) or "")
    else:
        subject_id = ""

    log = audit_log()
    return store.entry_item(
        tenant_id=principal.tenant_id,
        occurred_at=log.now().isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        actor_person_id=principal.person_id,
        actor_staff_id=principal.staff_id,
        actor_role=role_of(principal),
        action=route.action,
        kind=route.kind,
        subject_type=route.subject_type,
        subject_id=subject_id,
        clinic_id=clinic_in(body, principal),
        patient_profile_ids=patients,
        reason=reason_in(event),
        flags=list(_flags.get()),
        source=source_of(event),
        status=status,
    )


def after(event: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    """Record the request if it calls for it; the response, or a failure for a read."""
    route = route_for(event)
    if route is None:
        return response
    try:
        entry = entry_for(event, response)
        if entry is not None:
            audit_log().record(entry)
    except Exception:
        logger.exception("audit entry not written", extra={"action": route.action})
        if route.kind == READ:
            raise
    return response
