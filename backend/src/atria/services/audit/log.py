"""Reading the audit trail back (FR-ADM-04, FR-ADM-05).

    GET /audit?from=&to=&actor=&action=&kind=         a page of entries, newest first
    GET /audit/export?from=&to=&actor=&action=&kind=  the same entries as a CSV file

audit.read decides who reaches it: a tenant administrator reads the tenant's
entries, a unit manager their unit's, and nobody else any. Dates are UTC days,
a week back by default and a month at most.

A listed entry says how many patients it touched, not who they were: the
console shows aggregates by default (FR-ADM-05). The export names each
patient profile, and is itself recorded (http.audit), so finding out who
looked at a record leaves a record too.

Nothing here writes, edits or deletes an entry.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from typing import Any

from atria.core import permissions, schedule
from atria.core.errors import AtriaError, Invalid
from atria.core.principal import Principal
from atria.data import keys
from atria.data.audit import MAX_DAYS, READ, WRITE, AuditLog
from atria.data.repository import Item, Repository
from atria.http import audit as recorder
from atria.http import paging, requests, responses
from atria.http.handler import api

DEFAULT_DAYS = 7

# One file, not a paging protocol. A month of a hospital's entries fits.
MAX_EXPORT = 10_000

EXPORT_COLUMNS = (
    "occurredAt",
    "actor",
    "actorRole",
    "action",
    "kind",
    "subjectType",
    "subjectId",
    "clinicId",
    "patientProfileIds",
    "reason",
    "flags",
    "ip",
    "userAgent",
    "requestId",
    "auditEntryId",
)


def log() -> AuditLog:
    return recorder.audit_log()


def date_range(event: dict[str, Any], *, today: dt.date) -> tuple[dt.date, dt.date]:
    raw_from = requests.query_parameter(event, "from")
    raw_to = requests.query_parameter(event, "to")
    last = schedule.parse_date(raw_to, name="to") if raw_to else today
    first = (
        schedule.parse_date(raw_from, name="from")
        if raw_from
        else last - dt.timedelta(days=DEFAULT_DAYS - 1)
    )
    if last < first:
        raise Invalid("to is before from")
    if (last - first).days + 1 > MAX_DAYS:
        raise Invalid("that range is wider than the log reads", detail={"maximumDays": MAX_DAYS})
    return first, last


def in_scope(principal: Principal, entries: list[Item]) -> list[Item]:
    """The entries the caller's audit.read scope reaches."""
    scope = permissions.require(principal, "audit.read")
    if scope == "tenant":
        return entries
    if scope == "clinic" and principal.clinic_id:
        return [e for e in entries if e.get("clinicId") == principal.clinic_id]
    return []


def matches(entry: Item, *, actor: str | None, action: str | None, kind: str | None = None) -> bool:
    if kind and entry.get("kind") != kind:
        return False
    if actor and actor not in (entry.get("actorPersonId"), entry.get("actorStaffId")):
        return False
    if action:
        name = str(entry.get("action") or "")
        # "appointment" asks for every appointment action.
        return name == action or name.startswith(f"{action}.")
    return True


def names(repository: Repository, person_ids: set[str]) -> dict[str, str]:
    found = repository.get_many([keys.person(p) for p in sorted(person_ids)])
    named: dict[str, str] = {}
    for person_id in person_ids:
        key = keys.person(person_id)
        person = found.get((key.pk, key.sk), {})
        full = " ".join(str(person.get(part) or "") for part in ("givenName", "familyName")).strip()
        named[person_id] = full or "Unknown account"
    return named


def selected(principal: Principal, event: dict[str, Any]) -> tuple[dict[str, Any], list[Item]]:
    """The range asked for, and the entries in it the caller may read and asked for."""
    permissions.require(principal, "audit.read")
    store = log()
    first, last = date_range(event, today=store.now().date())
    reachable = in_scope(principal, store.entries(principal.tenant_id, first, last))
    actor = requests.query_parameter(event, "actor") or None
    action = requests.query_parameter(event, "action") or None
    kind = (requests.query_parameter(event, "kind") or "").upper() or None
    if kind not in (None, READ, WRITE):
        raise Invalid("unknown value for kind", detail={"allowed": [READ, WRITE]})
    chosen = [e for e in reachable if matches(e, actor=actor, action=action, kind=kind)]
    return {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "reachable": reachable,
    }, chosen


