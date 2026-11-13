"""Pay an appointment's fee by mobile money through Fapshi; the desk sees that it was paid.

ADR 0023: the payer gives a number, Fapshi prompts that phone, and the amount is the
fee band in force on the visit day whatever the request says. The provider's answer
is checked against it, and the booking table and fee ledger are only read.
"""

from __future__ import annotations

import hashlib
import json
from unittest.mock import Mock

import boto3
import pytest
from atria_spec.payment_sandbox import (
    APPOINTMENT_PAYMENT_PATH,
    REFERENCE_PREFIX,
    SECRET_ENV,
    TABLE_ENV,
)

from atria.data import keys
from atria.services.payment_sandbox import fapshi, handler

TENANT = "t-cm-001"
CLINIC = "c-douala-01"
PATIENT = "pp-1"
ATTEMPT = "0b6f3c2e-6a41-4d0b-9a57-3f4f8f3c1a20"
REFERENCE = REFERENCE_PREFIX + hashlib.sha256(f"{TENANT}:{ATTEMPT}".encode()).hexdigest()
TRANS_ID = "ll7J2fl4"
PROMPTED = {"message": "Request sent", "transId": "ll7J2fl4", "dateInitiated": "2026-11-13"}
SECRET_NAME = "atria/sandbox/fapshi"
CREDENTIALS = {
    "apiuser": "test-api-user",
    "apikey": "FAK_TEST_fixture",
    "webhookSecret": "test-hook",
}

PATIENT_CALLER = {
    "personId": "p-patient",
    "tenantId": TENANT,
    "roles": "PATIENT",
    "patientProfileId": PATIENT,
}
DESK = {
    "personId": "p-rec",
    "tenantId": TENANT,
    "roles": "RECEPTIONIST",
    "staffId": "s-rec-1",
    "clinicId": CLINIC,
}


