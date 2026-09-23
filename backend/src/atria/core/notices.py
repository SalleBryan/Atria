"""What a patient is told, and in which language.

Composing a notice is separated from sending one on purpose. The notification
service turns an appointment event into a notice; the reminder worker is the
only thing that talks to a provider and writes the message log. Keeping the
wording here means it can be read and tested without a queue or a mailbox.

Times are rendered in the clinic's own timezone. A patient told 07:00 for an
eight o'clock appointment would simply not arrive, so the instant a record
holds and the time a notice states are deliberately different things
(FR-REM-05).

Nothing here interpolates a value it was not given. A notice with a blank
clinic name is a notice worth noticing, not one to paper over with a default.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from atria.core.errors import Invalid

# What happened, which is what FR-MSG-03 calls the kind.
BOOKING_CONFIRMATION = "BOOKING_CONFIRMATION"
BOOKING_CANCELLATION = "BOOKING_CANCELLATION"

KINDS = (BOOKING_CONFIRMATION, BOOKING_CANCELLATION)

CHANNELS = ("EMAIL", "SMS", "VOICE")

# The region pack's languages for Cameroon. French first, which is the default
# where a person has expressed no preference.
LANGUAGES = ("fr", "en")
DEFAULT_LANGUAGE = "fr"


# Which notice a change of state owes the patient. A state not listed here
# owes nothing, which is the common case: most transitions are internal and
# telling a patient about each one would be noise, not service.
NOTICE_FOR_STATE = {
    "BOOKED": BOOKING_CONFIRMATION,
    "PATIENT_CANCELLED": BOOKING_CANCELLATION,
    "CLINIC_CANCELLED": BOOKING_CANCELLATION,
}


def kind_for(from_state: str | None, to_state: str) -> str | None:
    """The notice a transition owes, or None.

    Only the arrival in a state counts. A record rewritten while already in a
    state owes nothing, or a retried write would send a second confirmation
    for one booking.
    """
    if from_state == to_state:
        return None
    return NOTICE_FOR_STATE.get(to_state)


@dataclass(frozen=True, slots=True)
class Notice:
    """One composed message, ready for a provider to send."""

    kind: str
    channel: str
    language: str
    template: str
    subject: str
    body: str


def language_for(preferred: object) -> str:
    """The language to write in.

    An unknown preference falls back rather than failing: a patient who set
    something the region pack no longer lists should still be told about their
    appointment.
    """
    candidate = str(preferred or "").strip().lower()[:2]
    return candidate if candidate in LANGUAGES else DEFAULT_LANGUAGE


def local(instant: str, *, zone: ZoneInfo) -> dt.datetime:
    """An instant a record holds, as the clock on the clinic wall."""
    try:
        parsed = dt.datetime.fromisoformat(instant.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as exc:
        raise Invalid("that appointment has no readable start") from exc
    if parsed.tzinfo is None:  # pragma: no cover  records are always written with an offset
        parsed = parsed.replace(tzinfo=dt.UTC)
    return parsed.astimezone(zone)


DATE_FORMATS = {
    "fr": "%d/%m/%Y",
    "en": "%d %B %Y",
}

TEXT = {
    BOOKING_CONFIRMATION: {
        "fr": (
            "Rendez-vous confirme, reference {reference}",
            "Bonjour,\n\n"
            "Votre rendez-vous est confirme.\n\n"
            "Reference : {reference}\n"
            "Date : {date}\n"
            "Heure : {time}\n"
            "Lieu : {clinic}\n"
            "Praticien : {clinician}\n\n"
            "Pour annuler, ouvrez votre rendez-vous dans l'application Atria "
            "et choisissez Annuler. Merci de nous prevenir des que possible "
            "si vous ne pouvez pas venir.\n",
        ),
        "en": (
            "Appointment confirmed, reference {reference}",
            "Hello,\n\n"
            "Your appointment is confirmed.\n\n"
            "Reference: {reference}\n"
            "Date: {date}\n"
            "Time: {time}\n"
            "Place: {clinic}\n"
            "Clinician: {clinician}\n\n"
            "To cancel, open your appointment in the Atria app and choose "
            "Cancel. Please tell us as early as you can if you cannot come.\n",
        ),
    },
    BOOKING_CANCELLATION: {
        "fr": (
            "Rendez-vous annule, reference {reference}",
            "Bonjour,\n\n"
            "Votre rendez-vous a ete annule.\n\n"
            "Reference : {reference}\n"
            "Date prevue : {date}\n"
            "Heure prevue : {time}\n"
            "Lieu : {clinic}\n\n"
            "Ce creneau est de nouveau disponible. Vous pouvez reprendre "
            "rendez-vous dans l'application Atria.\n",
        ),
        "en": (
            "Appointment cancelled, reference {reference}",
            "Hello,\n\n"
            "Your appointment has been cancelled.\n\n"
            "Reference: {reference}\n"
            "Scheduled date: {date}\n"
            "Scheduled time: {time}\n"
            "Place: {clinic}\n\n"
            "That time is free again. You can book another appointment in the "
            "Atria app.\n",
        ),
    },
}


def compose(
    kind: str,
    *,
    appointment: dict[str, object],
    clinic_name: str,
    clinician_name: str,
    language: object,
    zone: ZoneInfo,
    channel: str = "EMAIL",
) -> Notice:
    """Turn an appointment into the notice a patient receives.

    The reference is what a patient quotes at the desk, so it leads both the
    subject and the body (FR-BKG-01).
    """
    if kind not in KINDS:
        raise Invalid("unknown notice kind", detail={"allowed": list(KINDS)})
    if channel not in CHANNELS:
        raise Invalid("unknown channel", detail={"allowed": list(CHANNELS)})
    chosen = language_for(language)
    at = local(str(appointment.get("startAt", "")), zone=zone)

    subject_template, body_template = TEXT[kind][chosen]
    values = {
        "reference": str(appointment.get("reference", "")),
        "date": at.strftime(DATE_FORMATS[chosen]),
        "time": at.strftime("%H:%M"),
        "clinic": clinic_name,
        "clinician": clinician_name,
    }
    return Notice(
        kind=kind,
        channel=channel,
        language=chosen,
        template=f"{kind.lower()}.{chosen}",
        subject=subject_template.format(**values),
        body=body_template.format(**values),
    )
