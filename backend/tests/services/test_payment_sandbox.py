"""FR-MSR-07 and ADR 0007: simulated checkouts, isolated from booking and settlement."""

from __future__ import annotations

import hashlib
import json
from unittest.mock import Mock
from uuid import uuid4

import boto3
import pytest
from atria_spec.payment_sandbox import (
    PAYMENT_PATH,
    REFERENCE_PREFIX,
    SECRET_ENV,
    TABLE_ENV,
    TEST_AMOUNT,
    WEBHOOK_PATH,
)
from moto import mock_aws

from atria.services.payment_sandbox import fapshi, handler

ATTEMPT_ID = "c7d02775-dcbf-4ec2-986f-8e91deffbac3"
ADMIN = {
    "tenantId": "synthetic-tenant",
    "personId": "synthetic-admin",
    "roles": "TENANT_ADMIN",
    "secondFactor": "true",
}
REFERENCE = (
    REFERENCE_PREFIX + hashlib.sha256(f"{ADMIN['tenantId']}:{ATTEMPT_ID}".encode()).hexdigest()
)
SECRET_NAME = "atria/sandbox/fapshi"
CREDENTIALS = {
    "apiuser": "test-api-user",
    "apikey": "FAK_TEST_fixture",
    "webhookSecret": "test-webhook-fixture",
}
TRANS_ID = "ll7J2fl4"
CHECKOUT = "https://checkout.fapshi.com/payment/test"
INITIATED = {"transId": TRANS_ID, "link": CHECKOUT}