def entry_view(entry: Item, named: dict[str, str]) -> dict[str, Any]:
    actor = str(entry.get("actorPersonId") or "")
    return {
        "auditEntryId": entry.get("auditEntryId"),
        "occurredAt": entry.get("occurredAt"),
        "actorPersonId": actor,
        "actorName": named.get(actor, "Unknown account"),
        "actorRole": entry.get("actorRole"),
        "action": entry.get("action"),
        "kind": entry.get("kind"),
        "subjectType": entry.get("subjectType"),
        "subjectId": entry.get("subjectId"),
        "clinicId": entry.get("clinicId"),
        "patientCount": len(entry.get("patientProfileIds") or []),
        "reason": entry.get("reason"),
        "flags": list(entry.get("flags") or []),
        "source": {"ip": (entry.get("source") or {}).get("ip", "")},
    }


def listing(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    window, chosen = selected(principal, event)
    reachable = window.pop("reachable")
    shown, more = paging.page(chosen, event)
    named = names(
        log().repository,
        {str(e["actorPersonId"]) for e in reachable if e.get("actorPersonId")},
    )
    # Everyone and everything in the range, for the filters: choosing an actor
    # should not make the other actors disappear from the menu.
    actors = sorted(
        {
            str(e["actorPersonId"]): {
                "personId": str(e["actorPersonId"]),
                "name": named.get(str(e["actorPersonId"]), "Unknown account"),
                "role": e.get("actorRole"),
            }
            for e in reachable
            if e.get("actorPersonId")
        }.values(),
        key=lambda a: str(a["name"]),
    )
    return {
        **window,
        **more,
        "entries": [entry_view(e, named) for e in shown],
        "actors": actors,
        "actions": sorted({str(e.get("action")) for e in reachable if e.get("action")}),
    }


def export(principal: Principal, event: dict[str, Any]) -> dict[str, Any]:
    window, chosen = selected(principal, event)
    if len(chosen) > MAX_EXPORT:
        raise Invalid(
            "that is more than one file holds; narrow the dates or the filters",
            detail={"maximumRows": MAX_EXPORT, "rows": len(chosen)},
        )
    named = names(
        log().repository, {str(e["actorPersonId"]) for e in chosen if e.get("actorPersonId")}
    )
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(EXPORT_COLUMNS)
    for e in chosen:
        source = e.get("source") or {}
        writer.writerow(
            [
                e.get("occurredAt"),
                named.get(str(e.get("actorPersonId") or ""), "Unknown account"),
                e.get("actorRole") or "",
                e.get("action"),
                e.get("kind"),
                e.get("subjectType"),
                e.get("subjectId"),
                e.get("clinicId") or "",
                " ".join(e.get("patientProfileIds") or []),
                e.get("reason") or "",
                " ".join(e.get("flags") or []),
                source.get("ip", ""),
                source.get("userAgent", ""),
                source.get("requestId", ""),
                e.get("auditEntryId"),
            ]
        )
    name = f"atria-audit-{window['from']}-to-{window['to']}.csv"
    csv_response = responses.response(
        200, None, headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )
    csv_response["headers"]["Content-Type"] = "text/csv; charset=utf-8"
    csv_response["body"] = out.getvalue()
    return csv_response


@api
def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """GET /audit and GET /audit/export."""
    principal = requests.principal_from(event)
    method = str(event.get("httpMethod", "")).upper()
    resource = str(event.get("resource", ""))
    if method == "GET" and resource.endswith("/audit/export"):
        return export(principal, event)
    if method == "GET" and resource.endswith("/audit"):
        return responses.ok(listing(principal, event))
    raise AtriaError(f"no handler for {method} {resource}")
