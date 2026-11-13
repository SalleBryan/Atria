"""Fapshi transport. Credentials and raw provider bodies stay here.

The host is the deployment's (`FAPSHI_HOST`): the sandbox in development, live in
production, the way the SMS sender is configured per environment. Credentials must
match it: a test key for the sandbox, a live key for live.
"""

from __future__ import annotations

import http.client
import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import boto3
from atria_spec.payment_sandbox import HOST_ENV, HOSTS, PROVIDER_STATUSES, SECRET_ENV, TEST_AMOUNT
from botocore.exceptions import BotoCoreError, ClientError

from atria.core.errors import AtriaError, Invalid

SANDBOX_HOST = "sandbox.fapshi.com"
# A Cameroon mobile number as Fapshi takes it: nine digits starting with 6.
MOBILE = re.compile(r"6\d{8}")
MEDIUMS = ("mobile money", "orange money")


def host() -> str:
    """The Fapshi environment this deployment uses."""
    chosen = os.environ.get(HOST_ENV, SANDBOX_HOST)
    if chosen not in HOSTS:
        raise SandboxUnavailableError("the payment provider is not configured")
    return chosen


def mobile_number(value: object) -> str:
    """A payer's number as Fapshi wants it, from what a person types.

    Spaces, dots and dashes are dropped, and a +237 or 237 prefix is taken off.
    """
    digits = re.sub(r"[\s.\-()]", "", str(value or ""))
    if digits.startswith("+237"):
        digits = digits[4:]
    elif digits.startswith("237") and len(digits) == 12:
        digits = digits[3:]
    if not MOBILE.fullmatch(digits):
        raise Invalid("enter a Cameroon mobile number, like 6 70 00 00 00")
    return digits


def masked(phone: str) -> str:
    """What may be shown or stored of a payer's number: its last three digits."""
    return f"6.. ... {phone[-3:]}"


TRANSACTION_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")
MAX_RESPONSE_BYTES = 64 * 1024


class SandboxUnavailableError(AtriaError):
    status = 503
    code = "sandbox_unavailable"


class ProviderError(AtriaError):
    status = 502
    code = "fapshi_error"

    def __init__(self, provider_status: int | None = None) -> None:
        self.provider_status = provider_status
        if provider_status == 429:
            self.status = 429
            self.code = "fapshi_rate_limited"
        super().__init__("the payment provider could not complete the request")


@dataclass(frozen=True, repr=False)
class Credentials:
    api_user: str
    api_key: str
    webhook_secret: str

    @classmethod
    def load(cls) -> Credentials:
        name = os.environ.get(SECRET_ENV)
        if not name:
            raise SandboxUnavailableError("Fapshi payment credentials are unavailable")
        try:
            result = boto3.client("secretsmanager").get_secret_value(
                SecretId=name, VersionStage="AWSCURRENT"
            )
            secret = json.loads(result.get("SecretString", ""))
        except (BotoCoreError, ClientError, ValueError):
            raise SandboxUnavailableError("Fapshi payment credentials are unavailable") from None

        if not isinstance(secret, dict):
            raise SandboxUnavailableError("Fapshi payment credentials are invalid")
        fields = tuple(secret.get(key) for key in ("apiuser", "apikey", "webhookSecret"))
        if not all(
            isinstance(value, str)
            and value
            and value.isascii()
            and value.isprintable()
            and value == value.strip()
            for value in fields
        ):
            raise SandboxUnavailableError("Fapshi payment credentials are invalid")
        api_user, api_key, webhook_secret = map(str, fields)
        # Fapshi's SDK uses this prefix to distinguish sandbox keys from live keys:
        # a test key only on the sandbox, a live key only on live.
        test_key = api_key.startswith("FAK_TEST_") and len(api_key) > len("FAK_TEST_")
        if test_key != (host() == SANDBOX_HOST):
            raise SandboxUnavailableError("the Fapshi key does not match this environment")
        return cls(api_user, api_key, webhook_secret)


