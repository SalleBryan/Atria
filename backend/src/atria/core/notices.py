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
BOOKING_RESCHEDULED = "BOOKING_RESCHEDULED"
BOOKING_DISRUPTED = "BOOKING_DISRUPTED"
QUEUE_MOVED = "QUEUE_MOVED"
BOOKING_DECLINED = "BOOKING_DECLINED"

KINDS = (
    BOOKING_CONFIRMATION,
    BOOKING_CANCELLATION,
    APPOINTMENT_REMINDER,
    BOOKING_RESCHEDULED,
    BOOKING_DISRUPTED,
    QUEUE_MOVED,
    BOOKING_DECLINED,
)

# A queue ticket is confirmed in its own words: a day, an arrival window and a
# place in the queue, and no doctor, who is only assigned at check-in
# (FR-BKG-11). Chosen by compose() for an appointment that holds a session.
TICKET_CONFIRMATION = "TICKET_CONFIRMATION"

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

# The languages switched on. French wording is written and tested, but the
# product owner's call (2026-09-25) is that everything a person sees stays in
# English until language switching ships in the next phase, so a French
# preference on record is not honoured yet. Adding "fr" here turns it on.
OFFERED = ("en",)


# Which notice a change of state owes the patient. A state not listed here
# owes nothing, which is the common case: most transitions are internal and
# telling a patient about each one would be noise, not service.
NOTICE_FOR_STATE = {
    "BOOKED": BOOKING_CONFIRMATION,
    "PATIENT_CANCELLED": BOOKING_CANCELLATION,
    "CLINIC_CANCELLED": BOOKING_CANCELLATION,
    "RESCHEDULED": BOOKING_RESCHEDULED,
    "DISRUPTED": BOOKING_DISRUPTED,
    "DECLINED": BOOKING_DECLINED,
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
    return candidate if candidate in OFFERED else DEFAULT_LANGUAGE


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

TEXT[BOOKING_RESCHEDULED] = {
    "fr": {
        "subject": "Rendez-vous déplacé, référence {reference}",
        "preheader": "Nouvel horaire : le {date} à {time}, {clinic}.",
        "tag": "Rendez-vous déplacé",
        "heading": "Votre rendez-vous a été déplacé",
        "rows": (
            ("Nouvelle date", "{date}"),
            ("Nouvelle heure", "{time}"),
            ("Lieu", "{clinic}"),
            ("Praticien", "{clinician}"),
        ),
        "closing": "Votre référence reste la même. Si ce nouvel horaire ne vous convient "
        "pas, ouvrez votre rendez-vous dans l'application Atria pour le déplacer ou "
        "l'annuler.",
        "action": "Voir mon rendez-vous",
    },
    "en": {
        "subject": "Appointment moved, reference {reference}",
        "preheader": "New time: {date} at {time}, {clinic}.",
        "tag": "Appointment moved",
        "heading": "Your appointment has been moved",
        "rows": (
            ("New date", "{date}"),
            ("New time", "{time}"),
            ("Place", "{clinic}"),
            ("Clinician", "{clinician}"),
        ),
        "closing": "Your reference stays the same. If the new time does not suit you, "
        "open your appointment in the Atria app to move or cancel it.",
        "action": "View my appointment",
    },
}

TEXT[BOOKING_DISRUPTED] = {
    "fr": {
        "subject": "Votre rendez-vous doit être déplacé, référence {reference}",
        "preheader": "Le praticien n'est plus disponible le {date} à {time}.",
        "tag": "Nouvel horaire à choisir",
        "heading": "Votre rendez-vous doit être déplacé",
        "rows": (
            ("Date prévue", "{date}"),
            ("Heure prévue", "{time}"),
            ("Lieu", "{clinic}"),
            ("Praticien", "{clinician}"),
        ),
        "closing": "Le praticien n'est plus disponible à cet horaire. Ouvrez votre "
        "rendez-vous dans l'application Atria pour choisir un nouvel horaire en un "
        "geste, ou pour l'annuler sans frais. Ne vous déplacez pas à l'horaire prévu.",
        "action": "Choisir un nouvel horaire",
    },
    "en": {
        "subject": "Your appointment needs a new time, reference {reference}",
        "preheader": "The clinician is no longer available on {date} at {time}.",
        "tag": "New time needed",
        "heading": "Your appointment needs a new time",
        "rows": (
            ("Scheduled date", "{date}"),
            ("Scheduled time", "{time}"),
            ("Place", "{clinic}"),
            ("Clinician", "{clinician}"),
        ),
        "closing": "The clinician is no longer available at that time. Open your "
        "appointment in the Atria app to choose a new time in one tap, or to cancel "
        "at no cost. Please do not come in at the old time.",
        "action": "Choose a new time",
    },
}

TEXT[TICKET_CONFIRMATION] = {
    "fr": {
        "subject": "Votre place dans la file, référence {reference}",
        "preheader": "Le {date}, arrivée entre {time} et {until}, {clinic}.",
        "tag": "Place réservée",
        "heading": "Vous avez une place dans la file",
        "rows": (
            ("Date", "{date}"),
            ("Arrivée", "entre {time} et {until}"),
            ("Place", "{position}"),
            ("Lieu", "{clinic}"),
        ),
        "closing": "Un médecin vous sera attribué à votre arrivée à l'accueil. Si la file "
        "avance plus vite ou plus lentement que prévu, nous vous enverrons un SMS avec une "
        "nouvelle heure d'arrivée.",
        "action": "Voir ma place",
    },
    "en": {
        "subject": "Your place in the queue, reference {reference}",
        "preheader": "{date}, arrive between {time} and {until}, {clinic}.",
        "tag": "Place held",
        "heading": "You have a place in the queue",
        "rows": (
            ("Date", "{date}"),
            ("Arrive", "between {time} and {until}"),
            ("Place", "{position}"),
            ("At", "{clinic}"),
        ),
        "closing": "A doctor is assigned when you check in at the desk. If the queue moves "
        "faster or slower than expected, we will text you a new arrival time.",
        "action": "See my place",
    },
}

TEXT[BOOKING_DECLINED] = {
    "fr": {
        "subject": "Votre demande n'a pas été retenue, référence {reference}",
        "preheader": "{clinic} ne peut pas programmer cette demande.",
        "tag": "Demande non retenue",
        "heading": "Votre demande n'a pas été retenue",
        "rows": (("Lieu", "{clinic}"),),
        "closing": "L'équipe du service a indiqué pourquoi dans l'application Atria. Vous "
        "pouvez prendre une consultation pour en parler avec un médecin.",
        "action": "Voir la demande",
    },
    "en": {
        "subject": "Your request was not scheduled, reference {reference}",
        "preheader": "{clinic} cannot schedule this request.",
        "tag": "Request declined",
        "heading": "Your request was not scheduled",
        "rows": (("Unit", "{clinic}"),),
        "closing": "The unit has said why in the Atria app. You can book a consultation to "
        "talk it through with a doctor.",
        "action": "See the request",
    },
}

# The words around the parts, per language. French sets a space before a colon.
GREETING = {"fr": "Bonjour,", "en": "Hello,"}
REFERENCE = {"fr": "Référence", "en": "Reference"}
COLON = {"fr": " : ", "en": ": "}

# The reminder by email (2026-09-29): the same visit the SMS names, sent at the
# same time to a patient who has an email address. Like the SMS it names no
# reason for the visit and no intake answer (FR-REM-04). A queue place has its
# own wording, since it has an arrival window and a place, and no doctor yet.
TEXT[APPOINTMENT_REMINDER] = {
    "fr": {
        "subject": "Rappel : rendez-vous le {date} à {time}, référence {reference}",
        "preheader": "Le {date} à {time}, {clinic}.",
        "tag": "Rappel de rendez-vous",
        "heading": "Votre rendez-vous approche",
        "rows": (
            ("Date", "{date}"),
            ("Heure", "{time}"),
            ("Lieu", "{clinic}"),
            ("Praticien", "{clinician}"),
        ),
        "closing": "Merci d'arriver quelques minutes en avance. Si vous ne pouvez pas "
        "venir, annulez dans l'application Atria pour libérer ce créneau.",
        "action": "Voir mon rendez-vous",
    },
    "en": {
        "subject": "Reminder: appointment {date} at {time}, reference {reference}",
        "preheader": "{date} at {time}, {clinic}.",
        "tag": "Appointment reminder",
        "heading": "Your appointment is coming up",
        "rows": (
            ("Date", "{date}"),
            ("Time", "{time}"),
            ("Place", "{clinic}"),
            ("Clinician", "{clinician}"),
        ),
        "closing": "Please arrive a few minutes early. If you cannot come, cancel in the "
        "Atria app so the time goes to someone else.",
        "action": "View my appointment",
    },
}
TICKET_REMINDER_TEXT = "APPOINTMENT_REMINDER_TICKET"
TEXT[TICKET_REMINDER_TEXT] = {
    "fr": {
        "subject": "Rappel : votre place le {date}, référence {reference}",
        "preheader": "Arrivez entre {time} et {until}, {clinic}.",
        "tag": "Rappel de file d'attente",
        "heading": "Votre place dans la file approche",
        "rows": (
            ("Date", "{date}"),
            ("Arrivée", "entre {time} et {until}"),
            ("Lieu", "{clinic}"),
            ("Place", "{position}"),
        ),
        "closing": "Arrivez pendant cette plage horaire. Si la file avance ou prend du "
        "retard, nous vous prévenons par SMS. Si vous ne pouvez pas venir, libérez "
        "votre place dans l'application Atria.",
        "action": "Voir ma place",
    },
    "en": {
        "subject": "Reminder: your place on {date}, reference {reference}",
        "preheader": "Arrive between {time} and {until}, {clinic}.",
        "tag": "Queue reminder",
        "heading": "Your place in the queue is coming up",
        "rows": (
            ("Date", "{date}"),
            ("Arrive", "between {time} and {until}"),
            ("Place", "{clinic}"),
            ("Queue place", "{position}"),
        ),
        "closing": "Arrive inside that window. If the queue moves or runs late, we text "
        "you. If you cannot come, give up your place in the Atria app.",
        "action": "View my place",
    },
}

# How each email looks, and where its button leads in the web client.
EMAIL_TONE = {
    BOOKING_CONFIRMATION: "brand",
    BOOKING_CANCELLATION: "cancelled",
    BOOKING_RESCHEDULED: "brand",
    BOOKING_DISRUPTED: "cancelled",
    TICKET_CONFIRMATION: "brand",
    BOOKING_DECLINED: "cancelled",
    APPOINTMENT_REMINDER: "brand",
    TICKET_REMINDER_TEXT: "brand",
}
EMAIL_LINK = {
    BOOKING_CONFIRMATION: "/visits/{appointmentId}",
    BOOKING_CANCELLATION: "/find-care",
    BOOKING_RESCHEDULED: "/visits/{appointmentId}",
    BOOKING_DISRUPTED: "/visits/{appointmentId}",
    TICKET_CONFIRMATION: "/visits/{appointmentId}",
    BOOKING_DECLINED: "/visits/{appointmentId}",
    APPOINTMENT_REMINDER: "/visits/{appointmentId}",
    TICKET_REMINDER_TEXT: "/visits/{appointmentId}",
}


# Short, and plain ASCII: an accent outside the GSM alphabet switches the whole
# message to UCS-2, where a segment holds 70 characters instead of 160. Nothing
# here names the reason for the visit or repeats an intake answer, because a
# phone is read by whoever picks it up (FR-REM-04).
SMS_TEXT = {
    APPOINTMENT_REMINDER: {
        "fr": "Rappel Atria: RDV le {date} a {time}, {clinic}, {clinician}. "
        "Ref {reference}.{fee} Annuler: appli Atria.",
        "en": "Atria reminder: appointment {date} at {time}, {clinic}, {clinician}. "
        "Ref {reference}.{fee} Cancel: Atria app.",
    },
    BOOKING_CONFIRMATION: {
        "fr": "Atria: RDV confirme le {date} a {time}, {clinic}, {clinician}. "
        "Ref {reference}.{fee} Annuler: appli Atria.",
        "en": "Atria: appointment confirmed {date} at {time}, {clinic}, {clinician}. "
        "Ref {reference}.{fee} Cancel: Atria app.",
    },
    QUEUE_MOVED: {
        "fr": "Atria: la file a bouge. Arrivez le {date} entre {time} et {until}, {clinic}. "
        "Place {position}. Ref {reference}.",
        "en": "Atria: the queue has moved. Arrive {date} between {time} and {until}, {clinic}. "
        "Place {position}. Ref {reference}.",
    },
}

SMS_DATE = "%d/%m/%Y"

# The fee a patient will be asked at the hospital (AD-07: no money moves in
# Atria), stated in the notices that tell them about the visit. The amount is the
# fee band in force on the day of the visit, in whole currency units, and carries
# no rating or score (AD-11). A visit with no fee band says nothing about a fee,
# rather than guessing one.
FEE_LABEL = {"fr": "Tarif", "en": "Fee"}
FREE = {"fr": "gratuit", "en": "free"}
FEE_GROUP = {"fr": " ", "en": ","}
# The notices that carry a fee line: the ones that tell a patient about a visit.
FEE_KINDS = (BOOKING_CONFIRMATION, TICKET_CONFIRMATION, APPOINTMENT_REMINDER, TICKET_REMINDER_TEXT)


def fee_text(fee: tuple[int, str], language: str) -> str:
    """ "15,000 XAF", "15 000 XAF" in French, or "free" for a fee of nothing."""
    amount, currency = fee
    if amount <= 0:
        return FREE[language]
    whole = f"{amount:,}".replace(",", FEE_GROUP[language])
    return f"{whole} {currency}"


def rows_of(kind: str, language: str, values: dict[str, str]) -> tuple[tuple[str, str], ...]:
    """The detail rows of an email, with the fee row last when there is a fee to say."""
    rows: list[tuple[str, str]] = [
        (str(name), str(row)) for name, row in TEXT[kind][language]["rows"]
    ]
    if kind in FEE_KINDS and values.get("fee_value"):
        rows.append((FEE_LABEL[language], "{fee_value}"))
    return tuple(rows)


def available(kind: str, channel: str) -> bool:
    """Whether this notice exists on this channel.

    A cancellation goes by email. A reminder goes by SMS and, to a patient with
    an email address, by email as well (2026-09-29). The confirmation goes by
    email, and by SMS when the booking is too close for a reminder (FR-REM-06).
    """
    if channel == "EMAIL":
        return kind in TEXT and kind not in (TICKET_CONFIRMATION, TICKET_REMINDER_TEXT)
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
    fee: tuple[int, str] | None = None,
) -> Notice:
    """Turn an appointment into the notice a patient receives.

    The reference is what a patient quotes at the desk, so it leads both the
    subject and the body of an email, and is always in an SMS (FR-BKG-01).

    `app_url` is the web client's public origin. An email links into it, and
    shows the brand mark it serves, only when there is one to link to.

    `fee` is the visit's fee as (whole units, currency), or None when the visit
    has no fee band. A confirmation and a reminder state it; the other notices do not.
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
    ends = appointment.get("arrivalWindowEnd") or appointment.get("endAt")
    until = local(str(ends), zone=zone) if ends else at
    ticket = bool(appointment.get("sessionId"))
    if ticket and kind == BOOKING_CONFIRMATION and channel == "EMAIL":
        kind = TICKET_CONFIRMATION
    # The words an email is written from: a queue place's reminder has its own,
    # while the notice keeps its kind, so the message log reads as a reminder.
    wording = TICKET_REMINDER_TEXT if ticket and kind == APPOINTMENT_REMINDER else kind

    values = {
        "reference": str(appointment.get("reference", "")),
        "date": at.strftime(SMS_DATE if channel == "SMS" else DATE_FORMATS[chosen]),
        "time": at.strftime("%H:%M"),
        "clinic": clinic_name,
        # A ticket names no doctor before check-in (FR-BKG-11).
        "clinician": clinician_name or ("next free doctor" if ticket else ""),
        "until": until.strftime("%H:%M"),
        "position": str(appointment.get("position") or ""),
        "fee_value": fee_text(fee, chosen) if fee is not None else "",
        "fee": f" {FEE_LABEL[chosen]}: {fee_text(fee, chosen)}." if fee is not None else "",
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

    parts = TEXT[wording][chosen]
    subject = str(parts["subject"]).format(**values)
    return Notice(
        kind=kind,
        channel=channel,
        language=chosen,
        template=f"{wording.lower()}.{chosen}",
        subject=subject,
        body=plain(wording, chosen, values),
        html=rendered(
            wording, chosen, values, subject=subject, appointment=appointment, app_url=app_url
        ),
    )


def plain(kind: str, language: str, values: dict[str, str]) -> str:
    """The text part: greeting, what happened, the details, what to do."""
    parts = TEXT[kind][language]
    colon = COLON[language]
    lines = [f"{REFERENCE[language]}{colon}{values['reference']}"]
    lines += [
        f"{name}{colon}{value.format(**values)}" for name, value in rows_of(kind, language, values)
    ]
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
            pairs=[
                (name, value.format(**values)) for name, value in rows_of(kind, language, values)
            ],
            tone=EMAIL_TONE[kind],
            checked=kind == BOOKING_CONFIRMATION,
        ),
        body=mail.card(*blocks),
        app_url=app_url,
    )
