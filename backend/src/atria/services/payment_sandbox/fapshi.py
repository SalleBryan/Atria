"""Fapshi sandbox transport. Credentials and raw provider bodies stay here."""

from __future__ import annotations

import http.client
import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import boto3
from atria_spec.payment_sandbox import PROVIDER_STATUSES, SECRET_ENV, TEST_AMOUNT
from botocore.exceptions import BotoCoreError, ClientError

from atria.core.errors import AtriaError

SANDBOX_HOST = "sandbox.fapshi.com"
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
        super().__init__("Fapshi sandbox could not complete the request")


@dataclass(frozen=True, repr=False)
class Credentials:
    api_user: str
    api_key: str
    webhook_secret: str

    @classmethod
    def load(cls) -> Credentials:
        name = os.environ.get(SECRET_ENV)
        if not name:
            raise SandboxUnavailableError("Fapshi sandbox credentials are unavailable")
        try:
            result = boto3.client("secretsmanager").get_secret_value(
                SecretId=name, VersionStage="AWSCURRENT"
            )
            secret = json.loads(result.get("SecretString", ""))
        except (BotoCoreError, ClientError, ValueError):
            raise SandboxUnavailableError("Fapshi sandbox credentials are unavailable") from None

        if not isinstance(secret, dict):
            raise SandboxUnavailableError("Fapshi sandbox credentials are invalid")
        fields = tuple(secret.get(key) for key in ("apiuser", "apikey", "webhookSecret"))
        if not all(
            isinstance(value, str)
            and value
            and value.isascii()
            and value.isprintable()
            and value == value.strip()
            for value in fields
        ):
            raise SandboxUnavailableError("Fapshi sandbox credentials are invalid")
        api_user, api_key, webhook_secret = map(str, fields)
        # Fapshi's SDK uses this prefix to distinguish sandbox keys from live keys.
        if not api_key.startswith("FAK_TEST_") or len(api_key) == len("FAK_TEST_"):
            raise SandboxUnavailableError("Fapshi sandbox requires a test API key")
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
    def verified(cls, data: object, reference: str, expected_id: str | None) -> Transaction:
        if not isinstance(data, dict):
            raise ProviderError()
        trans_id = transaction_id(data.get("transId"))
        status = data.get("status")
        amount = data.get("amount")
        if (
            (expected_id is not None and trans_id != expected_id)
            or data.get("externalId") != reference
            or data.get("userId") != reference
            or data.get("transType") != "Collection"
            or type(amount) is not int
            or amount != TEST_AMOUNT
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
        connection = http.client.HTTPSConnection(SANDBOX_HOST, timeout=5)
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

    def initiate(self, reference: str) -> Checkout:
        data = self._request(
            "POST",
            "/initiate-pay",
            {"amount": TEST_AMOUNT, "externalId": reference, "userId": reference},
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

    def status(self, reference: str, trans_id: str) -> Transaction:
        data = self._request("GET", f"/payment-status/{transaction_id(trans_id)}")
        return Transaction.verified(data, reference, trans_id)

    def recover(self, reference: str) -> Transaction | None:
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
        return Transaction.verified(matches[0], reference, None) if matches else None
