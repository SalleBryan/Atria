# ruff: noqa: F401, F811  the wired fixture is imported, and pytest passes it by name
"""Deleting accounts with 30 days to restore them (2026-09-29).

A patient deletes their own account and can take it back; an administrator
deletes a patient's or a staff account and restores it; after 30 days the
purge erases the sign-in and the personal details, and keeps the visits.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest
from test_appointment_cancel import (
    DOUALA,
    NOW,
    PATIENT,
    TENANT,
    book,
    patient_context,
    wired,
)

from atria.data import keys
from atria.data.deletions import Deletions
from atria.data.people import People
from atria.data.register import Register, entries
from atria.services.booking import appointments as booking_service
from atria.services.identity import deletion, purge
from atria.services.identity import handler as identity
from atria.services.identity import staff as staff_service

pytestmark = pytest.mark.usefixtures("table")

ADMIN = {"personId": "p-admin", "tenantId": TENANT, "roles": "TENANT_ADMIN", "staffId": "s-admin"}


class FakePool:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def list_users(self, **kwargs):
        sub = kwargs["Filter"].split('"')[1]
        return {"Users": [{"Username": f"user-{sub}"}]}

    def __getattr__(self, name):
        def record(**kwargs):
            self.calls.append((name, kwargs.get("Username", "")))
            return {}

        return record


@pytest.fixture
def world(wired, monkeypatch):
    repository, clinician = wired
    people = People(repository)
    pool = FakePool()
    monkeypatch.setattr(deletion, "cognito", lambda: pool)
    monkeypatch.setattr(deletion, "USER_POOL_ID", "pool-1")
    monkeypatch.setattr(purge, "cognito", lambda: pool)
    monkeypatch.setattr(purge, "USER_POOL_ID", "pool-1")
    monkeypatch.setattr(identity, "_people", people)
    monkeypatch.setattr(staff_service, "_people", people)
    monkeypatch.setattr(purge, "_people", people)
    repository.put(
        keys.person("p-patient"),
        {
            "type": "PERSON",
            "personId": "p-patient",
            "cognitoSub": "sub-amina",
            "givenName": "Amina",
            "familyName": "Ngo",
            "email": "amina@example.com",
            "phoneE164": "+12025550142",
            "patientProfiles": [{"tenantId": TENANT, "patientProfileId": PATIENT}],
        },
    )
    repository.put(
        keys.patient_profile(TENANT, PATIENT),
        {
            "type": "PATIENT_PROFILE",
            "patientProfileId": PATIENT,
            "tenantId": TENANT,
            "personId": "p-patient",
        },
    )
    Register(repository).replace(
        TENANT,
        PATIENT,
        entries(
            tenant_id=TENANT,
            patient_profile_id=PATIENT,
            person_id="p-patient",
            given_name="Amina",
            family_name="Ngo",
            phone_e164="+12025550142",
            patient_number="RHB-000001",
        ),
    )
    return repository, clinician, pool


def call(handler, method, resource, context, path=None):
    return handler(
        {
            "httpMethod": method,
            "resource": resource,
            "pathParameters": path,
            "requestContext": {"authorizer": context},
        },
        None,
    )


def body_of(result):
    return json.loads(str(result["body"]))


class TestAPatientDeletesTheirAccount:
    def test_it_waits_30_days_and_frees_their_visits(self, world):
        repository, clinician, pool = world
        visit = book(clinician)
        found = body_of(call(identity.handler, "DELETE", "/me", patient_context()))
        assert found["by"] == "SELF"
        assert found["cancelledVisits"] == 1
        assert found["graceDays"] == 30
        assert (
            "CANCELLED" in repository.get(keys.appointment(TENANT, visit["appointmentId"]))["state"]
        )
        # Signed out, but not locked out: they may come back and restore it.
        assert ("admin_user_global_sign_out", "user-sub-amina") in pool.calls
        assert not any(name == "admin_disable_user" for name, _ in pool.calls)
        me = body_of(call(identity.handler, "GET", "/me", patient_context()))
        assert me["deletion"]["by"] == "SELF"

    def test_the_desk_no_longer_finds_them(self, world):
        call(identity.handler, "DELETE", "/me", patient_context())
        (entry,) = [
            e for e in Register(world[0]).entries_of(TENANT, PATIENT) if e["sk"].startswith("NUM#")
        ]
        assert entry["deletionPurgeAt"]

    def test_they_take_it_back(self, world):
        call(identity.handler, "DELETE", "/me", patient_context())
        assert call(identity.handler, "POST", "/me/restore", patient_context())["statusCode"] == 200
        me = body_of(call(identity.handler, "GET", "/me", patient_context()))
        assert me["deletion"] is None
        assert Deletions(world[0]).due(NOW + dt.timedelta(days=31)) == []

    def test_a_deleted_account_books_nothing(self, world):
        _repo, clinician, _pool = world
        call(identity.handler, "DELETE", "/me", patient_context())
        with pytest.raises(AssertionError):
            book(clinician, start="2026-03-05T08:00:00Z")


class TestAnAdministratorDeletesAPatient:
    def test_the_sign_in_is_disabled_and_can_be_restored(self, world):
        _repo, _clinician, pool = world
        path = {"id": PATIENT}
        found = call(staff_service.handler, "DELETE", "/admin/patients/{id}", ADMIN, path)
        assert body_of(found)["by"] == "ADMIN"
        assert ("admin_disable_user", "user-sub-amina") in pool.calls
        # The patient cannot undo the hospital's deletion themselves.
        assert call(identity.handler, "POST", "/me/restore", patient_context())["statusCode"] == 409
        restored = call(staff_service.handler, "POST", "/admin/patients/{id}/restore", ADMIN, path)
        assert restored["statusCode"] == 200
        assert ("admin_enable_user", "user-sub-amina") in pool.calls

    def test_only_an_administrator(self, world):
        path = {"id": PATIENT}
        desk = {**ADMIN, "roles": "RECEPTIONIST", "clinicId": DOUALA}
        result = call(staff_service.handler, "DELETE", "/admin/patients/{id}", desk, path)
        assert result["statusCode"] == 403


class TestAnAdministratorDeletesStaff:
    def test_the_account_waits_and_comes_back_as_it_was(self, world):
        repository, clinician, pool = world
        path = {"id": clinician}
        found = call(staff_service.handler, "DELETE", "/admin/staff/{id}", ADMIN, path)
        assert found["statusCode"] == 200, found
        assert repository.get(keys.staff_membership(TENANT, clinician))["status"] == (
            "DELETION_PENDING"
        )
        assert any(name == "admin_disable_user" for name, _ in pool.calls)
        restored = call(staff_service.handler, "POST", "/admin/staff/{id}/restore", ADMIN, path)
        assert restored["statusCode"] == 200
        assert repository.get(keys.staff_membership(TENANT, clinician))["status"] != (
            "DELETION_PENDING"
        )

    def test_an_administrator_cannot_delete_themselves(self, world):
        mine = {**ADMIN, "staffId": world[1]}
        result = call(staff_service.handler, "DELETE", "/admin/staff/{id}", mine, {"id": world[1]})
        assert result["statusCode"] in (400, 403)


class TestThePurge:
    def test_nothing_goes_before_30_days(self, world):
        call(identity.handler, "DELETE", "/me", patient_context())
        assert purge.purge(NOW + dt.timedelta(days=29)) == {"purged": 0, "failed": 0}

    def test_after_30_days_the_person_is_erased_and_the_visits_kept(self, world):
        repository, clinician, pool = world
        visit = book(clinician)
        call(identity.handler, "DELETE", "/me", patient_context())
        assert purge.purge(dt.datetime.now(tz=dt.UTC) + dt.timedelta(days=31)) == {
            "purged": 1,
            "failed": 0,
        }
        person = repository.get(keys.person("p-patient"))
        assert person["givenName"] == "Deleted"
        assert "email" not in person and "phoneE164" not in person and "cognitoSub" not in person
        assert Register(repository).entries_of(TENANT, PATIENT) == []
        assert repository.get(keys.appointment(TENANT, visit["appointmentId"]))
        assert ("admin_delete_user", "user-sub-amina") in pool.calls
