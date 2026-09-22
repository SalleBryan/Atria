"""Every key builder matches the pattern in the specification.

The patterns are documented in the Technical Document key tables and held in
spec/atria_spec/keys.py. A prefix typo is a silent data bug, so this test walks
the specification rather than repeating the prefixes by hand.

Verifies FR-TEN-01 (every key is tenant prefixed) and the table design.
"""

from __future__ import annotations

import re

import pytest
from atria_spec import keys as spec

from atria.data import keys

# One builder call per specification row, with placeholder values.
BUILT = {
    "Tenant": keys.tenant("t1"),
    "Region pack": keys.region_pack("CM"),
    "Clinic": keys.clinic("t1", "c1"),
    "Appointment type": keys.appointment_type("t1", "ty1"),
    "Intake form": keys.intake_form("t1", "f1", 3),
    "Fee band": keys.fee_band("t1", "fb1", "2026-01-01"),
    "Person": keys.person("p1"),
    "Patient profile": keys.patient_profile("t1", "pp1"),
    "Staff membership": keys.staff_membership("t1", "s1"),
    "Clinician profile": keys.clinician_profile("t1", "s1"),
    "Consent record": keys.consent_record("p1", "2026-01-01T09:00:00Z", "co1"),
    "Priority allowance": keys.priority_allowance("t1", "s1"),
    "Availability template": keys.availability_template("t1", "s1", 2),
    "Availability exception": keys.availability_exception("t1", "s1", "2026-03-04T08:00:00Z"),
    "Session": keys.session("t1", "se1"),
    "Queue ticket": keys.queue_ticket("t1", "se1", "2026-03-04T08:01:02Z", "tk1"),
    "Slot lock": keys.slot_lock("t1", "s1", "2026-03-04T08:10:00Z"),
    "Appointment": keys.appointment("t1", "a1"),
    "Appointment event": keys.appointment_event("t1", "a1", "2026-03-04T08:10:00Z"),
    "Referral": keys.referral("t1", "a1"),
    "Fee ledger entry": keys.fee_ledger_entry("t1", "a1"),
    "Feedback": keys.feedback("t1", "a1"),
    "Reminder": keys.reminder("t1", "a1", "2026-03-03T08:00:00Z"),
    "Message log": keys.message_log("t1", "2026-03-04", "2026-03-04T08:00:00Z", "m1"),
    "Audit entry": keys.audit_entry("t1", "2026-03-04", "2026-03-04T08:00:00Z", "au1"),
    "Care context": keys.care_context("t1", "a1"),
}

SPEC_ROWS = {entity: (pk, sk, table) for entity, pk, sk, table in spec.KEYS}


def as_regex(pattern: str) -> re.Pattern[str]:
    """Turn a specification pattern such as TENANT#t#APPT#id into a matcher.

    A segment of upper case letters is a literal prefix such as APPT or META.
    Anything else is a placeholder standing for a value: t, id, requestTs,
    yyyy-mm-dd and so on.
    """
    segments = []
    for part in pattern.split("#"):
        literal = bool(part) and part.isalpha() and part.isupper()
        segments.append(re.escape(part) if literal else r"[^#]+")
    return re.compile("^" + "#".join(segments) + "$")


def test_every_specification_row_has_a_builder():
    assert set(SPEC_ROWS) == set(BUILT), {
        "missing builders": sorted(set(SPEC_ROWS) - set(BUILT)),
        "unknown builders": sorted(set(BUILT) - set(SPEC_ROWS)),
    }


@pytest.mark.parametrize("entity", sorted(BUILT))
def test_the_built_key_matches_the_specification_pattern(entity):
    pk_pattern, sk_pattern, _table = SPEC_ROWS[entity]
    built = BUILT[entity]
    assert as_regex(pk_pattern).match(built.pk), f"{entity}: {built.pk} against {pk_pattern}"
    assert as_regex(sk_pattern).match(built.sk), f"{entity}: {built.sk} against {sk_pattern}"


@pytest.mark.parametrize("entity", sorted(BUILT))
def test_tenant_owned_keys_carry_the_tenant_prefix(entity):
    """FR-TEN-01. Only the region pack and the person sit outside a tenant."""
    built = BUILT[entity]
    if entity in ("Region pack", "Person", "Consent record"):
        assert not built.pk.startswith("TENANT#")
    else:
        assert built.pk.startswith("TENANT#t1#") or built.pk == "TENANT#t1"


def test_a_key_renders_as_an_item():
    assert keys.appointment("t1", "a1").as_item() == {
        "pk": "TENANT#t1#APPT#a1",
        "sk": "APPT",
    }


def test_slot_locks_are_one_item_per_unit():
    """ADR 0004: N consecutive units are locked, so each unit is its own item."""
    first = keys.slot_lock("t1", "s1", "2026-03-04T08:00:00Z")
    second = keys.slot_lock("t1", "s1", "2026-03-04T08:10:00Z")
    assert first.pk != second.pk


def test_queue_tickets_sort_by_server_timestamp():
    """Guard SERVER_ASSIGNED_ORDER: the sort key starts with the request time."""
    earlier = keys.queue_ticket("t1", "se1", "2026-03-04T08:00:00Z", "zz")
    later = keys.queue_ticket("t1", "se1", "2026-03-04T08:05:00Z", "aa")
    assert earlier.sk < later.sk
