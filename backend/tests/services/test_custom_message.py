"""Cognito's own emails arrive in Atria's look, and never at the cost of a sign-up.

ADR 0020. Cognito refuses a custom message without its code placeholder, and
fails the whole operation when this trigger fails, so both are pinned here.
"""

from __future__ import annotations

import copy

import pytest

from atria.core import mail
from atria.services.identity import custom_message


def event(source: str = "CustomMessage_SignUp", **attributes: str) -> dict:
    return {
        "version": "1",
        "triggerSource": source,
        "userPoolId": "us-east-1_example",
        "userName": "a-user",
        "request": {
            "userAttributes": {"given_name": "Amina", "email": "amina@atria.invalid", **attributes},
            "codeParameter": "{####}",
            "usernameParameter": "{username}" if source.endswith("AdminCreateUser") else None,
        },
        "response": {"smsMessage": None, "emailMessage": None, "emailSubject": None},
    }


def message(source: str = "CustomMessage_SignUp", **attributes: str) -> str:
    return custom_message.handler(event(source, **attributes), None)["response"]["emailMessage"]


class TestEveryOccasion:
    @pytest.mark.parametrize("source", sorted(custom_message.PURPOSE))
    @pytest.mark.parametrize("locale", ["fr", "en"])
    def test_each_email_carries_the_code_and_fits(self, source, locale):
        result = custom_message.handler(event(source, locale=locale), None)
        message = result["response"]["emailMessage"]
        assert "{####}" in message
        assert result["response"]["emailSubject"]
        assert len(message) < mail.COGNITO_LIMIT

    def test_an_invitation_carries_the_username_as_well(self):
        """Cognito refuses an invitation without both placeholders."""
        written = message("CustomMessage_AdminCreateUser")
        assert "{username}" in written
        assert "{####}" in written

    def test_a_reset_says_how_long_its_code_lasts(self):
        assert "one hour" in message("CustomMessage_ForgotPassword", locale="en")

    def test_an_sms_is_left_to_cognito(self):
        """Only the email is restyled; an SMS keeps Cognito's own text."""
        result = custom_message.handler(event(), None)
        assert result["response"]["smsMessage"] is None

    def test_an_occasion_it_does_not_know_is_left_alone(self):
        original = event("CustomMessage_SomethingNew")
        assert custom_message.handler(copy.deepcopy(original), None) == original


class TestLanguage:
    def test_english_until_a_person_can_choose(self):
        """The same default as every notice."""
        result = custom_message.handler(event(), None)
        assert result["response"]["emailSubject"] == "Your Atria verification code"

    def test_french_when_the_account_says_so(self):
        result = custom_message.handler(event(locale="fr-CM"), None)
        assert result["response"]["emailSubject"] == "Votre code de vérification Atria"


class TestPerson:
    def test_it_greets_the_person_by_name(self):
        assert "Hello Amina," in message(locale="en")

    def test_a_name_cannot_inject_markup(self):
        assert "<img src=x>" not in message(given_name="<img src=x>")

    def test_no_name_is_a_plain_greeting(self):
        assert "Hello," in message(locale="en", given_name="")


class TestNeverBreaksSignUp:
    def test_a_failure_leaves_cognitos_default(self, monkeypatch):
        def broken(*_args, **_kwargs):
            raise RuntimeError("layout failed")

        monkeypatch.setattr(custom_message, "compose", broken)
        original = event()
        assert custom_message.handler(copy.deepcopy(original), None) == original

    def test_a_message_over_the_limit_leaves_cognitos_default(self, monkeypatch):
        too_long = "x" * (mail.COGNITO_LIMIT + 1)
        monkeypatch.setattr(custom_message, "compose", lambda *_a, **_k: ("s", too_long))
        original = event()
        assert custom_message.handler(copy.deepcopy(original), None) == original
