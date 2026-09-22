"""DataStack: the main table, the care context table, and their keys.

The main table is a single table design: every entity shares it under the key
patterns in spec/atria_spec/keys.py, with five indexes. Care context lives in a
separate table under its own customer-managed key with a time to live, because
only the patient and the assigned clinician may read it and it is purged sooner
than booking history (ADR 0006, constraint C-03).
"""

from __future__ import annotations

from typing import Any

from aws_cdk import RemovalPolicy, Stack
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_kms as kms
from constructs import Construct

from atria_infra.config import Environment

# The index definitions come from the specification. Keeping the attribute
# names here rather than in the loop keeps the projection choices visible.
INDEX_KEYS = {
    "PatientIndex": ("patientProfileId", "startAt"),
    "ClinicianIndex": ("clinicianProfileId", "startAt"),
    "ClinicDayIndex": ("clinicDay", "startAt"),
    "PersonIndex": ("cognitoSub", None),
    "OutboxIndex": ("outboxShard", "createdAt"),
}


class DataStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, settings: Environment, **kwargs: Any) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings
        retain = RemovalPolicy.RETAIN if settings.removal_protection else RemovalPolicy.DESTROY

        self.main_key = kms.Key(
            self,
            "MainKey",
            alias=f"{settings.prefix}-main",
            description="Atria main table and booking data",
            enable_key_rotation=True,
            removal_policy=retain,
        )

        # A separate key, so a role that may read bookings still cannot decrypt
        # care context. Only the booking and queue services get grants on it.
        self.care_context_key = kms.Key(
            self,
            "CareContextKey",
            alias=f"{settings.prefix}-care-context",
            description="Atria care context: intake answers and visit reasons",
            enable_key_rotation=True,
            removal_policy=retain,
        )

        self.main_table = dynamodb.TableV2(
            self,
            "MainTable",
            table_name=f"{settings.prefix}-main",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            billing=dynamodb.Billing.on_demand(),
            encryption=dynamodb.TableEncryptionV2.customer_managed_key(self.main_key),
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            # Change capture feeds the FIFO outbox that the notification service
            # reads (ADR 0014). New and old images, so an event can carry the
            # transition rather than just the result.
            dynamo_stream=dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            removal_policy=retain,
            deletion_protection=settings.removal_protection,
        )

        for name, (partition, sort) in INDEX_KEYS.items():
            self.main_table.add_global_secondary_index(
                index_name=name,
                partition_key=dynamodb.Attribute(name=partition, type=dynamodb.AttributeType.STRING),
                sort_key=(
                    dynamodb.Attribute(name=sort, type=dynamodb.AttributeType.STRING) if sort else None
                ),
                projection_type=dynamodb.ProjectionType.ALL,
            )

        self.care_context_table = dynamodb.TableV2(
            self,
            "CareContextTable",
            table_name=f"{settings.prefix}-care-context",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            billing=dynamodb.Billing.on_demand(),
            encryption=dynamodb.TableEncryptionV2.customer_managed_key(self.care_context_key),
            point_in_time_recovery_specification=dynamodb.PointInTimeRecoverySpecification(
                point_in_time_recovery_enabled=True
            ),
            time_to_live_attribute="expiresAt",
            removal_policy=retain,
            deletion_protection=settings.removal_protection,
        )
