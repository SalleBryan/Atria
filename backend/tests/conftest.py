"""Shared fixtures.

The table fixture builds the real table from the specification's key and index
design, so a test that passes here is exercising the same shape the CDK
deploys. It runs against moto, not AWS.
"""

from __future__ import annotations

import os

import boto3
import pytest
from moto import mock_aws

from atria.data.audit import AuditLog
from atria.data.repository import Repository
from atria.http import audit

TABLE_NAME = "atria-test-main"

# The indexes the services query. The deployed table carries five; a test only
# needs the ones it reads, and PersonIndex is the one the sign-in path uses.
INDEXES = [
    {
        "IndexName": "PersonIndex",
        "KeySchema": [{"AttributeName": "cognitoSub", "KeyType": "HASH"}],
        "Projection": {"ProjectionType": "ALL"},
    },
    {
        "IndexName": "PatientIndex",
        "KeySchema": [
            {"AttributeName": "patientProfileId", "KeyType": "HASH"},
            {"AttributeName": "startAt", "KeyType": "RANGE"},
        ],
        "Projection": {"ProjectionType": "ALL"},
    },
    {
        "IndexName": "ClinicianIndex",
        "KeySchema": [
            {"AttributeName": "clinicianProfileId", "KeyType": "HASH"},
            {"AttributeName": "startAt", "KeyType": "RANGE"},
        ],
        "Projection": {"ProjectionType": "ALL"},
    },
    {
        "IndexName": "ClinicDayIndex",
        "KeySchema": [
            {"AttributeName": "clinicDay", "KeyType": "HASH"},
            {"AttributeName": "startAt", "KeyType": "RANGE"},
        ],
        "Projection": {"ProjectionType": "ALL"},
    },
    {
        # Sparse: only a bookable clinician profile carries these, which is how
        # a suspended account leaves the directory.
        "IndexName": "DirectoryIndex",
        "KeySchema": [
            {"AttributeName": "directoryKey", "KeyType": "HASH"},
            {"AttributeName": "directorySort", "KeyType": "RANGE"},
        ],
        "Projection": {"ProjectionType": "ALL"},
    },
    {
        "IndexName": "MessageDayIndex",
        "KeySchema": [
            {"AttributeName": "messageDay", "KeyType": "HASH"},
            {"AttributeName": "messageSort", "KeyType": "RANGE"},
        ],
        "Projection": {"ProjectionType": "ALL"},
    },
]

ATTRIBUTES = [
    {"AttributeName": "pk", "AttributeType": "S"},
    {"AttributeName": "sk", "AttributeType": "S"},
    {"AttributeName": "cognitoSub", "AttributeType": "S"},
    {"AttributeName": "patientProfileId", "AttributeType": "S"},
    {"AttributeName": "startAt", "AttributeType": "S"},
    {"AttributeName": "clinicianProfileId", "AttributeType": "S"},
    {"AttributeName": "clinicDay", "AttributeType": "S"},
    {"AttributeName": "directoryKey", "AttributeType": "S"},
    {"AttributeName": "directorySort", "AttributeType": "S"},
    {"AttributeName": "messageDay", "AttributeType": "S"},
    {"AttributeName": "messageSort", "AttributeType": "S"},
]


@pytest.fixture
def aws_credentials(monkeypatch):
    """Make sure no test can reach a real account."""
    for name, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SECURITY_TOKEN": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_DEFAULT_REGION": "us-east-1",
    }.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
def table(aws_credentials):
    with mock_aws():
        dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        created = dynamodb.create_table(
            TableName=TABLE_NAME,
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=ATTRIBUTES,
            GlobalSecondaryIndexes=INDEXES,
            BillingMode="PAY_PER_REQUEST",
        )
        yield created


@pytest.fixture
def repository(table):
    return Repository(table=table)


@pytest.fixture(autouse=True)
def audit_log(request):
    """Every staff request writes an audit entry; in a test, to the test table.

    A test with no table gets a log that keeps entries in memory, so a service
    test built on stubs still records, and can assert on what it recorded.
    """
    if "table" in request.fixturenames:
        log = AuditLog(Repository(table=request.getfixturevalue("table")))
    else:
        log = MemoryAuditLog()
    audit.use(log)
    yield log
    audit.use(None)


class MemoryAuditLog(AuditLog):
    def __init__(self) -> None:
        super().__init__(repository=None)  # type: ignore[arg-type]
        self.written: list[dict] = []

    def record(self, item):
        self.written.append(item)
        return item


@pytest.fixture
def _main_table_env(monkeypatch):
    monkeypatch.setenv("MAIN_TABLE", TABLE_NAME)
    yield
    os.environ.pop("MAIN_TABLE", None)
