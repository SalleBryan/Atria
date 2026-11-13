"""Cameroonian Pidgin English wording for notices and account emails.

NEEDS NATIVE SPEAKER REVIEW. Nobody who speaks Pidgin has read this yet, and
the repo holds no verified standard spelling for it. The words are a plain,
readable draft ("yu", "wi", "fo", "don", "no fit", "dem"), kept short on
purpose. `notices.OFFERED` is what decides whether any of it reaches a patient;
keep "pcm" out of it until a native speaker has corrected this file
(NFR-L10N-01, CX-2).

The shape of every entry mirrors its French and English siblings in
`notices.TEXT`, `notices.SMS_TEXT` and `services/identity/custom_message.WORDS`,
which merge these in. The SMS lines are plain ASCII for the same reason theirs
are: one segment is 160 characters.
"""

from __future__ import annotations

from collections.abc import Sequence

GREETING = "Hello,"
REFERENCE = "Reference"
COLON = ": "
DATE_FORMAT = "%d %B %Y"
FOOTER = (
    "Yu de receive dis email because yu get Atria account. "
    "E send by itself, so wi no de read replies."
)
NEXT_DOCTOR = "di next doctor wey free"

# Keyed by the notice kind names in atria.core.notices.
TEXT: dict[str, dict[str, Sequence[Sequence[str]]]] = {
    "BOOKING_CONFIRMATION": {
        "subject": "Appointment don confam, reference {reference}",
        "preheader": "{date} fo {time}, {clinic}.",
        "tag": "Appointment don confam",
        "heading": "Yu appointment don confam",
        "rows": (
            ("Date", "{date}"),
            ("Time", "{time}"),
            ("Place", "{clinic}"),
            ("Doctor", "{clinician}"),
        ),
        "closing": "Fo cancel, open yu appointment inside Atria app and tap Cancel. "
        "If yu no fit kam, abeg tell wi quick quick.",
        "action": "Look my appointment",
    },
    "BOOKING_CANCELLATION": {
        "subject": "Appointment don cancel, reference {reference}",
        "preheader": "{date} fo {time}, {clinic}. Dat time don free again.",
        "tag": "Appointment don cancel",
        "heading": "Dem don cancel yu appointment",
        "rows": (
            ("Date", "{date}"),
            ("Time", "{time}"),
            ("Place", "{clinic}"),
        ),
        "closing": "Dat time don free again. Yu fit book anoda appointment inside Atria app.",
        "action": "Book again",
    },
    "BOOKING_RESCHEDULED": {
        "subject": "Appointment don change time, reference {reference}",
        "preheader": "New time: {date} fo {time}, {clinic}.",
        "tag": "Appointment don change time",
        "heading": "Dem don change yu appointment time",
        "rows": (
            ("New date", "{date}"),
            ("New time", "{time}"),
            ("Place", "{clinic}"),
            ("Doctor", "{clinician}"),
        ),
        "closing": "Yu reference no change. If di new time no fit yu, open yu appointment "
        "inside Atria app fo change am or cancel am.",
        "action": "Look my appointment",
    },
    "BOOKING_DISRUPTED": {
        "subject": "Yu appointment need new time, reference {reference}",
        "preheader": "Di doctor no fit kam {date} fo {time}.",
        "tag": "New time needed",
        "heading": "Yu appointment need new time",
        "rows": (
            ("Date", "{date}"),
            ("Time", "{time}"),
            ("Place", "{clinic}"),
            ("Doctor", "{clinician}"),
        ),
        "closing": "Di doctor no fit kam dat time again. Open yu appointment inside Atria "
        "app fo choose new time, or fo cancel am for free. Abeg no kam fo di old time.",
        "action": "Choose new time",
    },
    "TICKET_CONFIRMATION": {
        "subject": "Yu place inside di queue, reference {reference}",
        "preheader": "{date}, arrive between {time} and {until}, {clinic}.",
        "tag": "Place don hold",
        "heading": "Yu get place inside di queue",
        "rows": (
            ("Date", "{date}"),
            ("Arrive", "between {time} and {until}"),
            ("Place", "{position}"),
            ("At", "{clinic}"),
        ),
        "closing": "Dem go give yu doctor wen yu reach di desk. If di queue move fast or "
        "slow pass how wi tink, wi go text yu new time fo arrive.",
        "action": "Look my place",
    },
    "BOOKING_DECLINED": {
        "subject": "Dem no schedule yu request, reference {reference}",
        "preheader": "{clinic} no fit schedule dis request.",
        "tag": "Request no pass",
        "heading": "Dem no schedule yu request",
        "rows": (("Unit", "{clinic}"),),
        "closing": "Di unit don talk why inside Atria app. Yu fit book consultation fo "
        "talk am wit doctor.",
        "action": "Look di request",
    },
    "APPOINTMENT_REMINDER": {
        "subject": "Reminder: appointment {date} fo {time}, reference {reference}",
        "preheader": "{date} fo {time}, {clinic}.",
        "tag": "Appointment reminder",
        "heading": "Yu appointment de near",
        "rows": (
            ("Date", "{date}"),
            ("Time", "{time}"),
            ("Place", "{clinic}"),
            ("Doctor", "{clinician}"),
        ),
        "closing": "Abeg arrive small before time. If yu no fit kam, cancel inside Atria "
        "app so di time go to anoda person.",
        "action": "Look my appointment",
    },
    "APPOINTMENT_REMINDER_TICKET": {
        "subject": "Reminder: yu place fo {date}, reference {reference}",
        "preheader": "Arrive between {time} and {until}, {clinic}.",
        "tag": "Queue reminder",
        "heading": "Yu place inside di queue de near",
        "rows": (
            ("Date", "{date}"),
            ("Arrive", "between {time} and {until}"),
            ("Place", "{clinic}"),
            ("Queue place", "{position}"),
        ),
        "closing": "Arrive inside dat time. If di queue move or late, wi go text yu. "
        "If yu no fit kam, leave yu place inside Atria app.",
        "action": "Look my place",
    },
}

