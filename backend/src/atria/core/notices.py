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

from atria.core import mail
from atria.core.errors import Invalid

# What happened, which is what FR-MSG-03 calls the kind.
BOOKING_CONFIRMATION = "BOOKING_CONFIRMATION"
BOOKING_CANCELLATION = "BOOKING_CANCELLATION"
APPOINTMENT_REMINDER = "APPOINTMENT_REMINDER"

KINDS = (BOOKING_CONFIRMATION, BOOKING_CANCELLATION, APPOINTMENT_REMINDER)

# One SMS segment in the GSM alphabet. Beyond it a message is billed as two, and
# for a clinic paying per message in XAF that doubles the cost of every reminder.
SMS_SEGMENT = 160

CHANNELS = ("EMAIL", "SMS", "VOICE")

# The region pack's languages for Cameroon.
LANGUAGES = ("fr", "en")

# The language for a person who has stated no preference. The region pack puts
# French first, but no screen lets a patient choose a language yet, so every
# patient would be written to in French with no way to change it. Until they
# can choose, the product owner's call (2026-09-24) is English. A preference
# that is on record still wins, so language switching needs no change here.
DEFAULT_LANGUAGE = "en"


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
    """One composed message, ready for a provider to send.

    An email carries both a plain body and an HTML one, sent together so a
    client that shows only text still reads the whole notice. An SMS has only
    the plain body.
    """

    kind: str
    channel: str
    language: str
    template: str
    subject: str
    body: str
    html: str = ""


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

# What an email says, as parts rather than one string, so the plain text and
# the HTML are written from the same words and cannot drift apart. Email is
# UTF-8 end to end, so French keeps its accents here; only the SMS below is
# held to ASCII. Each value is formatted with the appointment's values.
TEXT = {
    BOOKING_CONFIRMATION: {
        "fr": {
            "subject": "Rendez-vous confirmé, référence {reference}",
            "preheader": "Le {date} à {time}, {clinic}.",
            "tag": "Rendez-vous confirmé",
            "heading": "Votre rendez-vous est confirmé",
            "rows": (
                ("Date", "{date}"),
                ("Heure", "{time}"),
                ("Lieu", "{clinic}"),
                ("Praticien", "{clinician}"),
            ),
            "closing": "Pour annuler, ouvrez votre rendez-vous dans l'application Atria "
            "et choisissez Annuler. Merci de nous prévenir dès que possible si vous "
            "ne pouvez pas venir.",
            "action": "Voir mon rendez-vous",
        },
        "en": {
            "subject": "Appointment confirmed, reference {reference}",
            "preheader": "{date} at {time}, {clinic}.",
            "tag": "Appointment confirmed",
            "heading": "Your appointment is confirmed",
            "rows": (
                ("Date", "{date}"),
                ("Time", "{time}"),
                ("Place", "{clinic}"),
                ("Clinician", "{clinician}"),
            ),
            "closing": "To cancel, open your appointment in the Atria app and choose "
            "Cancel. Please tell us as early as you can if you cannot come.",
            "action": "View my appointment",
        },
    },
    BOOKING_CANCELLATION: {
        "fr": {
            "subject": "Rendez-vous annulé, référence {reference}",
            "preheader": "Le {date} à {time}, {clinic}. Ce créneau est libéré.",
            "tag": "Rendez-vous annulé",
            "heading": "Votre rendez-vous a été annulé",
            "rows": (
                ("Date prévue", "{date}"),
                ("Heure prévue", "{time}"),
                ("Lieu", "{clinic}"),
            ),
            "closing": "Ce créneau est de nouveau disponible. Vous pouvez reprendre "
            "rendez-vous dans l'application Atria.",
            "action": "Reprendre rendez-vous",
        },
        "en": {
            "subject": "Appointment cancelled, reference {reference}",
            "preheader": "{date} at {time}, {clinic}. That time is free again.",
            "tag": "Appointment cancelled",
            "heading": "Your appointment has been cancelled",
            "rows": (
                ("Scheduled date", "{date}"),
                ("Scheduled time", "{time}"),
                ("Place", "{clinic}"),
            ),
            "closing": "That time is free again. You can book another appointment in "
            "the Atria app.",
            "action": "Book again",
        },
    },
}

# The words around the parts, per language. French sets a space before a colon.
GREETING = {"fr": "Bonjour,", "en": "Hello,"}
REFERENCE = {"fr": "Référence", "en": "Reference"}
COLON = {"fr": " : ", "en": ": "}

# How each email looks, and where its button leads in the web client.
EMAIL_TONE = {BOOKING_CONFIRMATION: "brand", BOOKING_CANCELLATION: "cancelled"}
EMAIL_LINK = {BOOKING_CONFIRMATION: "/visits/{appointmentId}", BOOKING_CANCELLATION: "/find-care"}


