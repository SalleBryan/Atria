"""The tenant administrator's settings (FR-ADM-03, FR-ADM-06, FR-TEN-02 to 07).

    GET   /admin/settings                   everything the settings screens show, in one read
    PATCH /admin/settings                   the tenant's settings and switches
    PATCH /admin/clinics/{id}               a unit's profile and opening hours
    POST  /admin/appointment-types          a new appointment type
    PATCH /admin/appointment-types/{id}     change or retire one
    PUT   /admin/fee-bands/{id}             a fee band's amount, as a new dated version

Each is its own permission in the matrix (clinic.manage, feature_flag.set,
region_pack.choose, appointment_type.manage, fee_band.manage), all a tenant
administrator's. Every change is recorded in the audit trail (http.audit).
The rules on each value are atria.core.settings; this module applies them.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from atria_spec.region_packs import REGION_PACKS

from atria.core import permissions
from atria.core import settings as rules
from atria.core.errors import AtriaError, NotFound
from atria.core.permissions import Subject
from atria.core.principal import Principal
from atria.data.catalogue import Catalogue
from atria.data.repository import Repository
from atria.data.settings import Settings
from atria.http import requests, responses
from atria.http.handler import api

TENANT_FIELDS = (
    "tenantId",
    "name",
    "regionPackCode",
    "gridUnitMinutes",
    "languages",
    "reminderLeadHours",
    "secondReminderHours",
    "queueMoveThresholdMinutes",
    "noShowStrikeThreshold",
    "noShowStrikeWindowDays",
    "qualityProgrammeEnabled",
    "ratingAffectsFee",
    "guardianConsent",
    "smsSenderId",
    "emailSenderName",
    "firstAppointmentAt",
)

DEFAULTS: dict[str, Any] = {
    "gridUnitMinutes": 10,
    "reminderLeadHours": 24,
    "secondReminderHours": 0,
    "queueMoveThresholdMinutes": 30,
    "noShowStrikeThreshold": 0,
    "noShowStrikeWindowDays": 180,
    "qualityProgrammeEnabled": False,
    "ratingAffectsFee": False,
    "guardianConsent": "DESK_OR_GUARDIAN_ACCOUNT",
}

# Which permission each tenant setting needs. Anything not named is clinic.manage.
SETTING_PERMISSION = {
    "regionPackCode": "region_pack.choose",
    "qualityProgrammeEnabled": "feature_flag.set",
    "ratingAffectsFee": "feature_flag.set",
    "noShowStrikeThreshold": "feature_flag.set",
    "noShowStrikeWindowDays": "feature_flag.set",
}

CLINIC_FIELDS = (
    "clinicId",
    "name",
    "address",
    "phone",
    "description",
    "services",
    "openingHours",
    "location",
)
TYPE_FIELDS = (
    "appointmentTypeId",
    "code",
    "name",
    "serviceLine",
    "durationUnits",
    "bufferUnits",
    "bookableBy",
    "patientRequestable",
    "minNoticeMinutes",
    "maxAdvanceDays",
    "cancellationWindowMinutes",
    "feeBandId",
    "clinicIds",
    "active",
)
BAND_FIELDS = ("feeBandId", "practice", "baseAmountMinor", "scheduleReference", "effectiveFrom")

_settings: Settings | None = None


def settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings(Repository())
    return _settings


def pick(item: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: item.get(name) for name in fields}


def long_date(instant: str) -> str:
    """19 September 2026, as the screens write a date."""
    day = dt.date.fromisoformat(instant[:10])
    return f"{day.day} {day:%B %Y}"


def tenant_view(tenant: dict[str, Any], pack: dict[str, Any]) -> dict[str, Any]:
    shown = {**DEFAULTS, **{k: v for k, v in pick(tenant, TENANT_FIELDS).items() if v is not None}}
    shown.setdefault("languages", list(pack.get("languages") or []))
    locked = tenant.get("firstAppointmentAt")
    return {
        **shown,
        "firstAppointmentAt": locked,
        # FR-TEN-07: the screen shows the lock and why.
        "regionPackLocked": bool(locked),
        "lockReason": (
            f"Locked since the first appointment on {long_date(str(locked))}. Bookings were"
            " made against this pack's currency, phone rules and clock."
            if locked
            else None
        ),
    }


def pack_view(pack: dict[str, Any]) -> dict[str, Any]:
    return {
        name: pack.get(name)
        for name in (
            "code",
            "currency",
            "dialCode",
            "languages",
            "timezone",
            "administrativeRegions",
            "publicHolidays",
            "emergencyNumber",
            "smsSenderIdPolicy",
            "allowsRatingFeeLink",
        )
    }


def overview(principal: Principal) -> dict[str, Any]:
    permissions.require(principal, "clinic.manage", Subject(tenant_id=principal.tenant_id))
    store = settings()
    tenant = store.tenant(principal.tenant_id)
    pack = store.region_pack(str(tenant["regionPackCode"]))
    catalogue = Catalogue(store.repository)
    return {
        "tenant": tenant_view(tenant, pack),
        "regionPack": pack_view(pack),
        "regionPacks": [
            {"code": code, "currency": p["currency"]} for code, p in REGION_PACKS.items()
        ],
        "clinics": [pick(c, CLINIC_FIELDS) for c in catalogue.clinics(principal.tenant_id)],
        "appointmentTypes": [
            pick(t, TYPE_FIELDS) for t in store.appointment_types(principal.tenant_id)
        ],
        "feeBands": [pick(b, BAND_FIELDS) for b in store.fee_bands(principal.tenant_id)],
    }


def change_tenant(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    body = requests.json_body(event)
    subject = Subject(tenant_id=principal.tenant_id)
    for name in body:
        permissions.require(principal, SETTING_PERMISSION.get(name, "clinic.manage"), subject)
    store = settings()
    tenant = store.tenant(principal.tenant_id)
    pack = store.region_pack(str(tenant["regionPackCode"]))
    changes = rules.tenant_changes(body, tenant=tenant, pack=pack, packs=REGION_PACKS)
    updated = store.update_tenant(principal.tenant_id, changes)
    return tenant_view(updated, store.region_pack(str(updated["regionPackCode"])))


def change_clinic(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    clinic_id = requests.path_parameter(event, "id")
    permissions.require(
        principal, "clinic.manage", Subject(tenant_id=principal.tenant_id, clinic_id=clinic_id)
    )
    store = settings()
    store.clinic(principal.tenant_id, clinic_id)
    minutes = int(store.tenant(principal.tenant_id).get("gridUnitMinutes") or 10)
    changes = rules.clinic_changes(requests.json_body(event), minutes=minutes)
    return {**pick(store.update_clinic(principal.tenant_id, clinic_id, changes), CLINIC_FIELDS)}


def _type_context(principal: Principal) -> tuple[set[str], set[str]]:
    store = settings()
    bands = {str(b["feeBandId"]) for b in store.fee_bands(principal.tenant_id)}
    clinics = {str(c["clinicId"]) for c in Catalogue(store.repository).clinics(principal.tenant_id)}
    return bands, clinics


def create_type(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    permissions.require(
        principal, "appointment_type.manage", Subject(tenant_id=principal.tenant_id)
    )
    bands, clinics = _type_context(principal)
    fields = rules.appointment_type_fields(
        requests.json_body(event), current=None, fee_bands=bands, clinics=clinics
    )
    return pick(settings().create_appointment_type(principal.tenant_id, fields), TYPE_FIELDS)


def change_type(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    permissions.require(
        principal, "appointment_type.manage", Subject(tenant_id=principal.tenant_id)
    )
    type_id = requests.path_parameter(event, "id")
    store = settings()
    current = store.appointment_type(principal.tenant_id, type_id)
    bands, clinics = _type_context(principal)
    fields = rules.appointment_type_fields(
        requests.json_body(event),
        current=pick(current, TYPE_FIELDS),
        fee_bands=bands,
        clinics=clinics,
    )
    return pick(store.update_appointment_type(principal.tenant_id, type_id, fields), TYPE_FIELDS)


def set_band(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    permissions.require(principal, "fee_band.manage", Subject(tenant_id=principal.tenant_id))
    band_id = requests.path_parameter(event, "id")
    store = settings()
    if not store.fee_band_history(principal.tenant_id, band_id):
        # New bands arrive with the tenant's schedule; this changes the amounts.
        raise NotFound("no such fee band")
    fields = rules.fee_band_fields(requests.json_body(event))
    return pick(store.set_fee_band(principal.tenant_id, band_id, fields), BAND_FIELDS)


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """The routes in the module note."""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    if resource.endswith("/admin/settings"):
        if method == "GET":
            return responses.ok(overview(principal))
        if method == "PATCH":
            return responses.ok(change_tenant(principal, event))
    if method == "PATCH" and resource.endswith("/admin/clinics/{id}"):
        return responses.ok(change_clinic(principal, event))
    if method == "POST" and resource.endswith("/admin/appointment-types"):
        return responses.created(create_type(principal, event))
    if method == "PATCH" and resource.endswith("/admin/appointment-types/{id}"):
        return responses.ok(change_type(principal, event))
    if method == "PUT" and resource.endswith("/admin/fee-bands/{id}"):
        return responses.ok(set_band(principal, event))
    raise AtriaError(f"no handler for {method} {resource}")
