"""AsyncStack: the outbox, and the one thing that sends.

Change capture on the main table feeds a FIFO outbox queue, and a sender reads
that queue and talks to SES (ADR 0014). Two pieces rather than one because the
boundary between them is a durable queue: a booking that committed cannot then
fail to notify, and a provider that is refusing cannot lose the notice.

Every queue has a dead letter queue, so a message that cannot be handled after
its retries is parked where it can be looked at and redriven rather than
disappearing.

The scheduled reminder path joins the same outbox queue when it lands, which is
why the sender reads a job rather than an appointment event.
"""

from __future__ import annotations

import pathlib
from typing import Any

from aws_cdk import Duration, Stack
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_lambda_event_sources as sources
from aws_cdk import aws_sqs as sqs
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.platform import PlatformStack, service_function

# A notice that has failed this many times is not going to succeed by being
# tried again in the same shape. Parking it keeps the queue moving.
MAX_ATTEMPTS = 5


class AsyncStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        data: DataStack,
        platform: PlatformStack,
        build_dir: pathlib.Path,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings
        self.build_dir = build_dir
        self.layer = platform.layer

        common_environment = {
            "POWERTOOLS_SERVICE_NAME": "atria",
            "POWERTOOLS_LOG_LEVEL": "INFO",
            "ENVIRONMENT": settings.name,
            "MAIN_TABLE": data.main_table.table_name,
        }

        # Two failure queues, because AWS pulls the two failure paths in
        # opposite directions. A FIFO queue's dead letter queue must itself be
        # FIFO, while a stream consumer's on-failure destination must not be.
        # One queue cannot be both.
        self.outbox_dead_letters = sqs.Queue(
            self,
            "OutboxDeadLetters",
            queue_name=f"{settings.prefix}-outbox-dlq.fifo",
            fifo=True,
            encryption=sqs.QueueEncryption.KMS_MANAGED,
            retention_period=Duration.days(14),
            enforce_ssl=True,
        )
        # What lands here is not the change itself but a pointer to the shard
        # and sequence range that could not be dispatched, which is enough to
        # find and replay it.
        self.stream_failures = sqs.Queue(
            self,
            "StreamFailures",
            queue_name=f"{settings.prefix}-stream-failures",
            encryption=sqs.QueueEncryption.KMS_MANAGED,
            retention_period=Duration.days(14),
            enforce_ssl=True,
        )

        # FIFO and grouped by appointment, so a booking and the cancellation
        # that follows it cannot be sent out of order. Content based
        # deduplication is off because the dispatcher supplies the stream
        # record identifier, which is a better key than the body: two genuine
        # notices for one appointment can have identical bodies.
        self.outbox = sqs.Queue(
            self,
            "Outbox",
            queue_name=f"{settings.prefix}-outbox.fifo",
            fifo=True,
            content_based_deduplication=False,
            encryption=sqs.QueueEncryption.KMS_MANAGED,
            enforce_ssl=True,
            # Longer than the sender's timeout, or a slow send would be
            # delivered a second time while the first was still running.
            visibility_timeout=Duration.seconds(180),
            retention_period=Duration.days(4),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=MAX_ATTEMPTS, queue=self.outbox_dead_letters
            ),
        )

        self.dispatcher = service_function(
            self,
            "OutboxDispatcher",
            settings=settings,
            build_dir=build_dir,
            layer=self.layer,
            handler="atria.services.notify.outbox.handler",
            description="Reads the table's change stream and fills the notice outbox",
            environment={**common_environment, "OUTBOX_QUEUE_URL": self.outbox.queue_url},
            timeout_seconds=30,
        )
        self.outbox.grant_send_messages(self.dispatcher)
        # It reads the stream and decides; it never reads or writes the table.
        data.main_table.grant_stream_read(self.dispatcher)
        self.dispatcher.add_event_source(
            sources.DynamoEventSource(
                data.main_table,
                # LATEST, not TRIM_HORIZON. The stream holds 24 hours, so
                # starting at the horizon would replay yesterday's changes on
                # every first deploy and send a confirmation for a booking the
                # patient was told about a day ago. A notice is only worth
                # sending about something that just happened.
                starting_position=lambda_.StartingPosition.LATEST,
                batch_size=25,
                max_batching_window=Duration.seconds(10),
                # One bad record is retried and parked on its own rather than
                # blocking the shard behind it.
                report_batch_item_failures=True,
                retry_attempts=3,
                on_failure=sources.SqsDlq(self.stream_failures),
            )
        )

        self.sender = service_function(
            self,
            "NoticeSender",
            settings=settings,
            build_dir=build_dir,
            layer=self.layer,
            handler="atria.services.notify.sender.handler",
            description="Composes a notice from fresh records, sends it and logs it",
            environment={
                **common_environment,
                "NOTICE_SENDER": settings.notice_sender,
            },
            timeout_seconds=60,
        )
        # It reads the appointment, the patient and the clinic, and writes the
        # message log, so it needs both directions on the one table.
        data.main_table.grant_read_write_data(self.sender)
        self.sender.add_event_source(
            sources.SqsEventSource(
                self.outbox,
                # One at a time: SES in the sandbox allows one message a
                # second, and a batch would be throttled into retries.
                batch_size=1,
                # Messages for different appointments sit in different FIFO
                # groups, so without a cap the queue would drive many senders
                # at once and burst past that limit. Capped here rather than
                # by reserving concurrency, because the development account's
                # limit is 10 and AWS keeps all 10 unreserved: reserving any
                # would fail the deploy. Two is the lowest value allowed.
                max_concurrency=2,
                report_batch_item_failures=True,
            )
        )
        # Scoped to sending, and to the one verified identity. Nothing here
        # may verify an address, read the account's reputation or change a
        # configuration set.
        self.sender.add_to_role_policy(
            iam.PolicyStatement(
                actions=["ses:SendEmail"],
                resources=[
                    self.format_arn(
                        service="ses",
                        resource="identity",
                        resource_name=settings.notice_sender,
                    )
                ],
            )
        )
