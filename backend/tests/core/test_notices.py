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
        for kind in notices.KINDS:
            for language in notices.LANGUAGES:
                notice = compose(kind, language=language)
                assert "{" not in notice.subject
                assert "{" not in notice.body


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

    def test_the_template_records_which_wording_was_used(self):
        assert compose(language="en").template == "booking_confirmation.en"
        assert compose(language="fr").template == "booking_confirmation.fr"

    def test_every_kind_exists_in_every_language(self):
        for kind in notices.KINDS:
            for language in notices.LANGUAGES:
                assert notices.TEXT[kind][language]


class TestRefusals:
    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(Invalid):
            compose("SOMETHING_ELSE")

    def test_an_unknown_channel_is_refused(self):
        with pytest.raises(Invalid):
            compose(channel="CARRIER_PIGEON")

    def test_the_channel_is_recorded_on_the_notice(self):
        assert compose().channel == "EMAIL"