FEE_LABEL = "Fee"
FREE = "free"

SMS_TEXT: dict[str, str] = {
    "APPOINTMENT_REMINDER": "Atria reminder: visit {date} fo {time}, {clinic}, "
    "{clinician}. Ref {reference}.{fee} Cancel fo Atria.",
    "BOOKING_CONFIRMATION": "Atria: visit don confam {date} fo {time}, {clinic}, "
    "{clinician}. Ref {reference}.{fee} Cancel fo Atria.",
    "EARLY_CALL_INVITE": "Atria: doctor fit see yu early. Yu fit reach {clinic} in {minutes} min? "
    "Open yu ticket fo Atria, tap Yes. Ref {reference}.",
    "QUEUE_MOVED": "Atria: di queue don move. Arrive {date} between {time} and {until}, "
    "{clinic}. Place {position}. Ref {reference}.",
}

# Cognito's own emails, keyed like custom_message.WORDS.
ACCOUNT: dict[str, dict[str, str]] = {
    "verify": {
        "subject": "Yu Atria verification code",
        "tag": "Verification",
        "heading": "Confam yu email address",
        "lead": "Put dis code inside Atria fo finish to open yu account.",
        "note": "Di code de work fo 24 hours.",
        "closing": "If na no yu open Atria account, forget dis email. "
        "Without di code, nobody fit use yu address.",
    },
    "reset": {
        "subject": "Reset yu Atria password",
        "tag": "Password",
        "heading": "Reset yu password",
        "lead": "Put dis code inside Atria, then choose new password.",
        "note": "Di code de work fo one hour.",
        "closing": "If na no yu ask fo dis, forget dis email and yu password go stay as e be.",
    },
    "new_email": {
        "subject": "Confam yu new email address",
        "tag": "Verification",
        "heading": "Confam yu new address",
        "lead": "Put dis code inside Atria fo use dis address fo yu account.",
        "note": "Di code de work fo 24 hours.",
        "closing": "If na no yu ask fo dis, forget dis email and yu account "
        "go keep di old address.",
    },
    "sign_in": {
        "subject": "Yu Atria sign-in code",
        "tag": "Sign in",
        "heading": "Yu sign-in code",
        "lead": "Put dis code inside Atria fo finish to sign in.",
        "note": "Di code go expire inside few minutes.",
        "closing": "Na no yu? Change yu password, because anoda person know am.",
    },
    "invite": {
        "subject": "Yu Atria account",
        "tag": "Staff account",
        "heading": "Welcome fo Atria",
        "lead": "Yu healthcare institution don open account fo yu. "
        "Sign in wit dis details, then choose yu own password.",
        "username": "Username",
        "code": "Temporary password",
        "note": "Di temporary password de work fo 3 days.",
        "closing": "No forward dis email. E de open yu account until yu change di password.",
    },
}
CODE = "Yu code"
HELLO = "Hello"
