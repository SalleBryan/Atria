"""Create and reconcile synthetic checkouts in the isolated sandbox table."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
from typing import Any
from uuid import UUID

from atria_spec.payment_sandbox import (
    APPOINTMENT_PAYMENT_PATH,
    CURRENCY,
    PAYMENT_PATH,
    PERMISSION,
    REFERENCE_PREFIX,
    TABLE_ENV,
    TEST_AMOUNT,
    WEBHOOK_HEADER,
    WEBHOOK_PATH,
)

from atria.core import permissions
from atria.core.errors import AtriaError, Conflict, Forbidden, Invalid, NotFound
from atria.data.keys import Key
from atria.data.repository import Item, Repository
from atria.http import requests, responses
from atria.services.payment_sandbox.fapshi import (
    TRANSACTION_ID,
    Credentials,
    Fapshi,
    ProviderError,
    SandboxUnavailableError,
    Transaction,
)

LOG = logging.getLogger(__name__)
PROVIDER_TERMINAL = {"SUCCESSFUL", "EXPIRED"}
TERMINAL = {*PROVIDER_TERMINAL, "INITIATION_REJECTED"}
WEBHOOK_REFERENCE = re.compile(rf"{REFERENCE_PREFIX}[a-f0-9]{{64}}")


def _attempt_id(event: dict[str, Any]) -> str:
    value = requests.path_parameter(event, "id")
    try:
        parsed = UUID(value)
    except ValueError:
        raise Invalid("use a new synthetic UUIDv4 for each checkout") from None
    if parsed.version != 4 or str(parsed) != value:
        raise Invalid("use a new synthetic UUIDv4 for each checkout")
    return value


def _payment_key(tenant_id: str, attempt_id: str) -> Key:
    digest = hashlib.sha256(f"{tenant_id}:{attempt_id}".encode()).hexdigest()
    return Key(f"{REFERENCE_PREFIX}{digest}", "PAYMENT")


def _view(attempt_id: str, row: Item) -> dict[str, object]:
    result = {
        "id": attempt_id,
        "currency": CURRENCY,
        "amount": TEST_AMOUNT,
        "status": row["status"],
    }
    for field in ("transId", "checkoutUrl"):
        if field in row:
            result[field] = row[field]
    return result


def _save(repo: Repository, key: Key, current: Item, fields: Item) -> Item:
    """Apply the observation only to the row version read before the provider call."""
    try:
        return repo.update_existing(
            key,
            set_values={**fields, "version": current["version"] + 1},
            expect=("version", current["version"]),
            what="sandbox payment",
        )
    except Conflict:
        return repo.require(key, what="sandbox payment", consistent=True)


def _create(
    repo: Repository, key: Key, amount: int = TEST_AMOUNT, fields: Item | None = None
) -> tuple[Item, bool]:
    existing = repo.get(key, consistent=True)
    if existing is not None:
        return existing, False
    provider = Fapshi(Credentials.load())
    try:
        current = repo.put_new(
            key,
            {"status": "INITIATING", "version": 1, "amount": amount, **(fields or {})},
            what="sandbox payment",
        )
    except Conflict:
        return repo.require(key, what="sandbox payment", consistent=True), False

    # Fapshi does not deduplicate externalId. Only the conditional insert winner
    # sends the POST, including when callers retry a timed-out request.
    try:
        checkout = provider.initiate(key.pk, amount)
    except ProviderError as exc:
        rejected = exc.provider_status in (400, 401, 403, 429)
        status = "INITIATION_REJECTED" if rejected else "INITIATION_UNKNOWN"
        _save(repo, key, current, {"status": status})
        raise

    saved = _save(
        repo,
        key,
        current,
        {"status": "CREATED", "transId": checkout.trans_id, "checkoutUrl": checkout.url},
    )
    if "checkoutUrl" not in saved:
        # A webhook or recovery read can learn the transaction before the POST returns.
        if saved.get("transId") != checkout.trans_id:
            raise ProviderError()
        repo.set_if_absent(key, "checkoutUrl", checkout.url)
        saved = repo.require(key, what="sandbox payment", consistent=True)
    return saved, True


def _apply(repo: Repository, key: Key, row: Item, transaction: Transaction | None) -> Item:
    if transaction is None:
        return row
    while row["status"] not in TERMINAL:
        if row.get("transId", transaction.trans_id) != transaction.trans_id:
            raise ProviderError()
        if row.get("transId") == transaction.trans_id and row["status"] == transaction.status:
            return row
        row = _save(repo, key, row, {"transId": transaction.trans_id, "status": transaction.status})
        if transaction.status not in PROVIDER_TERMINAL:
            # A racing read may have seen a newer state. A final observation
            # is safe to apply over an intermediate state for the same ID.
            return row
    return row


def _status(repo: Repository, key: Key) -> Item:
    row = repo.require(key, what="sandbox payment", consistent=True)
    if row["status"] in TERMINAL:
        return row
    provider = Fapshi(Credentials.load())
    trans_id = row.get("transId")
    amount = int(row.get("amount", TEST_AMOUNT))
    transaction = (
        provider.status(key.pk, trans_id, amount) if trans_id else provider.recover(key.pk, amount)
    )
    return _apply(repo, key, row, transaction)


def _webhook(event: dict[str, Any], repo: Repository) -> dict[str, Any]:
    supplied = requests.header(event, WEBHOOK_HEADER)
    if not supplied:
        raise Forbidden("Fapshi webhook authentication failed")
    credentials = Credentials.load()
    if not hmac.compare_digest(supplied.encode(), credentials.webhook_secret.encode()):
        raise Forbidden("Fapshi webhook authentication failed")

    body = requests.json_body(event)
    reference = body.get("externalId")
    trans_id = body.get("transId")
    if not isinstance(reference, str) or not WEBHOOK_REFERENCE.fullmatch(reference):
        return responses.ok({"received": True})
    if not isinstance(trans_id, str) or not TRANSACTION_ID.fullmatch(trans_id):
        raise Invalid("the Fapshi webhook transaction ID is invalid")
    key = Key(reference, "PAYMENT")
    row = repo.get(key, consistent=True)
    if (
        row is not None
        and row["status"] not in TERMINAL
        and row.get("transId", trans_id) == trans_id
    ):
        # Treat the webhook as a signal. Only the authenticated status API can
        # supply the state and confirm the identity, type and amount.
        verified = Fapshi(credentials).status(
            reference, trans_id, int(row.get("amount", TEST_AMOUNT))
        )
        _apply(repo, key, row, verified)
    return responses.ok({"received": True})


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        route = (event.get("httpMethod"), event.get("resource"))
        appointment_route = route in {
            ("POST", APPOINTMENT_PAYMENT_PATH),
            ("GET", APPOINTMENT_PAYMENT_PATH),
        }
        if not appointment_route and route not in {
            ("POST", WEBHOOK_PATH),
            ("POST", PAYMENT_PATH),
            ("GET", PAYMENT_PATH),
        }:
            raise NotFound("no such sandbox route")
        table = os.environ.get(TABLE_ENV)
        if not table:
            raise SandboxUnavailableError("the payment sandbox is unavailable")
        repo = Repository(table_name=table)

        if route == ("POST", WEBHOOK_PATH):
            return _webhook(event, repo)
        principal = requests.principal_from(event)
        if appointment_route:
            # Imported here: the appointment flow builds on this module's helpers.
            from atria.services.payment_sandbox import appointment_payment

            return appointment_payment.route(event, repo, principal)
        permissions.require(principal, PERMISSION)
        attempt_id = _attempt_id(event)
        key = _payment_key(principal.tenant_id, attempt_id)
        if route == ("POST", PAYMENT_PATH):
            if event.get("body"):
                raise Invalid("the synthetic checkout takes no request body")
            row, created = _create(repo, key)
            return responses.response(201 if created else 200, _view(attempt_id, row))
        return responses.ok(_view(attempt_id, _status(repo, key)))
    except AtriaError as exc:
        if isinstance(exc, ProviderError):
            LOG.warning("Fapshi sandbox request failed with HTTP status %s", exc.provider_status)
        return responses.error(exc, request_id=getattr(context, "aws_request_id", None))
    except Exception as exc:
        # SDK and HTTP exceptions may include payloads. Log the type only.
        LOG.error("Sandbox request failed (%s)", type(exc).__name__)
        return responses.internal_error(getattr(context, "aws_request_id", None))