# Short, and plain ASCII: an accent outside the GSM alphabet switches the whole
# message to UCS-2, where a segment holds 70 characters instead of 160. Nothing
# here names the reason for the visit or repeats an intake answer, because a
# phone is read by whoever picks it up (FR-REM-04).
SMS_TEXT = {
    APPOINTMENT_REMINDER: {
        "fr": "Rappel Atria: RDV le {date} a {time}, {clinic}, {clinician}. "
        "Ref {reference}. Pour annuler: application Atria.",
        "en": "Atria reminder: appointment {date} at {time}, {clinic}, {clinician}. "
        "Ref {reference}. To cancel: Atria app.",
    },
    BOOKING_CONFIRMATION: {
        "fr": "Atria: RDV confirme le {date} a {time}, {clinic}, {clinician}. "
        "Ref {reference}. Pour annuler: application Atria.",
        "en": "Atria: appointment confirmed {date} at {time}, {clinic}, {clinician}. "
        "Ref {reference}. To cancel: Atria app.",
    },
}

SMS_DATE = "%d/%m/%Y"


def available(kind: str, channel: str) -> bool:
    """Whether this notice exists on this channel.

    A cancellation goes by email and a reminder by SMS; the only notice sent
    both ways is the confirmation, by SMS when the booking is too close for a
    reminder (FR-REM-06).
    """
    if channel == "EMAIL":
        return kind in TEXT
    if channel == "SMS":
        return kind in SMS_TEXT
    return False


def compose(
    kind: str,
    *,
    appointment: dict[str, object],
    clinic_name: str,
    clinician_name: str,
    language: object,
    zone: ZoneInfo,
    channel: str = "EMAIL",
    app_url: str = "",
) -> Notice:
    """Turn an appointment into the notice a patient receives.

    The reference is what a patient quotes at the desk, so it leads both the
    subject and the body of an email, and is always in an SMS (FR-BKG-01).

    `app_url` is the web client's public origin. An email links into it, and
    shows the brand mark it serves, only when there is one to link to.
    """
    if kind not in KINDS:
        raise Invalid("unknown notice kind", detail={"allowed": list(KINDS)})
    if channel not in CHANNELS:
        raise Invalid("unknown channel", detail={"allowed": list(CHANNELS)})
    if not available(kind, channel):
        raise Invalid(
            "that notice is not sent on that channel",
            detail={"kind": kind, "channel": channel},
        )
    chosen = language_for(language)
    at = local(str(appointment.get("startAt", "")), zone=zone)

    values = {
        "reference": str(appointment.get("reference", "")),
        "date": at.strftime(SMS_DATE if channel == "SMS" else DATE_FORMATS[chosen]),
        "time": at.strftime("%H:%M"),
        "clinic": clinic_name,
        "clinician": clinician_name,
    }
    if channel == "SMS":
        return Notice(
            kind=kind,
            channel=channel,
            language=chosen,
            template=f"{kind.lower()}.sms.{chosen}",
            subject="",
            body=SMS_TEXT[kind][chosen].format(**values),
        )

    parts = TEXT[kind][chosen]
    subject = str(parts["subject"]).format(**values)
    return Notice(
        kind=kind,
        channel=channel,
        language=chosen,
        template=f"{kind.lower()}.{chosen}",
        subject=subject,
        body=plain(kind, chosen, values),
        html=rendered(
            kind, chosen, values, subject=subject, appointment=appointment, app_url=app_url
        ),
    )


def plain(kind: str, language: str, values: dict[str, str]) -> str:
    """The text part: greeting, what happened, the details, what to do."""
    parts = TEXT[kind][language]
    colon = COLON[language]
    lines = [f"{REFERENCE[language]}{colon}{values['reference']}"]
    lines += [f"{name}{colon}{value.format(**values)}" for name, value in parts["rows"]]
    return (
        f"{GREETING[language]}\n\n"
        f"{parts['heading']}.\n\n" + "\n".join(lines) + f"\n\n{parts['closing']}\n"
    )


def rendered(
    kind: str,
    language: str,
    values: dict[str, str],
    *,
    subject: str,
    appointment: dict[str, object],
    app_url: str,
) -> str:
    """The HTML part, in the platform's look (atria.core.mail)."""
    parts = TEXT[kind][language]
    blocks = [mail.paragraph(GREETING[language]), mail.paragraph(str(parts["closing"]))]
    if app_url:
        link = EMAIL_LINK[kind].format(appointmentId=appointment.get("appointmentId", ""))
        blocks.append(mail.button(str(parts["action"]), app_url.rstrip("/") + link))
    return mail.page(
        language=language,
        subject=subject,
        preheader=str(parts["preheader"]).format(**values),
        top=mail.hero(
            tag=str(parts["tag"]),
            heading=str(parts["heading"]),
            lead=f"{REFERENCE[language]} {values['reference']}",
            pairs=[(name, value.format(**values)) for name, value in parts["rows"]],
            tone=EMAIL_TONE[kind],
            checked=kind == BOOKING_CONFIRMATION,
        ),
        body=mail.card(*blocks),
        app_url=app_url,
    )
