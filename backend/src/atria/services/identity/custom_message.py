"""Cognito custom message trigger: Cognito's own emails, in Atria's look.

Cognito, not Atria, sends the code that confirms an email address, the code
that resets a password, and a staff invitation. Left alone they arrive as one
unstyled line. This trigger writes them with the same layout as every booking
email (atria.core.mail, ADR 0020).

Cognito substitutes the code itself: the message carries the placeholder it is
given, `{####}`, and an invitation must carry `{username}` as well, or Cognito
refuses the message.

A styled email is never worth a failed sign-up. Cognito fails the whole
operation when this trigger fails, so anything unexpected here returns the
event untouched and Cognito sends its plain default instead.

The language is the account's `locale`, falling back to the region pack's
default exactly as a booking notice does.
"""

from __future__ import annotations

import os
from typing import Any

from aws_lambda_powertools import Logger

from atria.core import mail, notices

logger = Logger(service="atria-custom-message")

# The web client's public origin; empty until the site is hosted.
APP_URL = os.environ.get("APP_URL", "")

# Which message each Cognito occasion calls for. An occasion not listed here,
# such as an SMS-only one, keeps Cognito's default.
PURPOSE = {
    "CustomMessage_SignUp": "verify",
    "CustomMessage_ResendCode": "verify",
    "CustomMessage_ForgotPassword": "reset",
    "CustomMessage_UpdateUserAttribute": "new_email",
    "CustomMessage_VerifyUserAttribute": "new_email",
    "CustomMessage_AdminCreateUser": "invite",
    "CustomMessage_Authentication": "sign_in",
}

# How long each code works is Cognito's rule, stated here so the patient knows:
# 24 hours to confirm an address, one hour to reset a password, and the
# temporary password lasts as long as the pool allows (three days, IdentityStack).
WORDS: dict[str, dict[str, dict[str, str]]] = {
    "verify": {
        "fr": {
            "subject": "Votre code de vérification Atria",
            "tag": "Vérification",
            "heading": "Confirmez votre adresse e-mail",
            "lead": "Saisissez ce code dans Atria pour terminer la création de votre compte.",
            "note": "Ce code est valable 24 heures.",
            "closing": "Si vous n'avez pas créé de compte Atria, ignorez cet e-mail : "
            "sans ce code, personne ne peut utiliser votre adresse.",
        },
        "en": {
            "subject": "Your Atria verification code",
            "tag": "Verification",
            "heading": "Confirm your email address",
            "lead": "Enter this code in Atria to finish creating your account.",
            "note": "The code works for 24 hours.",
            "closing": "If you did not create an Atria account, ignore this email. "
            "Without the code, nobody can use your address.",
        },
    },
    "reset": {
        "fr": {
            "subject": "Réinitialisation de votre mot de passe Atria",
            "tag": "Mot de passe",
            "heading": "Réinitialisez votre mot de passe",
            "lead": "Saisissez ce code dans Atria, puis choisissez un nouveau mot de passe.",
            "note": "Ce code est valable une heure.",
            "closing": "Si vous n'avez rien demandé, ignorez cet e-mail : votre mot "
            "de passe reste inchangé.",
        },
        "en": {
            "subject": "Reset your Atria password",
            "tag": "Password",
            "heading": "Reset your password",
            "lead": "Enter this code in Atria, then choose a new password.",
            "note": "The code works for one hour.",
            "closing": "If you did not ask for this, ignore this email and your "
            "password stays as it is.",
        },
    },
    "new_email": {
        "fr": {
            "subject": "Confirmez votre nouvelle adresse e-mail",
            "tag": "Vérification",
            "heading": "Confirmez votre nouvelle adresse",
            "lead": "Saisissez ce code dans Atria pour utiliser cette adresse sur votre compte.",
            "note": "Ce code est valable 24 heures.",
            "closing": "Si vous n'avez rien demandé, ignorez cet e-mail : votre "
            "compte garde son adresse actuelle.",
        },
        "en": {
            "subject": "Confirm your new email address",
            "tag": "Verification",
            "heading": "Confirm your new address",
            "lead": "Enter this code in Atria to use this address on your account.",
            "note": "The code works for 24 hours.",
            "closing": "If you did not ask for this, ignore this email and your "
            "account keeps its current address.",
        },
    },
    "sign_in": {
        "fr": {
            "subject": "Votre code de connexion Atria",
            "tag": "Connexion",
            "heading": "Votre code de connexion",
            "lead": "Saisissez ce code dans Atria pour terminer votre connexion.",
            "note": "Ce code expire dans quelques minutes.",
            "closing": "Ce n'était pas vous ? Changez votre mot de passe : quelqu'un "
            "d'autre le connaît.",
        },
        "en": {
            "subject": "Your Atria sign-in code",
            "tag": "Sign in",
            "heading": "Your sign-in code",
            "lead": "Enter this code in Atria to finish signing in.",
            "note": "The code expires in a few minutes.",
            "closing": "Not you? Change your password, because someone else knows it.",
        },
    },
    "invite": {
        "fr": {
            "subject": "Votre compte Atria",
            "tag": "Compte équipe",
            "heading": "Bienvenue dans Atria",
            "lead": "Votre clinique vous a créé un compte. Connectez-vous avec ces "
            "identifiants, puis choisissez votre propre mot de passe.",
            "username": "Identifiant",
            "code": "Mot de passe temporaire",
            "note": "Le mot de passe temporaire est valable 3 jours.",
            "closing": "Ne transférez pas cet e-mail : il ouvre votre compte jusqu'à ce "
            "que vous changiez le mot de passe.",
        },
        "en": {
            "subject": "Your Atria account",
            "tag": "Staff account",
            "heading": "Welcome to Atria",
            "lead": "Your clinic has created an account for you. Sign in with these "
            "details, then choose your own password.",
            "username": "Username",
            "code": "Temporary password",
            "note": "The temporary password works for 3 days.",
            "closing": "Do not forward this email. It opens your account until you "
            "change the password.",
        },
    },
}

