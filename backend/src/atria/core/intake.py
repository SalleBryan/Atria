"""Intake forms and the answers a patient gives to them (FR-BKG-15, AD-06).

An appointment type may carry an intake form: the questions asked when it is
booked. What the patient answers is care context. It is kept apart from the
appointment, in its own table on its own key, read only by the patient and the
assigned clinician (FR-PRV-10), and gone after the visit's review window.

A form is a list of fields. Each has an id, a kind, the question as the
patient reads it, and whether it is needed. A form is versioned: changing it
publishes a new version, and answers keep the version they were given against,
so a clinician always reads an answer beside the question that was asked.

Nothing here is a diagnosis. The rules are only about shape: that a needed
answer is there, that a choice is one of the options, that text is not too
long and that a number is in range.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from atria.core.errors import Invalid

KINDS = ("text", "longText", "choice", "yesNo", "number")

MAX_FIELDS = 20
MAX_LABEL = 160
MAX_HINT = 200
MAX_OPTIONS = 12
TEXT_LIMIT = 160
LONG_TEXT_LIMIT = 1000

# How long answers are kept after the visit: the review window (SRS retention
# table, "purged after the visit's review window, default 90 days").
REVIEW_DAYS = 90

_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")


def _text(value: object, *, name: str, limit: int, required: bool) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise Invalid(f"{name} is needed")
        return None
    if not isinstance(value, str):
        raise Invalid(f"{name} must be text")
    text = value.strip()
    if len(text) > limit:
        raise Invalid(f"{name} is at most {limit} characters")
    return text


def form_fields(body: dict[str, Any]) -> dict[str, Any]:
    """A whole form after a create or change, checked as one (FR-ADM-06)."""
    unknown = sorted(set(body) - {"name", "fields"})
    if unknown:
        raise Invalid("those fields do not exist", detail={"unknown": unknown})
    name = _text(body.get("name"), name="name", limit=80, required=True)
    raw = body.get("fields")
    if not isinstance(raw, list) or not raw:
        raise Invalid("a form asks at least one question")
    if len(raw) > MAX_FIELDS:
        raise Invalid(f"a form asks at most {MAX_FIELDS} questions")
    fields: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise Invalid("each question is an object", detail={"at": index})
        field_id = str(item.get("id") or "").strip()
        if not _ID.match(field_id):
            raise Invalid("each question needs an id of letters and digits", detail={"at": index})
        if field_id in seen:
            raise Invalid("two questions share an id", detail={"id": field_id})
        seen.add(field_id)
        kind = item.get("kind")
        if kind not in KINDS:
            raise Invalid("kind must be one of these", detail={"allowed": list(KINDS), "at": index})
        field: dict[str, Any] = {
            "id": field_id,
            "kind": kind,
            "label": _text(item.get("label"), name="label", limit=MAX_LABEL, required=True),
            "required": bool(item.get("required", False)),
        }
        hint = _text(item.get("hint"), name="hint", limit=MAX_HINT, required=False)
        if hint:
            field["hint"] = hint
        if kind == "choice":
            options = item.get("options")
            if not isinstance(options, list) or len(options) < 2:
                raise Invalid("a choice has at least two options", detail={"id": field_id})
            if len(options) > MAX_OPTIONS:
                raise Invalid(
                    f"a choice has at most {MAX_OPTIONS} options", detail={"id": field_id}
                )
            cleaned = []
            ids: set[str] = set()
            for option in options:
                if not isinstance(option, dict):
                    raise Invalid("each option is an object", detail={"id": field_id})
                option_id = str(option.get("id") or "").strip()
                if not _ID.match(option_id) or option_id in ids:
                    raise Invalid("each option needs its own id", detail={"id": field_id})
                ids.add(option_id)
                cleaned.append(
                    {
                        "id": option_id,
                        "label": _text(option.get("label"), name="option", limit=80, required=True),
                    }
                )
            field["options"] = cleaned
        if kind in ("text", "longText"):
            ceiling = TEXT_LIMIT if kind == "text" else LONG_TEXT_LIMIT
            limit = item.get("max", ceiling)
            if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= ceiling:
                raise Invalid(f"max is a whole number up to {ceiling}", detail={"id": field_id})
            field["max"] = limit
        if kind == "number":
            low, high = item.get("min", 0), item.get("max", 999)
            if (
                not all(isinstance(v, int) and not isinstance(v, bool) for v in (low, high))
                or low > high
            ):
                raise Invalid("min and max are whole numbers, min first", detail={"id": field_id})
            field["min"], field["max"] = low, high
        fields.append(field)
    return {"name": name, "fields": fields}


def answers(form: dict[str, Any], given: object) -> dict[str, Any]:
    """The patient's answers, checked against the form they were asked on.

    An answer left empty is left out. A question that is needed must be
    answered; any other can be skipped. An answer to a question the form does
    not ask is refused rather than stored, so nothing but what was asked is
    ever kept.
    """
    if not isinstance(given, dict):
        raise Invalid("answers is an object of question ids")
    fields = {str(f["id"]): f for f in form.get("fields", [])}
    unknown = sorted(set(given) - set(fields))
    if unknown:
        raise Invalid("those questions are not on the form", detail={"unknown": unknown})
    out: dict[str, Any] = {}
    for field_id, field in fields.items():
        value = given.get(field_id)
        label = str(field.get("label") or field_id)
        empty = value is None or (isinstance(value, str) and not value.strip())
        if empty:
            if field.get("required"):
                raise Invalid(f"please answer: {label}", detail={"field": field_id})
            continue
        kind = field.get("kind")
        if kind in ("text", "longText"):
            limit = int(field.get("max") or (TEXT_LIMIT if kind == "text" else LONG_TEXT_LIMIT))
            out[field_id] = _text(value, name=label, limit=limit, required=True)
        elif kind == "choice":
            allowed = [str(o["id"]) for o in field.get("options", [])]
            if value not in allowed:
                raise Invalid(f"choose one of the options for: {label}", detail={"field": field_id})
            out[field_id] = value
        elif kind == "yesNo":
            if not isinstance(value, bool):
                raise Invalid(f"answer yes or no to: {label}", detail={"field": field_id})
            out[field_id] = value
        elif kind == "number":
            if isinstance(value, bool) or not isinstance(value, int | float):
                raise Invalid(f"answer with a number: {label}", detail={"field": field_id})
            low, high = field.get("min", 0), field.get("max", 999)
            if not low <= value <= high:
                raise Invalid(
                    f"the answer to '{label}' is between {low} and {high}",
                    detail={"field": field_id},
                )
            out[field_id] = int(value) if float(value).is_integer() else value
    return out


def purge_after(end_at: dt.datetime, *, days: int = REVIEW_DAYS) -> int:
    """When the answers go, as the epoch seconds the table's TTL reads."""
    return int((end_at + dt.timedelta(days=days)).timestamp())
