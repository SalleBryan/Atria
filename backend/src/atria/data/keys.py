"""Key builders for the single table design.

The patterns come from the specification (spec/atria_spec/keys.py, and the key
tables in the Technical Document). Nothing else in the codebase writes a key by
hand: a typo in a prefix is a silent data bug, so every key is built here and
the builders are tested against the specification patterns.

Every key except the region pack and the person is prefixed with the tenant, so
one tenant's query can never reach another's items (ADR 0013 and the tenancy
requirements).
"""

from __future__ import annotations

from dataclasses import dataclass

TENANT = "TENANT#"


@dataclass(frozen=True, slots=True)
class Key:
    """A composed primary key."""

    pk: str
    sk: str

    def as_item(self) -> dict[str, str]:
        return {"pk": self.pk, "sk": self.sk}


# ---------------------------------------------------------------- configuration
def tenant(tenant_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}", "META")


def region_pack(code: str) -> Key:
    return Key(f"REGION#{code}", "PACK")


def clinic(tenant_id: str, clinic_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#CLINIC#{clinic_id}", "PROFILE")


def appointment_type(tenant_id: str, type_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#TYPE#{type_id}", "TYPE")


def intake_form(tenant_id: str, form_id: str, version: int) -> Key:
    return Key(f"{TENANT}{tenant_id}#FORM#{form_id}", f"V#{version}")


def fee_band(tenant_id: str, band_id: str, effective_from: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#FEE#{band_id}", f"FROM#{effective_from}")


# ------------------------------------------------------------ people and consent
def person(person_id: str) -> Key:
    return Key(f"PERSON#{person_id}", "PERSON")


def patient_profile(tenant_id: str, patient_profile_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#PAT#{patient_profile_id}", "PROFILE")


def staff_membership(tenant_id: str, staff_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#STAFF#{staff_id}", "MEMBERSHIP")


def clinician_profile(tenant_id: str, staff_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#STAFF#{staff_id}", "CLINICIAN")


def consent_record(person_id: str, granted_at: str, consent_id: str) -> Key:
    return Key(f"PERSON#{person_id}", f"CONSENT#{granted_at}#{consent_id}")


def priority_allowance(tenant_id: str, staff_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#STAFF#{staff_id}", "PRIORITY")


# ------------------------------------------------------------------- scheduling
def availability_template(tenant_id: str, clinician_id: str, weekday: int) -> Key:
    return Key(f"{TENANT}{tenant_id}#CLIN#{clinician_id}", f"AVAIL#{weekday}")


def availability_exception(tenant_id: str, clinician_id: str, start: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#CLIN#{clinician_id}", f"EXC#{start}")


def session(tenant_id: str, session_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#SESSION#{session_id}", "SESSION")


def queue_ticket(tenant_id: str, session_id: str, request_ts: str, ticket_id: str) -> Key:
    """Order comes from the server request timestamp. Guard SERVER_ASSIGNED_ORDER."""
    return Key(f"{TENANT}{tenant_id}#SESSION#{session_id}", f"TICKET#{request_ts}#{ticket_id}")


def slot_lock(tenant_id: str, clinician_id: str, unit_start: str) -> Key:
    """One item per grid unit. The conditional write on these is what makes a
    booking atomic across N consecutive units (ADR 0004)."""
    return Key(f"{TENANT}{tenant_id}#LOCK#{clinician_id}#{unit_start}", "LOCK")


# ------------------------------------------------------------------ appointments
def appointment(tenant_id: str, appointment_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", "APPT")


def appointment_event(tenant_id: str, appointment_id: str, ts: str, event_id: str) -> Key:
    """One item per transition, ordered by when it happened.

    The identifier is part of the sort key because two transitions can land in
    the same second, and a key that collided would make the second one cancel
    the transaction it arrived in. Queue tickets, message log entries and audit
    entries are keyed the same way, for the same reason.
    """
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", f"EVENT#{ts}#{event_id}")


def referral(tenant_id: str, appointment_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", "REFERRAL")


def fee_ledger_entry(tenant_id: str, appointment_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", "LEDGER")


def feedback(tenant_id: str, appointment_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", "FEEDBACK")


def reminder(tenant_id: str, appointment_id: str, send_at: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", f"REMINDER#{send_at}")


def care_context(tenant_id: str, appointment_id: str) -> Key:
    """Lives in its own table, on its own customer-managed key, with a TTL."""
    return Key(f"{TENANT}{tenant_id}#APPT#{appointment_id}", "CARE")


# ----------------------------------------------------------- messaging and audit
def message_log(tenant_id: str, day: str, sent_at: str, message_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#MSG#{day}", f"{sent_at}#{message_id}")


def audit_entry(tenant_id: str, day: str, ts: str, audit_id: str) -> Key:
    return Key(f"{TENANT}{tenant_id}#AUDIT#{day}", f"{ts}#{audit_id}")