@pytest.fixture
def world(table, monkeypatch):
    """The main table (conftest) with a priced visit, plus the sandbox's own table."""
    sandbox = boto3.resource("dynamodb", region_name="us-east-1").create_table(
        TableName="isolated-sandbox",
        KeySchema=[
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    monkeypatch.setenv(TABLE_ENV, sandbox.name)
    monkeypatch.setenv("MAIN_TABLE", table.name)
    monkeypatch.setenv(SECRET_ENV, SECRET_NAME)
    boto3.client("secretsmanager", region_name="us-east-1").create_secret(
        Name=SECRET_NAME, SecretString=json.dumps(CREDENTIALS)
    )

    def put(key, item):
        table.put_item(Item={**key.as_item(), **item})

    put(keys.tenant(TENANT), {"type": "TENANT", "tenantId": TENANT, "regionPackCode": "CM"})
    put(
        keys.region_pack("CM"),
        {"type": "REGION_PACK", "timezone": "Africa/Douala", "currency": "XAF"},
    )
    put(
        keys.appointment_type(TENANT, "at-gen"),
        {
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": "at-gen",
            "tenantId": TENANT,
            "feeBandId": "fb-gp",
        },
    )
    put(
        keys.fee_band(TENANT, "fb-gp", "2026-01-01"),
        {
            "type": "FEE_BAND",
            "feeBandId": "fb-gp",
            "tenantId": TENANT,
            "baseAmountMinor": 1500,
            "effectiveFrom": "2026-01-01",
        },
    )
    appointment(put)
    return put


def appointment(put, *, appointment_id="a-1", type_id="at-gen", state="CONFIRMED", patient=PATIENT):
    put(
        keys.appointment(TENANT, appointment_id),
        {
            "type": "APPOINTMENT",
            "appointmentId": appointment_id,
            "tenantId": TENANT,
            "clinicId": CLINIC,
            "patientProfileId": patient,
            "appointmentTypeId": type_id,
            "startAt": "2026-11-20T08:00:00Z",
            "endAt": "2026-11-20T08:30:00Z",
            "state": state,
        },
    )


@pytest.fixture
def provider(monkeypatch):
    http = Mock()
    monkeypatch.setattr(fapshi.http.client, "HTTPSConnection", http)
    return http


def reply(provider, data):
    answer = provider.return_value.getresponse.return_value
    answer.status = 200
    answer.read.return_value = json.dumps(data).encode()


def paid(amount=1500, status="SUCCESSFUL"):
    return {
        "transId": TRANS_ID,
        "externalId": REFERENCE,
        "userId": REFERENCE,
        "amount": amount,
        "status": status,
        "transType": "Collection",
    }


def call(method, caller, *, appointment_id="a-1", body=None):
    result = handler.handler(
        {
            "httpMethod": method,
            "resource": APPOINTMENT_PAYMENT_PATH,
            "pathParameters": {"id": appointment_id},
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": caller},
        },
        None,
    )
    return result["statusCode"], json.loads(result["body"])


def start(caller=PATIENT_CALLER, phone="6 70 00 00 00", **kw):
    return call("POST", caller, body={"attemptId": ATTEMPT, "phone": phone}, **kw)


class TestPayingAnAppointment:
    def test_the_payer_is_prompted_for_exactly_the_visits_fee(self, world, provider):
        reply(provider, PROMPTED)
        code, view = start()
        assert code == 201
        assert (view["amount"], view["currency"], view["status"]) == (1500, "XAF", "PENDING")
        assert view["paid"] is False
        assert view["payerPhone"] == "6.. ... 000"
        sent = json.loads(provider.return_value.request.call_args.args[2])
        assert provider.return_value.request.call_args.args[1] == "/direct-pay"
        assert (sent["amount"], sent["phone"]) == (1500, "670000000")

    def test_the_amount_is_the_fee_whatever_the_request_says(self, world, provider):
        reply(provider, PROMPTED)
        call(
            "POST", PATIENT_CALLER, body={"attemptId": ATTEMPT, "phone": "670000000", "amount": 10}
        )
        sent = json.loads(provider.return_value.request.call_args.args[2])
        assert sent["amount"] == 1500

    def test_a_number_with_the_country_code_is_accepted(self, world, provider):
        reply(provider, PROMPTED)
        start(phone="+237 670 00 00 00")
        sent = json.loads(provider.return_value.request.call_args.args[2])
        assert sent["phone"] == "670000000"

    def test_a_number_that_is_not_a_cameroon_mobile_is_refused(self, world, provider):
        assert start(phone="12345")[0] == 400
        provider.return_value.request.assert_not_called()

    def test_a_prompt_still_waiting_is_not_sent_twice(self, world, provider):
        reply(provider, PROMPTED)
        start()
        reply(provider, paid(status="PENDING"))
        code, _ = call(
            "POST",
            PATIENT_CALLER,
            body={"attemptId": "9d1c0f5e-7b2a-4c3d-8e9f-0a1b2c3d4e5f", "phone": "670000000"},
        )
        assert code == 409

    def test_the_desk_sees_the_full_amount_paid(self, world, provider):
        reply(provider, PROMPTED)
        start()
        reply(provider, paid())
        code, view = call("GET", DESK)
        assert code == 200
        assert view["paid"] is True
        assert (view["status"], view["amount"]) == ("SUCCESSFUL", 1500)

    def test_a_short_payment_is_never_shown_as_paid(self, world, provider):
        reply(provider, PROMPTED)
        start()
        reply(provider, paid(amount=500))
        code, view = call("GET", DESK)
        assert code == 502
        assert "paid" not in view

    def test_before_any_attempt_the_desk_sees_what_is_owed(self, world, provider):
        code, view = call("GET", DESK)
        assert code == 200
        assert (view["status"], view["paid"], view["amount"]) == ("NONE", False, 1500)

    def test_a_paid_visit_is_not_charged_twice(self, world, provider):
        reply(provider, PROMPTED)
        start()
        reply(provider, paid())
        call("GET", PATIENT_CALLER)
        code, _ = call(
            "POST",
            PATIENT_CALLER,
            body={"attemptId": "9d1c0f5e-7b2a-4c3d-8e9f-0a1b2c3d4e5f", "phone": "670000000"},
        )
        assert code == 409

    def test_a_visit_with_no_fee_has_nothing_to_pay(self, world, provider):
        appointment(world, appointment_id="a-free", type_id="at-none")
        code, _ = start(appointment_id="a-free")
        assert code == 409

    def test_a_cancelled_visit_cannot_be_paid(self, world, provider):
        appointment(world, appointment_id="a-gone", state="PATIENT_CANCELLED")
        code, _ = start(appointment_id="a-gone")
        assert code == 409

    def test_another_patient_cannot_pay_or_read_it(self, world, provider):
        other = {**PATIENT_CALLER, "personId": "p-other", "patientProfileId": "pp-other"}
        assert start(other)[0] == 403
        assert call("GET", other)[0] == 403

    def test_desk_staff_of_another_unit_cannot_read_it(self, world, provider):
        elsewhere = {**DESK, "clinicId": "c-other"}
        assert call("GET", elsewhere)[0] == 403

    def test_an_attempt_needs_a_uuid4(self, world, provider):
        code, _ = call(
            "POST", PATIENT_CALLER, body={"attemptId": "not-a-uuid", "phone": "670000000"}
        )
        assert code == 400


class TestEnvironment:
    def test_a_test_key_is_refused_on_live(self, world, provider, monkeypatch):
        monkeypatch.setenv("FAPSHI_HOST", "live.fapshi.com")
        assert start()[0] == 503
        provider.return_value.request.assert_not_called()

    def test_an_unknown_host_is_refused(self, world, provider, monkeypatch):
        monkeypatch.setenv("FAPSHI_HOST", "evil.example.com")
        assert start()[0] == 503
