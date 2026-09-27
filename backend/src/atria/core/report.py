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

and attendance broken down by booking channel and by whether the reminder was
sent, failed, or never sent. Attendance is attended out of those who either
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


def week_figures(
    appointments: list[dict[str, Any]],
    *,
    reminders: dict[str, str],
    ledger: list[dict[str, Any]],
) -> dict[str, Any]:
    """Every figure the weekly report shows for one unit's week."""
    counted = [a for a in appointments if a.get("state") not in NOT_COUNTED]
    totals: Counter[str] = Counter(status_of(a) for a in counted)

    by_channel = []
    for channel in CHANNELS:
        these = [a for a in counted if (a.get("channel") or "ONLINE") == channel]
        if not these:
            continue
        counts: Counter[str] = Counter(status_of(a) for a in these)
        by_channel.append(
            {
                "channel": channel,
                "booked": len(these),
                "attended": counts["attended"],
                "noShow": counts["noShow"],
                "attendance": attendance(counts),
            }
        )

    by_reminder = []
    for outcome in REMINDER:
        these = [
            a for a in counted if reminder_of(reminders.get(str(a["appointmentId"]))) == outcome
        ]
        if not these:
            continue
        counts = Counter(status_of(a) for a in these)
        by_reminder.append(
            {
                "reminder": outcome,
                "booked": len(these),
                "attended": counts["attended"],
                "noShow": counts["noShow"],
                "attendance": attendance(counts),
            }
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
        "byReminder": by_reminder,
        "ledger": {
            "entries": len(ledger),
            "currency": next((str(e.get("currency")) for e in ledger if e.get("currency")), "XAF"),
            "byEntitlement": [{"entitlement": k, **v} for k, v in sorted(entitlements.items())],
            "byBand": sorted(bands.values(), key=lambda b: -int(b["amountMinor"])),
        },
    }
