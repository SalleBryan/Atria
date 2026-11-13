"""What a tenant administrator may set, and the limits on each.

FR-ADM-03, FR-ADM-06, FR-TEN-02 to FR-TEN-07.

Pure rules: each function takes the request body and what it depends on, and
returns the fields to store or raises Invalid naming the field. Nothing here
reads or writes the table.

Two settings lock once the tenant has taken its first appointment:

    the region pack (FR-TEN-07), because currency, phone rules and the clock
    every booking was made against come from it; and
    the grid unit, because every held slot is a set of grid units, and a new
    unit would leave those locks describing times that no longer exist.

Both refusals say why, so the settings screen can show it.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from atria.core import queue, schedule
from atria.core.errors import Invalid

GRID_UNITS = (5, 10, 15, 20, 30)
SERVICE_LINES = ("GENERAL", "SPECIALIST", "PROCEDURE")
BOOKABLE_BY = ("PATIENT", "STAFF", "BOTH")
GUARDIAN_CONSENT = ("DESK_OR_GUARDIAN_ACCOUNT",)

# An alphanumeric SMS sender ID: GSM allows 11 characters, letters first.
SENDER_ID = re.compile(r"^[A-Za-z][A-Za-z0-9]{2,10}$")
PHONE = re.compile(r"^\+[1-9]\d{7,14}$")

LOCKED_BY_FIRST_APPOINTMENT = (
    "locked since the first appointment on {when}: bookings were made against it"
)


def _text(body: dict[str, Any], name: str, *, limit: int, required: bool = False) -> str | None:
    value = body.get(name)
    if value is None:
        if required:
            raise Invalid(f"{name} is required")
        return None
    if not isinstance(value, str):
        raise Invalid(f"{name} must be text")
    value = value.strip()
    if required and not value:
        raise Invalid(f"{name} cannot be empty")
    if len(value) > limit:
        raise Invalid(f"{name} is longer than {limit} characters")
    return value


def _whole(body: dict[str, Any], name: str, *, low: int, high: int) -> int:
    value = body.get(name)
    # A value read back from the table arrives as a Decimal.
    if isinstance(value, Decimal) and value == value.to_integral_value():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int):
        raise Invalid(f"{name} must be a whole number")
    if not low <= value <= high:
        raise Invalid(f"{name} must be from {low} to {high}", detail={name: value})
    return value


def _flag(body: dict[str, Any], name: str) -> bool:
    value = body.get(name)
    if not isinstance(value, bool):
        raise Invalid(f"{name} must be true or false")
    return value


def tenant_changes(
    body: dict[str, Any], *, tenant: dict[str, Any], pack: dict[str, Any], packs: dict[str, Any]
) -> dict[str, Any]:
    """The tenant fields a PATCH /admin/settings sets, checked."""
    known = {
        "name",
        "regionPackCode",
        "gridUnitMinutes",
        "languages",
        "reminderLeadHours",
        "secondReminderHours",
        "queueMoveThresholdMinutes",
        "queueHoldMinutes",
        "queueLateGraceMinutes",
        "queueMaxBypass",
        "queueInviteLeadMinutes",
        "queueInviteFanout",
        "queueInviteOpenMinutes",
        "queueEarlyCallInvites",
        "noShowStrikeThreshold",
        "noShowStrikeWindowDays",
        "qualityProgrammeEnabled",
        "ratingAffectsFee",
        "guardianConsent",
        "smsSenderId",
        "emailSenderName",
    }
    unknown = sorted(set(body) - known)
    if unknown:
        raise Invalid("those settings do not exist", detail={"unknown": unknown})
    if not body:
        raise Invalid("nothing to change")

    locked_at = tenant.get("firstAppointmentAt")
    out: dict[str, Any] = {}

    if "name" in body:
        out["name"] = _text(body, "name", limit=120, required=True)

    if "regionPackCode" in body:
        code = body["regionPackCode"]
        if code != tenant.get("regionPackCode"):
            if locked_at:
                raise Invalid(
                    "the region pack is " + LOCKED_BY_FIRST_APPOINTMENT.format(when=locked_at),
                    detail={"locked": True, "since": locked_at},
                )
            if code not in packs:
                raise Invalid("there is no such region pack", detail={"available": sorted(packs)})
            out["regionPackCode"] = code
            pack = packs[code]

    if "gridUnitMinutes" in body:
        minutes = body["gridUnitMinutes"]
        if minutes not in GRID_UNITS:
            raise Invalid(
                "the grid unit must be one of these", detail={"allowed": list(GRID_UNITS)}
            )
        if minutes != tenant.get("gridUnitMinutes") and locked_at:
            raise Invalid(
                "the grid unit is " + LOCKED_BY_FIRST_APPOINTMENT.format(when=locked_at),
                detail={"locked": True, "since": locked_at},
            )
        out["gridUnitMinutes"] = minutes

    if "languages" in body:
        languages = body["languages"]
        offered = list(pack.get("languages") or [])
        if (
            not isinstance(languages, list)
            or not languages
            or any(language not in offered for language in languages)
        ):
            raise Invalid(
                "languages must be one or more of the region pack's", detail={"allowed": offered}
            )
        out["languages"] = list(dict.fromkeys(languages))

    if "reminderLeadHours" in body:
        out["reminderLeadHours"] = _whole(body, "reminderLeadHours", low=1, high=72)
    if "secondReminderHours" in body:
        second = _whole(body, "secondReminderHours", low=0, high=12)
        lead = out.get("reminderLeadHours", tenant.get("reminderLeadHours") or 24)
        if second and second >= int(lead):
            raise Invalid("the second reminder must come after the first")
        out["secondReminderHours"] = second
    if "queueMoveThresholdMinutes" in body:
        out["queueMoveThresholdMinutes"] = _whole(
            body, "queueMoveThresholdMinutes", low=10, high=120
        )

    # The unit-wide queue rules a unit or a session may override (ADR 0022).
    for name, field in queue.TENANT_POLICY_FIELDS.items():
        if field in body:
            low, high = queue.POLICY_LIMITS[name]
            out[field] = _whole(body, field, low=low, high=high)
    for name, field in queue.TENANT_CHOICE_FIELDS.items():
        if field in body:
            if body[field] not in queue.POLICY_CHOICES[name]:
                raise Invalid(f"{field} must be one of {', '.join(queue.POLICY_CHOICES[name])}")
            out[field] = body[field]

    if "noShowStrikeThreshold" in body:
        threshold = _whole(body, "noShowStrikeThreshold", low=0, high=10)
        if threshold == 1:
            # One missed visit is a bad day, not a pattern (D-07).
            raise Invalid(
                "a threshold of 1 would restrict after a single missed visit;"
                " use 2 or more, or 0 for off"
            )
        out["noShowStrikeThreshold"] = threshold
    if "noShowStrikeWindowDays" in body:
        out["noShowStrikeWindowDays"] = _whole(body, "noShowStrikeWindowDays", low=30, high=365)

    if "qualityProgrammeEnabled" in body:
        out["qualityProgrammeEnabled"] = _flag(body, "qualityProgrammeEnabled")
    if "ratingAffectsFee" in body:
        linked = _flag(body, "ratingAffectsFee")
        if linked and not pack.get("allowsRatingFeeLink"):
            # Guard REGION_REFUSES_FEE_LINK (D-11).
            raise Invalid(
                "the region pack does not allow a rating to change a fee",
                detail={"regionPackCode": pack.get("code")},
            )
        out["ratingAffectsFee"] = linked

    if "guardianConsent" in body:
        if body["guardianConsent"] not in GUARDIAN_CONSENT:
            raise Invalid(
                "unknown guardian consent rule", detail={"allowed": list(GUARDIAN_CONSENT)}
            )
        out["guardianConsent"] = body["guardianConsent"]

    if "smsSenderId" in body:
        sender = _text(body, "smsSenderId", limit=11, required=True) or ""
        if not SENDER_ID.match(sender):
            raise Invalid("an SMS sender ID is 3 to 11 letters and digits, starting with a letter")
        out["smsSenderId"] = sender
    if "emailSenderName" in body:
        out["emailSenderName"] = _text(body, "emailSenderName", limit=60, required=True)

    return out


def clinic_changes(body: dict[str, Any], *, minutes: int) -> dict[str, Any]:
    """The unit fields a PATCH /admin/clinics/{id} sets, checked."""
    known = {"name", "address", "phone", "description", "services", "openingHours", "location"}
    unknown = sorted(set(body) - known)
    if unknown:
        raise Invalid("those unit fields do not exist", detail={"unknown": unknown})
    if not body:
        raise Invalid("nothing to change")
    out: dict[str, Any] = {}
    if "name" in body:
        out["name"] = _text(body, "name", limit=80, required=True)
    if "address" in body:
        out["address"] = _text(body, "address", limit=160, required=True)
    if "phone" in body:
        phone = _text(body, "phone", limit=16, required=True) or ""
        if not PHONE.match(phone):
            raise Invalid("the unit's phone must be an international number, such as +237...")
        out["phone"] = phone
    if "description" in body:
        out["description"] = _text(body, "description", limit=300) or ""
    if "services" in body:
        services = body["services"]
        if not isinstance(services, list) or len(services) > 12:
            raise Invalid("services is a list of at most 12")
        cleaned = []
        for service in services:
            if not isinstance(service, str) or not service.strip() or len(service) > 60:
                raise Invalid("each service is a name of at most 60 characters")
            cleaned.append(service.strip())
        out["services"] = list(dict.fromkeys(cleaned))
    if "openingHours" in body:
        hours = schedule.validate_hours({"days": body["openingHours"]}, minutes=minutes)
        if not hours:
            raise Invalid("a unit must open on at least one day")
        out["openingHours"] = {
            str(day): {"start": start, "end": end} for day, (start, end) in sorted(hours.items())
        }
    if "location" in body:
        out["location"] = unit_location(body["location"])
    return out


def unit_location(raw: Any) -> dict[str, Any] | None:
    """Where a unit is inside its hospital, so directions reach the unit and not the gate.

    The building, the floor and a line of walking directions are read by
    people; the entrance's latitude and longitude place the unit on the
    hospital map and are where a maps app routes to. Null clears it.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise Invalid("location is an object: building, floor, directions, lat, lng")
    unknown = sorted(set(raw) - {"building", "floor", "directions", "lat", "lng"})
    if unknown:
        raise Invalid("those location fields do not exist", detail={"unknown": unknown})
    out: dict[str, Any] = {}
    for field, limit in (("building", 60), ("floor", 30), ("directions", 300)):
        if raw.get(field) not in (None, ""):
            out[field] = _text(raw, field, limit=limit) or ""
    has_lat, has_lng = raw.get("lat") is not None, raw.get("lng") is not None
    if has_lat != has_lng:
        raise Invalid("an entrance needs both lat and lng")
    if has_lat:
        try:
            lat, lng = float(raw["lat"]), float(raw["lng"])
        except (TypeError, ValueError) as exc:
            raise Invalid("lat and lng are numbers") from exc
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise Invalid("that entrance is not on the map")
        out["lat"], out["lng"] = str(round(lat, 6)), str(round(lng, 6))
    return out or None


