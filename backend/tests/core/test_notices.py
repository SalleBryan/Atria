"""What a patient is told says the right time in the right language.

Supports FR-MSG-01 and FR-MSG-02 (the confirmation and cancellation emails) and
FR-REM-04 and FR-REM-05, which is why the time in a notice is the clinic's
local time and not the instant the record holds.

The single most consequential thing here is the timezone. A patient told 07:00
for an eight o'clock appointment does not arrive.
"""

from __future__ import annotations

import pytest

from atria.core import notices
from atria.core.errors import Invalid

DOUALA = notices.ZoneInfo("Africa/Douala")

APPOINTMENT = {
    "appointmentId": "a-1",
    "reference": "APT-0123456789",
    "startAt": "2026-03-04T08:00:00Z",
    "endAt": "2026-03-04T08:30:00Z",
}


# Every (kind, channel) the system actually sends.
SENT_PAIRS = [
    (notices.BOOKING_CONFIRMATION, "EMAIL"),
    (notices.BOOKING_CANCELLATION, "EMAIL"),
    (notices.APPOINTMENT_REMINDER, "SMS"),
    (notices.BOOKING_CONFIRMATION, "SMS"),
]


def compose(kind: str = notices.BOOKING_CONFIRMATION, **overrides):
    settings = {
        "appointment": APPOINTMENT,
        "clinic_name": "Clinique de Douala",
        "clinician_name": "Dr Paul Etoa",
        "language": "fr",
        "zone": DOUALA,
    }
    settings.update(overrides)
    return notices.compose(kind, **settings)


class TestTime:
    def test_the_time_is_the_clinics_own_clock(self):
        """08:00 UTC is 09:00 in Douala, and 09:00 is what the patient reads."""
        notice = compose()
        assert "09:00" in notice.body
        assert "08:00" not in notice.body

    def test_the_date_is_written_the_way_the_language_writes_it(self):
        assert "04/03/2026" in compose(language="fr").body
        assert "04 March 2026" in compose(language="en").body

    def test_an_unreadable_start_is_refused(self):
        with pytest.raises(Invalid):
            compose(appointment={**APPOINTMENT, "startAt": "soon"})

    def test_a_start_at_midnight_local_is_the_day_before_in_utc(self):
        """Douala is ahead of UTC, so the local date can differ from the
        instant's date, which is exactly the mistake this guards."""
        notice = compose(appointment={**APPOINTMENT, "startAt": "2026-03-04T23:30:00Z"})
        assert "05/03/2026" in notice.body
        assert "00:30" in notice.body


class TestContent:
    def test_the_confirmation_leads_with_the_reference(self):
        notice = compose()
        assert "APT-0123456789" in notice.subject
        assert "APT-0123456789" in notice.body

    def test_the_confirmation_names_the_clinic_and_the_clinician(self):
        notice = compose()
        assert "Clinique de Douala" in notice.body
        assert "Dr Paul Etoa" in notice.body

    def test_the_confirmation_says_how_to_cancel(self):
        """FR-REM-04 asks for it on a reminder, and a confirmation is the first
        chance the patient has to act."""
        assert "Annuler" in compose().body
        assert "Cancel" in compose(language="en").body

    def test_the_cancellation_says_the_time_is_free_again(self):
        notice = compose(notices.BOOKING_CANCELLATION, language="en")
        assert "cancelled" in notice.subject.lower()
        assert "free again" in notice.body

    def test_the_cancellation_does_not_name_a_clinician(self):
        """There is nobody to see, so naming them would only confuse."""
        notice = compose(notices.BOOKING_CANCELLATION)
        assert "Dr Paul Etoa" not in notice.body

    def test_no_placeholder_survives_into_the_message(self):
        for kind, channel in SENT_PAIRS:
            for language in notices.LANGUAGES:
                notice = compose(kind, language=language, channel=channel)
                assert "{" not in notice.subject
                assert "{" not in notice.body


class TestHtml:
    """ADR 0020: an email is also sent as HTML in the platform's look."""

    def test_an_email_has_an_html_part_and_an_sms_does_not(self):
        assert compose().html.startswith("<!DOCTYPE html>")
        assert compose(notices.APPOINTMENT_REMINDER, channel="SMS").html == ""

    def test_the_html_says_what_the_text_says(self):
        html = compose().html
        for expected in (
            "APT-0123456789",
            "09:00",
            "04/03/2026",
            "Clinique de Douala",
            "Dr Paul Etoa",
        ):
            assert expected in html

    def test_the_html_is_in_the_clinics_time_too(self):
        assert "08:00" not in compose().html

    def test_a_name_cannot_inject_markup(self):
        html = compose(clinic_name="<script>x</script>").html
        assert "<script>" not in html

    def test_no_placeholder_survives_into_the_html(self):
        for kind in (notices.BOOKING_CONFIRMATION, notices.BOOKING_CANCELLATION):
            for language in notices.LANGUAGES:
                assert "{" not in compose(kind, language=language).html

    def test_a_cancellation_looks_cancelled(self):
        assert "#8b97ae" in compose(notices.BOOKING_CANCELLATION).html

    def test_there_is_no_button_until_the_site_has_an_address(self):
        assert "Voir mon rendez-vous" not in compose().html

    def test_the_confirmation_button_opens_that_visit(self):
        html = compose(app_url="https://app.atria.example").html
        assert 'href="https://app.atria.example/visits/a-1"' in html

    def test_the_cancellation_button_offers_to_book_again(self):
        html = compose(
            notices.BOOKING_CANCELLATION, language="en", app_url="https://app.atria.example/"
        ).html
        assert 'href="https://app.atria.example/find-care"' in html
        assert "Book again" in html

    def test_email_french_keeps_its_accents(self):
        """Only an SMS is held to ASCII; an email is UTF-8 end to end."""
        assert compose(notices.BOOKING_CANCELLATION).subject.startswith("Rendez-vous annulé")


