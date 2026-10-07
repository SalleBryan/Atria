"""The weekly report's arithmetic (FR-MSR-01, FR-MSR-02, FR-MSR-04).

Pure: given a week's appointments, the reminder outcome of each and their fee
ledger entries, count what happened. Nothing here reads the table.

Counted per week, from the first day of use:

    booked          every visit that week, whatever became of it
    attended        seen: completed, with or without feedback
    noShow          recorded as not having come
    cancelled       cancelled in the free window, or by the clinic
    lateCancelled   cancelled by the patient after the free window
    open            not closed yet: still ahead, or in progress

and attendance broken down by booking channel, by who made the booking (the
patient, or which staff role on their behalf, 2026-10-07: kept apart from the
channel, which is how the patient reached the unit), and by whether the
reminder was sent, failed, or never sent. Attendance is attended out of those who either
came or did not; a visit still open or cancelled says nothing about it.

The ledger totals are records of entitlement, not money (FR-MSR-07). And no
figure here claims what reminders saved in currency (FR-MSR-04): the report
shows attendance beside reminder outcome and leaves the reading to people.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

ATTENDED = ("COMPLETED", "AWAITING_FEEDBACK")
NO_SHOW = ("NO_SHOW",)
LATE = ("CANCELLED_LATE",)
CANCELLED_OUTCOMES = ("CANCELLED_IN_WINDOW", "CLINIC_CANCELLED")
NOT_COUNTED = ("REQUESTED", "DECLINED")

CHANNELS = ("ONLINE", "WALK_IN", "PHONE", "REFERRAL")
# Who made the booking: the patient themselves, or staff in one of these roles.
BOOKED_BY = ("PATIENT", "RECEPTIONIST", "CLINICIAN", "CLINIC_MANAGER", "TENANT_ADMIN")
# What became of a visit's reminder. SENT is as far as Phase 1's provider
# reports; DELIVERED arrives with delivery receipts (wave 9).
REMINDER = ("SENT", "FAILED", "NOT_SENT")


def status_of(appointment: dict[str, Any]) -> str:
    state = str(appointment.get("state") or "")
    outcome = str(appointment.get("outcome") or "")
    if state in ATTENDED:
        return "attended"
    if state in NO_SHOW:
        return "noShow"
    if outcome in LATE:
        return "lateCancelled"
    if state.endswith("CANCELLED"):
        return "cancelled"
    return "open"


def attendance(counts: Counter[str]) -> float | None:
    decided = counts["attended"] + counts["noShow"]
    return round(counts["attended"] / decided, 3) if decided else None


def reminder_of(state: str | None) -> str:
    if state in ("SENT", "DELIVERED"):
        return "SENT"
    if state == "FAILED":
        return "FAILED"
    return "NOT_SENT"


def booked_by_of(appointment: dict[str, Any]) -> str:
    """The role that made the booking; a booking with none was the patient's own."""
    role = str(appointment.get("bookedByRole") or "PATIENT")
    return role if role in BOOKED_BY else "PATIENT"


def group(
    counted: list[dict[str, Any]], name: str, values: tuple[str, ...], key: Any
) -> list[dict[str, Any]]:
    """Attendance for each value of `key`, in the order given, leaving out the empty ones."""
    rows = []
    for value in values:
        these = [a for a in counted if key(a) == value]
        if not these:
            continue
        counts: Counter[str] = Counter(status_of(a) for a in these)
        rows.append(
            {
                name: value,
                "booked": len(these),
                "attended": counts["attended"],
                "noShow": counts["noShow"],
                "attendance": attendance(counts),
            }
        )
    return rows