@pytest.fixture
def sandbox(aws_credentials, monkeypatch):
    with mock_aws():
        table = boto3.resource("dynamodb").create_table(
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
        monkeypatch.setenv(TABLE_ENV, table.name)
        monkeypatch.setenv(SECRET_ENV, SECRET_NAME)
        boto3.client("secretsmanager").create_secret(
            Name=SECRET_NAME, SecretString=json.dumps(CREDENTIALS)
        )
        yield table


@pytest.fixture
def provider(monkeypatch):
    http = Mock()
    monkeypatch.setattr(fapshi.http.client, "HTTPSConnection", http)
    return http


def reply(provider, data, *, code=200):
    http = provider.return_value.getresponse.return_value
    http.status = code
    http.read.return_value = json.dumps(data).encode()


def invoke(method, *, attempt_id=ATTEMPT_ID, body=None, principal=ADMIN):
    return handler.handler(
        {
            "httpMethod": method,
            "resource": PAYMENT_PATH,
            "pathParameters": {"id": attempt_id},
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": principal},
        },
        None,
    )


def view(result):
    return json.loads(result["body"])


def transaction(status="SUCCESSFUL", **fields):
    return {
        "transId": TRANS_ID,
        "externalId": REFERENCE,
        "userId": REFERENCE,
        "amount": TEST_AMOUNT,
        "status": status,
        "transType": "Collection",
        "payerName": "Synthetic Name",
        **fields,
    }


def webhook(secret=CREDENTIALS["webhookSecret"], **fields):
    return handler.handler(
        {
            "httpMethod": "POST",
            "resource": WEBHOOK_PATH,
            "headers": {"X-WH-Secret": secret},
            "body": json.dumps(transaction(**fields)),
        },
        None,
    )


def test_create_checkout_uses_fixed_synthetic_fields_and_replays(sandbox, provider):
    reply(provider, INITIATED)
    result = invoke("POST")
    assert result["statusCode"] == 201
    assert view(result) == {
        "id": ATTEMPT_ID,
        "amount": TEST_AMOUNT,
        "currency": "XAF",
        "status": "CREATED",
        "transId": TRANS_ID,
        "checkoutUrl": CHECKOUT,
    }
    provider.assert_called_once_with("sandbox.fapshi.com", timeout=5)
    method, path, body, headers = provider.return_value.request.call_args.args
    assert (method, path) == ("POST", "/initiate-pay")
    assert json.loads(body) == {"amount": TEST_AMOUNT, "externalId": REFERENCE, "userId": REFERENCE}
    assert headers["apiuser"] == CREDENTIALS["apiuser"]
    assert headers["apikey"] == CREDENTIALS["apikey"]
    assert headers["Content-Type"] == "application/json"
    assert invoke("POST")["statusCode"] == 200
    assert provider.return_value.request.call_count == 1
    assert sandbox.scan()["Count"] == 1


def test_concurrent_creation_replays_the_reserved_attempt(sandbox, provider):
    reply(provider, INITIATED)

    def concurrent_request(*args):
        assert view(invoke("POST"))["status"] == "INITIATING"

    provider.return_value.request.side_effect = concurrent_request
    assert invoke("POST")["statusCode"] == 201
    assert provider.return_value.request.call_count == 1


def test_missing_credentials_and_live_key_fail_closed(sandbox, provider, monkeypatch):
    monkeypatch.delenv(SECRET_ENV)
    assert invoke("POST")["statusCode"] == 503
    monkeypatch.setenv(SECRET_ENV, SECRET_NAME)
    boto3.client("secretsmanager").put_secret_value(
        SecretId=SECRET_NAME, SecretString=json.dumps({**CREDENTIALS, "apikey": "FAK_live_fixture"})
    )
    assert invoke("POST")["statusCode"] == 503
    assert sandbox.scan()["Count"] == 0
    provider.assert_not_called()


def test_rejects_patient_fields_and_appointment_ids(sandbox, provider):
    assert invoke("POST", body={"appointmentId": "real-appointment"})["statusCode"] == 400
    assert invoke("POST", attempt_id="appointment-123")["statusCode"] == 400
    assert invoke("GET", attempt_id=str(uuid4()))["statusCode"] == 404
    assert sandbox.scan()["Count"] == 0
    provider.assert_not_called()


@pytest.mark.parametrize("principal", [None, {"roles": "PATIENT"}, {"secondFactor": "false"}])
def test_requires_a_tenant_admin_with_second_factor(sandbox, provider, principal):
    context = {**ADMIN, **principal} if principal is not None else None
    for method in ("POST", "GET"):
        assert invoke(method, principal=context)["statusCode"] == (403 if context else 401)
    assert sandbox.scan()["Count"] == 0
    provider.assert_not_called()


def test_another_tenant_cannot_read_the_same_attempt_id(sandbox, provider):
    reply(provider, INITIATED)
    assert invoke("POST")["statusCode"] == 201
    assert invoke("GET", principal={**ADMIN, "tenantId": "other-tenant"})["statusCode"] == 404
    provider.assert_called_once()


def test_timeout_recovers_by_reference_and_never_reposts(sandbox, provider):
    http = provider.return_value
    http.getresponse.side_effect = TimeoutError
    assert invoke("POST")["statusCode"] == 502
    assert view(invoke("POST"))["status"] == "INITIATION_UNKNOWN"
    http.getresponse.side_effect = None
    reply(provider, {"message": "Unknown user"}, code=404)
    assert view(invoke("GET"))["status"] == "INITIATION_UNKNOWN"
    reply(provider, [transaction("PENDING", externalId="another-attempt"), transaction("PENDING")])
    result = view(invoke("GET"))
    assert http.request.call_args.args[:3] == ("GET", f"/transaction/{REFERENCE}", None)
    assert result["status"] == "PENDING"
    assert result["transId"] == TRANS_ID
    assert "checkoutUrl" not in result
    assert view(invoke("POST")) == result
    assert [call.args[0] for call in http.request.call_args_list] == ["POST", "GET", "GET"]


@pytest.mark.parametrize("code", [400, 403, 429, 500, 302])
def test_create_errors_are_sanitized_and_never_reposted(sandbox, provider, code):
    reply(provider, {"message": "provider-private-error"}, code=code)
    result = invoke("POST")
    assert result["statusCode"] == (429 if code == 429 else 502)
    assert "provider-private-error" not in result["body"]
    expected = "INITIATION_REJECTED" if code in (400, 403, 429) else "INITIATION_UNKNOWN"
    assert view(invoke("POST"))["status"] == expected
    assert provider.return_value.request.call_count == 1


@pytest.mark.parametrize(
    "link", ["http://checkout.fapshi.com/pay", "https://checkout.fapshi.com.evil.test/pay"]
)
def test_rejects_unsafe_checkout_url(sandbox, provider, link):
    reply(provider, {**INITIATED, "link": link})
    assert invoke("POST")["statusCode"] == 502
    assert "checkoutUrl" not in view(invoke("POST"))


@pytest.mark.parametrize("code", [400, 404, 429])
def test_status_http_errors_leave_existing_checkout_intact(sandbox, provider, code):
    reply(provider, INITIATED)
    invoke("POST")
    reply(provider, {"message": "provider-private-error"}, code=code)
    result = invoke("GET")
    assert result["statusCode"] == (429 if code == 429 else 502)
    assert view(invoke("POST"))["status"] == "CREATED"
    assert "provider-private-error" not in result["body"]


def test_webhook_checks_secret_and_requeries_before_recording_success(sandbox, provider):
    reply(provider, INITIATED)
    invoke("POST")
    assert webhook(secret=None)["statusCode"] == 403
    assert webhook(secret="wrong")["statusCode"] == 403
    assert webhook(externalId=f"{REFERENCE_PREFIX}{'0' * 64}")["statusCode"] == 200
    assert webhook(transId="another-id")["statusCode"] == 200
    assert provider.return_value.request.call_count == 1

    reply(provider, transaction("FAILED"))
    assert webhook(status="SUCCESSFUL")["statusCode"] == 200
    assert view(invoke("POST"))["status"] == "FAILED"

    reply(provider, transaction())
    assert webhook(status="FAILED")["statusCode"] == 200
    assert provider.return_value.request.call_args.args[:3] == (
        "GET",
        f"/payment-status/{TRANS_ID}",
        None,
    )
    assert view(invoke("GET"))["status"] == "SUCCESSFUL"
    assert webhook()["statusCode"] == 200
    assert provider.return_value.request.call_count == 3
    assert "payerName" not in sandbox.scan()["Items"][0]


@pytest.mark.parametrize(
    "fields",
    [
        {"amount": 501},
        {"transType": "Payout"},
        {"externalId": "other-reference"},
        {"userId": "other-user"},
        {"transId": "another-id"},
        {"status": "NOT_A_STATUS"},
    ],
)
def test_webhook_cannot_apply_mismatched_provider_status(sandbox, provider, fields):
    reply(provider, INITIATED)
    invoke("POST")
    reply(provider, transaction(**fields))
    assert webhook()["statusCode"] == 502
    assert view(invoke("POST"))["status"] == "CREATED"


def test_status_read_recovers_an_expired_payment_without_a_webhook(sandbox, provider):
    reply(provider, INITIATED)
    invoke("POST")
    reply(provider, transaction("EXPIRED"))
    assert view(invoke("GET"))["status"] == "EXPIRED"
    assert view(invoke("GET"))["status"] == "EXPIRED"
    assert provider.return_value.request.call_count == 2


def test_final_webhook_survives_a_racing_intermediate_status_read(sandbox, provider):
    reply(provider, INITIATED)
    invoke("POST")
    http = provider.return_value

    def concurrent_status():
        http.getresponse.side_effect = None
        reply(provider, transaction("PENDING"))
        assert view(invoke("GET"))["status"] == "PENDING"
        reply(provider, transaction("SUCCESSFUL"))
        return http.getresponse.return_value

    http.getresponse.side_effect = concurrent_status
    assert webhook()["statusCode"] == 200
    assert view(invoke("POST"))["status"] == "SUCCESSFUL"
