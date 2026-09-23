"""Every outbound message leaves a row, whatever happens to it.

Verifies FR-MSG-03: a message log with channel, kind, recipient, appointment
and a delivery state, with a reason when it failed. Phase 1 records SCHEDULED
and SENT; DELIVERED arrives from the provider in Phase 2.

The row is written before the provider is called, so a send that vanishes
leaves SCHEDULED rather than nothing. A message with no record would be
invisible, which is worse than one recorded as failed.
"""

from __future__ import annotations

import datetime as dt

import pytest

from atria.core import notices
from atria.data.messages import FAILED, SCHEDULED, SENT, Messages

pytestmark = pytest.mark.usefixtures("table")

TENANT = "t-cm-001"
NOW = dt.datetime(2026, 3, 4, 9, 30, 15, tzinfo=dt.UTC)
DOUALA = notices.ZoneInfo("Africa/Douala")


@pytest.fixture
def messages(repository):
    return Messages(repository, clock=lambda: NOW)


@pytest.fixture
def notice():
    return notices.compose(
        notices.BOOKING_CONFIRMATION,
        appointment={"reference": "APT-0123456789", "startAt": "2026-03-10T08:00:00Z"},
        clinic_name="Clinique de Douala",
        clinician_name="Dr Paul Etoa",
        language="fr",
        zone=DOUALA,
    )


def schedule(messages, notice, **overrides):
    settings = {
        "tenant_id": TENANT,
        "notice": notice,
        "recipient_person_id": "p-1",
        "recipient": "patient@atria.invalid",
        "appointment_id": "a-1",
    }
    settings.update(overrides)
    return messages.scheduled(**settings)


class TestScheduled:
    def test_a_row_is_written_before_anything_is_sent(self, messages, notice):
        row = schedule(messages, notice)
        assert row["deliveryState"] == SCHEDULED

    def test_fr_msg_03_the_row_carries_what_the_requirement_asks_for(self, messages, notice):
        row = schedule(messages, notice)
        assert row["channel"] == "EMAIL"
        assert row["kind"] == notices.BOOKING_CONFIRMATION
        assert row["recipient"] == "patient@atria.invalid"
        assert row["recipientPersonId"] == "p-1"
        assert row["appointmentId"] == "a-1"
        assert row["tenantId"] == TENANT

    def test_the_wording_used_is_recorded(self, messages, notice):
        """Which text a patient received is the question asked afterwards."""
        row = schedule(messages, notice)
        assert row["template"] == "booking_confirmation.fr"
        assert row["language"] == "fr"

    def test_the_subject_is_kept_but_not_the_body(self, messages, notice):
        """Enough to recognise the message without keeping a copy of it."""
        row = schedule(messages, notice)
        assert "APT-0123456789" in row["subject"]
        assert "body" not in row

    def test_two_messages_in_the_same_second_are_both_kept(self, messages, notice):
        """The sort key carries the identifier, so neither overwrites the other."""
        first = schedule(messages, notice)
        second = schedule(messages, notice)
        assert first["messageLogId"] != second["messageLogId"]
        assert len(messages.for_day(TENANT, "2026-03-04")) == 2


class TestOutcome:
    def test_a_sent_message_records_what_the_provider_called_it(self, messages, notice):
        row = schedule(messages, notice)
        updated = messages.sent(row, provider_message_id="ses-0102030405")
        assert updated["deliveryState"] == SENT
        assert updated["providerMessageId"] == "ses-0102030405"

    def test_a_failed_message_records_why(self, messages, notice):
        row = schedule(messages, notice)
        updated = messages.failed(row, reason="Email address is not verified")
        assert updated["deliveryState"] == FAILED
        assert "not verified" in updated["failureReason"]

    def test_a_long_provider_error_is_trimmed(self, messages, notice):
        row = schedule(messages, notice)
        updated = messages.failed(row, reason="x" * 5000)
        assert len(updated["failureReason"]) == 300

    def test_the_outcome_lands_on_the_row_that_was_written(self, messages, notice):
        row = schedule(messages, notice)
        messages.sent(row, provider_message_id="ses-1")
        found = messages.for_day(TENANT, "2026-03-04")
        assert len(found) == 1
        assert found[0]["deliveryState"] == SENT


class TestReading:
    def test_a_day_is_one_query(self, messages, notice):
        schedule(messages, notice)
        assert len(messages.for_day(TENANT, "2026-03-04")) == 1

    def test_another_day_holds_nothing(self, messages, notice):
        schedule(messages, notice)
        assert messages.for_day(TENANT, "2026-03-05") == []

    def test_another_tenant_holds_nothing(self, messages, notice):
        schedule(messages, notice)
        assert messages.for_day("t-other", "2026-03-04") == []

    def test_the_day_is_ordered_earliest_first(self, repository, notice):
        for minute in (30, 10, 50):
            Messages(
                repository, clock=lambda m=minute: NOW.replace(minute=m)
            ).scheduled(
                tenant_id=TENANT,
                notice=notice,
                recipient_person_id="p-1",
                recipient="patient@atria.invalid",
                appointment_id="a-1",
            )
        found = Messages(repository).for_day(TENANT, "2026-03-04")
        stamps = [row["sentAt"] for row in found]
        assert stamps == sorted(stamps)

    def test_a_message_log_row_does_not_expire(self, messages, notice):
        """The table expires anything carrying expiresAt, and the log is kept."""
        assert "expiresAt" not in schedule(messages, notice)