def appointment_type_fields(
    body: dict[str, Any],
    *,
    current: dict[str, Any] | None,
    fee_bands: set[str],
    clinics: set[str],
    intake_forms: set[str] | None = None,
) -> dict[str, Any]:
    """A whole appointment type after a create or change, checked as one (FR-ADM-06).

    Checked as a whole rather than field by field, because the rules tie the
    fields together: a general consultation is queued and has no duration, a
    procedure is booked by staff only.
    """
    known = {
        "name",
        "code",
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
        "intakeFormId",
    }
    unknown = sorted(set(body) - known)
    if unknown:
        raise Invalid("those fields do not exist", detail={"unknown": unknown})
    merged = {**(current or {}), **body}
    out: dict[str, Any] = {}

    out["name"] = _text(merged, "name", limit=80, required=True)
    code = merged.get("code") or re.sub(r"[^A-Z0-9]+", "_", str(out["name"]).upper()).strip("_")
    out["code"] = str(code)[:32]

    line = merged.get("serviceLine")
    if line not in SERVICE_LINES:
        raise Invalid("serviceLine must be one of these", detail={"allowed": list(SERVICE_LINES)})
    if current and current.get("serviceLine") != line:
        raise Invalid("a type keeps its service line; retire it and create another")
    out["serviceLine"] = line

    if line == "GENERAL":
        # Queued, not held: the session's throughput decides the time (D-01).
        if merged.get("durationUnits") not in (None, 0):
            raise Invalid("a general consultation is queued and has no duration")
        out["durationUnits"] = None
        out["bufferUnits"] = 0
    else:
        out["durationUnits"] = _whole(merged, "durationUnits", low=1, high=48)
        out["bufferUnits"] = _whole(merged, "bufferUnits", low=0, high=12)

    bookable = merged.get("bookableBy", "BOTH")
    if bookable not in BOOKABLE_BY:
        raise Invalid("bookableBy must be one of these", detail={"allowed": list(BOOKABLE_BY)})
    if line == "PROCEDURE" and bookable != "STAFF":
        # A procedure is sized and placed by staff (D-05).
        raise Invalid("a procedure is booked by staff; a patient requests one instead")
    out["bookableBy"] = bookable

    requestable = bool(merged.get("patientRequestable", False))
    if requestable and line != "PROCEDURE":
        raise Invalid("only a procedure can be requested")
    out["patientRequestable"] = requestable

    out["minNoticeMinutes"] = _whole(
        {"v": merged.get("minNoticeMinutes", 30)}, "v", low=0, high=10080
    )
    out["maxAdvanceDays"] = _whole({"v": merged.get("maxAdvanceDays", 60)}, "v", low=1, high=365)
    out["cancellationWindowMinutes"] = _whole(
        {"v": merged.get("cancellationWindowMinutes", 1440)}, "v", low=0, high=10080
    )

    band = merged.get("feeBandId")
    if band not in fee_bands:
        raise Invalid(
            "feeBandId must be one of the tenant's fee bands", detail={"allowed": sorted(fee_bands)}
        )
    out["feeBandId"] = band

    offered = merged.get("clinicIds")
    if offered in (None, []):
        out["clinicIds"] = None
    else:
        if not isinstance(offered, list) or any(c not in clinics for c in offered):
            raise Invalid(
                "clinicIds must name the tenant's units", detail={"units": sorted(clinics)}
            )
        out["clinicIds"] = list(dict.fromkeys(offered))

    # The questions asked at booking (FR-BKG-15): one of the tenant's forms, or none.
    form = merged.get("intakeFormId") or None
    if form is not None and form not in (intake_forms or set()):
        raise Invalid(
            "intakeFormId must be one of the tenant's intake forms",
            detail={"allowed": sorted(intake_forms or set())},
        )
    out["intakeFormId"] = form

    out["active"] = bool(merged.get("active", True))
    return out


def fee_band_fields(body: dict[str, Any]) -> dict[str, Any]:
    """A fee band's new amount (FR-ADM-06, D-11). Each change is a new dated version."""
    unknown = sorted(set(body) - {"practice", "baseAmountMinor", "scheduleReference"})
    if unknown:
        raise Invalid("those fields do not exist", detail={"unknown": unknown})
    return {
        "practice": _text(body, "practice", limit=60, required=True),
        # XAF has no minor unit, so the amount is whole francs.
        "baseAmountMinor": _whole(body, "baseAmountMinor", low=0, high=10_000_000),
        "scheduleReference": _text(body, "scheduleReference", limit=160) or "",
    }


def offered_at(appointment_type: dict[str, Any], clinic_id: str) -> bool:
    """Whether a type can be booked at a unit: listed there, or at every unit."""
    offered = appointment_type.get("clinicIds")
    return not offered or clinic_id in offered