def week_figures(
    appointments: list[dict[str, Any]],
    *,
    reminders: dict[str, str],
    ledger: list[dict[str, Any]],
) -> dict[str, Any]:
    """Every figure the weekly report shows for one unit's week."""
    counted = [a for a in appointments if a.get("state") not in NOT_COUNTED]
    totals: Counter[str] = Counter(status_of(a) for a in counted)

    by_channel = group(counted, "channel", CHANNELS, lambda a: a.get("channel") or "ONLINE")
    by_booked_by = group(counted, "bookedBy", BOOKED_BY, booked_by_of)
    by_reminder = group(
        counted,
        "reminder",
        REMINDER,
        lambda a: reminder_of(reminders.get(str(a["appointmentId"]))),
    )

    entitlements: dict[str, dict[str, int]] = {}
    for entry in ledger:
        key = str(entry.get("entitlement") or "NONE")
        row = entitlements.setdefault(key, {"entries": 0, "amountMinor": 0})
        row["entries"] += 1
        row["amountMinor"] += int(entry.get("amountMinor") or 0)
    bands: dict[str, dict[str, Any]] = {}
    for entry in ledger:
        band = str(entry.get("practice") or entry.get("feeBandId") or "No band")
        row = bands.setdefault(band, {"practice": band, "entries": 0, "amountMinor": 0})
        row["entries"] += 1
        row["amountMinor"] += int(entry.get("amountMinor") or 0)

    return {
        "booked": len(counted),
        "attended": totals["attended"],
        "noShow": totals["noShow"],
        "cancelled": totals["cancelled"],
        "lateCancelled": totals["lateCancelled"],
        "open": totals["open"],
        "attendance": attendance(totals),
        "byChannel": by_channel,
        "byBookedBy": by_booked_by,
        "byReminder": by_reminder,
        "ledger": {
            "entries": len(ledger),
            "currency": next((str(e.get("currency")) for e in ledger if e.get("currency")), "XAF"),
            "byEntitlement": [{"entitlement": k, **v} for k, v in sorted(entitlements.items())],
            "byBand": sorted(bands.values(), key=lambda b: -int(b["amountMinor"])),
        },
    }


def _merge_rates(
    units: list[dict[str, Any]], field: str, name: str, order: tuple[str, ...]
) -> list[dict[str, Any]]:
    totals: dict[str, Counter[str]] = {}
    for unit in units:
        for row in unit.get(field) or []:
            counts = totals.setdefault(str(row[name]), Counter())
            counts["booked"] += int(row["booked"])
            counts["attended"] += int(row["attended"])
            counts["noShow"] += int(row["noShow"])
    return [
        {
            name: value,
            "booked": totals[value]["booked"],
            "attended": totals[value]["attended"],
            "noShow": totals[value]["noShow"],
            "attendance": attendance(totals[value]),
        }
        for value in order
        if value in totals
    ]


def hospital_figures(units: list[dict[str, Any]]) -> dict[str, Any]:
    """The whole hospital's breakdowns, from each unit's: what one unit's report shows, summed."""
    entitlements: dict[str, dict[str, int]] = {}
    bands: dict[str, dict[str, Any]] = {}
    currency = "XAF"
    for unit in units:
        ledger = unit.get("ledger") or {}
        currency = str(ledger.get("currency") or currency)
        for row in ledger.get("byEntitlement") or []:
            total = entitlements.setdefault(
                str(row["entitlement"]), {"entries": 0, "amountMinor": 0}
            )
            total["entries"] += int(row["entries"])
            total["amountMinor"] += int(row["amountMinor"])
        for row in ledger.get("byBand") or []:
            band = bands.setdefault(
                str(row["practice"]), {"practice": row["practice"], "entries": 0, "amountMinor": 0}
            )
            band["entries"] += int(row["entries"])
            band["amountMinor"] += int(row["amountMinor"])
    totals: Counter[str] = Counter()
    for unit in units:
        totals["attended"] += int(unit.get("attended") or 0)
        totals["noShow"] += int(unit.get("noShow") or 0)
    return {
        "attendance": attendance(totals),
        "byChannel": _merge_rates(units, "byChannel", "channel", CHANNELS),
        "byBookedBy": _merge_rates(units, "byBookedBy", "bookedBy", BOOKED_BY),
        "byReminder": _merge_rates(units, "byReminder", "reminder", REMINDER),
        "ledger": {
            "entries": sum(int((u.get("ledger") or {}).get("entries") or 0) for u in units),
            "currency": currency,
            "byEntitlement": [{"entitlement": k, **v} for k, v in sorted(entitlements.items())],
            "byBand": sorted(bands.values(), key=lambda b: -int(b["amountMinor"])),
        },
    }