class TestLanguage:
    @pytest.mark.parametrize("preferred", ["fr", "FR", "fr-CM", "  fr  "])
    def test_french_is_recognised_however_it_is_written(self, preferred):
        assert notices.language_for(preferred) == "fr"

    def test_english_is_recognised(self):
        assert notices.language_for("en-GB") == "en"

    @pytest.mark.parametrize("preferred", [None, "", "de", "klingon", 7])
    def test_anything_else_falls_back_rather_than_failing(self, preferred):
        """A patient should still hear about their appointment."""
        assert notices.language_for(preferred) == notices.DEFAULT_LANGUAGE

    def test_english_until_a_patient_can_choose(self):
        """No screen sets a language yet, so French would be imposed with no
        way out. A preference on record still wins."""
        assert notices.language_for(None) == "en"
        assert compose(language=None).subject.startswith("Appointment confirmed")
        assert compose(language="fr").subject.startswith("Rendez-vous confirmé")

    def test_the_template_records_which_wording_was_used(self):
        assert compose(language="en").template == "booking_confirmation.en"
        assert compose(language="fr").template == "booking_confirmation.fr"

    def test_every_notice_sent_exists_in_every_language(self):
        for kind, channel in SENT_PAIRS:
            table = notices.SMS_TEXT if channel == "SMS" else notices.TEXT
            for language in notices.LANGUAGES:
                assert table[kind][language]

    def test_every_kind_is_sent_on_some_channel(self):
        assert {kind for kind, _channel in SENT_PAIRS} == set(notices.KINDS)


class TestRefusals:
    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(Invalid):
            compose("SOMETHING_ELSE")

    def test_an_unknown_channel_is_refused(self):
        with pytest.raises(Invalid):
            compose(channel="CARRIER_PIGEON")

    def test_the_channel_is_recorded_on_the_notice(self):
        assert compose().channel == "EMAIL"


class TestSms:
    def reminder(self, **overrides):
        return compose(notices.APPOINTMENT_REMINDER, channel="SMS", **overrides)

    def test_fr_rem_04_the_reminder_says_what_the_requirement_lists(self):
        """Clinic, clinician, local date and time, reference, how to cancel."""
        text = self.reminder().body
        assert "Clinique de Douala" in text
        assert "Dr Paul Etoa" in text
        assert "04/03/2026" in text
        assert "09:00" in text
        assert "APT-0123456789" in text
        assert "annuler" in text.lower()

    def test_the_reminder_is_in_the_clinics_time(self):
        assert "08:00" not in self.reminder().body

    def test_fr_rem_04_no_reason_or_intake_answer_reaches_the_phone(self):
        """A phone is read by whoever picks it up. Even when the appointment
        carries them, they are not in the message."""
        appointment = {
            **APPOINTMENT,
            "reason": "suspected tuberculosis",
            "intakeAnswers": {"symptoms": "night sweats"},
        }
        text = self.reminder(appointment=appointment).body
        assert "tuberculosis" not in text
        assert "night sweats" not in text

    def test_a_reminder_with_long_names_still_fits_one_segment(self):
        """Every segment beyond the first is billed again, in XAF, per reminder."""
        for language in notices.LANGUAGES:
            text = self.reminder(
                language=language,
                clinic_name="Hopital General de Douala",
                clinician_name="Dr Marie-Claire Nkengfack",
            ).body
            assert len(text) <= notices.SMS_SEGMENT, (language, len(text))

    def test_the_sms_is_plain_ascii(self):
        """One accent outside the GSM alphabet turns the message into UCS-2,
        where a segment holds 70 characters instead of 160."""
        for kind, channel in SENT_PAIRS:
            if channel != "SMS":
                continue
            for language in notices.LANGUAGES:
                assert compose(kind, channel="SMS", language=language).body.isascii()

    def test_an_sms_has_no_subject(self):
        assert self.reminder().subject == ""

    def test_the_template_names_the_channel(self):
        assert self.reminder().template == "appointment_reminder.sms.fr"

    def test_fr_rem_06_the_confirmation_exists_by_sms(self):
        text = compose(notices.BOOKING_CONFIRMATION, channel="SMS").body
        assert "APT-0123456789" in text
        assert "confirme" in text

    def test_a_reminder_is_not_sent_by_email(self):
        with pytest.raises(Invalid):
            compose(notices.APPOINTMENT_REMINDER, channel="EMAIL")

    def test_a_cancellation_is_not_sent_by_sms(self):
        with pytest.raises(Invalid):
            compose(notices.BOOKING_CANCELLATION, channel="SMS")