CODE = {"fr": "Votre code", "en": "Your code"}
HELLO = {"fr": "Bonjour", "en": "Hello"}


def compose(
    purpose: str,
    *,
    language: str,
    code: str,
    username: str = "",
    given_name: str = "",
    app_url: str = "",
) -> tuple[str, str]:
    """The subject and HTML body for one of Cognito's emails.

    `code` and `username` are Cognito's placeholders, passed through as they
    arrive so Cognito can put the real values in.
    """
    words = WORDS[purpose][language]
    greeting = (
        f"{HELLO[language]} {given_name.strip()}," if given_name.strip() else f"{HELLO[language]},"
    )
    blocks = [mail.paragraph(greeting)]
    if purpose == "invite":
        blocks += [
            mail.field(words["username"], username),
            mail.code(words["code"], code, digits=False),
        ]
    else:
        blocks.append(mail.code(CODE[language], code))
    blocks += [mail.paragraph(words["note"], muted=True), mail.divider()]
    blocks.append(mail.paragraph(words["closing"], muted=True))
    html = mail.page(
        language=language,
        subject=words["subject"],
        preheader=words["lead"],
        top=mail.hero(tag=words["tag"], heading=words["heading"], lead=words["lead"]),
        body=mail.card(*blocks),
        app_url=app_url,
    )
    return words["subject"], html


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    purpose = PURPOSE.get(str(event.get("triggerSource")))
    if purpose is None:
        return event
    try:
        request = event.get("request") or {}
        attributes = request.get("userAttributes") or {}
        subject, html = compose(
            purpose,
            language=notices.language_for(attributes.get("locale")),
            code=str(request.get("codeParameter") or "{####}"),
            username=str(request.get("usernameParameter") or "{username}"),
            given_name=str(attributes.get("given_name") or ""),
            app_url=APP_URL,
        )
    except Exception:
        logger.exception("could not style the message, Cognito sends its own")
        return event
    if len(html) > mail.COGNITO_LIMIT:
        logger.warning(
            "styled message too long, Cognito sends its own", extra={"length": len(html)}
        )
        return event
    response = event.setdefault("response", {})
    response["emailSubject"] = subject
    response["emailMessage"] = html
    return event