def transaction_id(value: object) -> str:
    if not isinstance(value, str) or not TRANSACTION_ID.fullmatch(value):
        raise ProviderError()
    return value


@dataclass(frozen=True, slots=True)
class Checkout:
    trans_id: str
    url: str


@dataclass(frozen=True, slots=True)
class Transaction:
    trans_id: str
    status: str

    @classmethod
    def verified(
        cls, data: object, reference: str, expected_id: str | None, amount: int = TEST_AMOUNT
    ) -> Transaction:
        if not isinstance(data, dict):
            raise ProviderError()
        trans_id = transaction_id(data.get("transId"))
        status = data.get("status")
        paid = data.get("amount")
        if (
            (expected_id is not None and trans_id != expected_id)
            or data.get("externalId") != reference
            or data.get("userId") != reference
            or data.get("transType") != "Collection"
            or type(paid) is not int
            or paid != amount
            or status not in PROVIDER_STATUSES
        ):
            raise ProviderError()
        return cls(trans_id, str(status))


class Fapshi:
    def __init__(self, credentials: Credentials) -> None:
        self._credentials = credentials

    def _request(self, method: str, path: str, payload: dict[str, object] | None = None) -> Any:
        headers = {
            "apiuser": self._credentials.api_user,
            "apikey": self._credentials.api_key,
            "Accept": "application/json",
        }
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        # A fixed HTTPS origin, no redirects and no transport retries.
        connection = http.client.HTTPSConnection(host(), timeout=5)
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            if response.status != 200:
                raise ProviderError(response.status)
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ProviderError()
            return json.loads(raw)
        except (OSError, http.client.HTTPException, ValueError):
            raise ProviderError() from None
        finally:
            connection.close()

    def initiate(self, reference: str, amount: int = TEST_AMOUNT) -> Checkout:
        data = self._request(
            "POST",
            "/initiate-pay",
            {"amount": amount, "externalId": reference, "userId": reference},
        )
        if not isinstance(data, dict):
            raise ProviderError()
        link = data.get("link")
        if not isinstance(link, str) or not link.isascii() or any(char.isspace() for char in link):
            raise ProviderError()
        try:
            url = urlsplit(link)
            host = url.hostname or ""
            if (
                url.scheme != "https"
                or not (host == "fapshi.com" or host.endswith(".fapshi.com"))
                or host == "live.fapshi.com"
                or url.port not in (None, 443)
                or url.username is not None
                or not url.path
                or chr(92) in link
                or not link.isprintable()
            ):
                raise ProviderError()
        except ValueError:
            raise ProviderError() from None
        return Checkout(transaction_id(data.get("transId")), link)

    def direct_pay(self, reference: str, amount: int, phone: str, message: str) -> str:
        """Send a payment prompt to the payer's phone for exactly this amount.

        Fapshi keeps no idempotency key: a repeated request sends a second prompt.
        The caller sends this once per attempt and recovers a lost answer by
        reference (`recover`), never by sending again.
        """
        data = self._request(
            "POST",
            "/direct-pay",
            {
                "amount": amount,
                "phone": phone,
                "userId": reference,
                "externalId": reference,
                "message": message,
            },
        )
        if not isinstance(data, dict):
            raise ProviderError()
        return transaction_id(data.get("transId"))

    def status(self, reference: str, trans_id: str, amount: int = TEST_AMOUNT) -> Transaction:
        data = self._request("GET", f"/payment-status/{transaction_id(trans_id)}")
        return Transaction.verified(data, reference, trans_id, amount)

    def recover(self, reference: str, amount: int = TEST_AMOUNT) -> Transaction | None:
        try:
            data = self._request("GET", f"/transaction/{reference}")
        except ProviderError as exc:
            if exc.provider_status == 404:
                return None
            raise
        if not isinstance(data, list):
            raise ProviderError()
        matches = [
            row for row in data if isinstance(row, dict) and row.get("externalId") == reference
        ]
        if len(matches) > 1:
            raise ProviderError()
        return Transaction.verified(matches[0], reference, None, amount) if matches else None
