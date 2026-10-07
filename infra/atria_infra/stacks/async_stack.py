"""AsyncStack: the outbox, and the one thing that sends.

Change capture on the main table feeds a FIFO outbox queue, and a sender reads
that queue and talks to SES (ADR 0014). Two pieces rather than one because the
boundary between them is a durable queue: a booking that committed cannot then
fail to notify, and a provider that is refusing cannot lose the notice.

Every queue has a dead letter queue, so a message that cannot be handled after
its retries is parked where it can be looked at and redriven rather than
disappearing.

Reminders join the same outbox. The sender creates a one-time EventBridge
schedule per booking, and at the fire time the schedule puts the reminder job
on the outbox, where the sender picks it up like any other.

What becomes of a message after the provider accepts it comes back on two
paths into one status function (FR-MSG-04): SES events through the notices'
configuration set to EventBridge, and SNS delivery logs for SMS through
CloudWatch Logs.
"""

from __future__ import annotations

import pathlib
from typing import Any

from aws_cdk import ArnFormat, Duration, RemovalPolicy, Stack
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_lambda_event_sources as sources
from aws_cdk import aws_logs as logs
from aws_cdk import aws_logs_destinations as log_destinations
from aws_cdk import aws_scheduler as scheduler
from aws_cdk import aws_ses as ses
from aws_cdk import aws_sqs as sqs
from aws_cdk import custom_resources as cr
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.platform import PlatformStack, grant_table_write, grant_vapid, service_function

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
        self.layer = platform.layer_in(self)

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
        # deduplication is on because EventBridge Scheduler, which puts
        # reminders here, has no way to supply a deduplication id, and a FIFO
        # queue refuses a message with neither. The dispatcher still supplies
        # its own ids, and an explicit id takes precedence over the body, so
        # two genuine notices with identical bodies are not merged.
        self.outbox = sqs.Queue(
            self,
            "Outbox",
            queue_name=f"{settings.prefix}-outbox.fifo",
            fifo=True,
            content_based_deduplication=True,
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

        # Where a reminder goes if the scheduler cannot deliver it to the
        # outbox within the hour. Standard, because a scheduler's dead letter
        # queue may not be FIFO.
        self.reminder_failures = sqs.Queue(
            self,
            "ReminderFailures",
            queue_name=f"{settings.prefix}-reminder-failures",
            encryption=sqs.QueueEncryption.KMS_MANAGED,
            retention_period=Duration.days(14),
            enforce_ssl=True,
        )

        self.reminder_group = scheduler.CfnScheduleGroup(
            self, "ReminderGroup", name=f"{settings.prefix}-reminders"
        )

        # What the scheduler acts as when a reminder fires. It can put a job
        # on the outbox and park one that fails, and nothing else: it never
        # sees the table, the patient or a provider.
        self.scheduler_role = iam.Role(
            self,
            "ReminderSchedulerRole",
            assumed_by=iam.ServicePrincipal(
                "scheduler.amazonaws.com",
                conditions={"StringEquals": {"aws:SourceAccount": self.account}},
            ),
            description="EventBridge Scheduler puts a due reminder on the notice outbox",
        )
        self.outbox.grant_send_messages(self.scheduler_role)
        self.reminder_failures.grant_send_messages(self.scheduler_role)

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

        # SES reports each email's fate through this set (FR-MSG-04).
        self.configuration_set = ses.CfnConfigurationSet(
            self, "NoticeConfigurationSet", name=f"{settings.prefix}-notices"
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
                "NOTICE_CONFIGURATION_SET": self.configuration_set.ref,
                "APP_URL": settings.app_url,
                "SCHEDULE_GROUP": self.reminder_group.name or "",
                "SCHEDULER_ROLE_ARN": self.scheduler_role.role_arn,
                "OUTBOX_QUEUE_ARN": self.outbox.queue_arn,
                "REMINDER_FAILURES_ARN": self.reminder_failures.queue_arn,
                "VAPID_PARAMETER": settings.vapid_parameter,
            },
            timeout_seconds=60,
        )
        # It reads the appointment, the patient and the clinic, and writes the
        # message log, so it needs both directions on the one table.
        grant_table_write(data.main_table, self.sender)
        grant_vapid(self, self.sender, settings)
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
        # Reminders: create and remove one-time schedules in this group only,
        # and hand the scheduler the one role above and no other.
        self.sender.add_to_role_policy(
            iam.PolicyStatement(
                actions=["scheduler:CreateSchedule", "scheduler:DeleteSchedule"],
                resources=[
                    self.format_arn(
                        service="scheduler",
                        resource="schedule",
                        resource_name=f"{self.reminder_group.name}/*",
                    )
                ],
            )
        )
        self.sender.add_to_role_policy(
            iam.PolicyStatement(
                actions=["iam:PassRole"],
                resources=[self.scheduler_role.role_arn],
                conditions={"StringEquals": {"iam:PassedToService": "scheduler.amazonaws.com"}},
            )
        )
        # SMS goes straight to a phone number, which has no ARN to scope to,
        # so publishing is allowed broadly and publishing to a topic is denied:
        # this function reaches patients, not subscribers.
        self.sender.add_to_role_policy(iam.PolicyStatement(actions=["sns:Publish"], resources=["*"]))
        self.sender.add_to_role_policy(
            iam.PolicyStatement(
                effect=iam.Effect.DENY,
                actions=["sns:Publish"],
                resources=[self.format_arn(service="sns", resource="*")],
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
                    ),
                    # Sending through a configuration set is authorised on
                    # the set as well as on the identity.
                    self.format_arn(
                        service="ses",
                        resource="configuration-set",
                        resource_name=self.configuration_set.ref,
                    ),
                ],
            )
        )
        # While the account is in the SES sandbox, SendEmail is authorised on
        # each recipient's identity too, so a reminder to a verified patient
        # was refused. Any identity, but only ever from the one sender.
        self.sender.add_to_role_policy(
            iam.PolicyStatement(
                actions=["ses:SendEmail"],
                resources=[self.format_arn(service="ses", resource="identity", resource_name="*")],
                conditions={"StringEquals": {"ses:FromAddress": settings.notice_sender}},
            )
        )

        self._delivery_reports(settings, data, common_environment)

    def _delivery_reports(self, settings: Environment, data: DataStack, environment: dict[str, str]) -> None:
        """Delivery, bounce and complaint reports into the message log (FR-MSG-04)."""
        self.status = service_function(
            self,
            "DeliveryStatus",
            settings=settings,
            build_dir=self.build_dir,
            layer=self.layer,
            handler="atria.services.notify.status.handler",
            description="Records what SES and SNS report about each sent message",
            environment=environment,
            timeout_seconds=30,
        )
        # It updates message log rows, and reads the pointers that lead to them.
        grant_table_write(data.main_table, self.status)

        # Standard and SQS-managed: an EventBridge target's dead letter queue
        # may not be FIFO, and EventBridge cannot use the AWS-managed KMS key.
        self.report_failures = sqs.Queue(
            self,
            "DeliveryReportFailures",
            queue_name=f"{settings.prefix}-delivery-report-failures",
            encryption=sqs.QueueEncryption.SQS_MANAGED,
            retention_period=Duration.days(14),
            enforce_ssl=True,
        )

        destination = ses.CfnConfigurationSetEventDestination
        destination(
            self,
            "NoticeEvents",
            configuration_set_name=self.configuration_set.ref,
            event_destination=destination.EventDestinationProperty(
                name="delivery-status",
                enabled=True,
                matching_event_types=["delivery", "bounce", "complaint", "reject", "renderingFailure"],
                event_bridge_destination=destination.EventBridgeDestinationProperty(
                    event_bus_arn=self.format_arn(
                        service="events", resource="event-bus", resource_name="default"
                    )
                ),
            ),
        )
        events.Rule(
            self,
            "EmailReports",
            description="SES reports about notices, into the message log",
            event_pattern=events.EventPattern(
                source=["aws.ses"],
                detail={"mail": {"tags": {"ses:configuration-set": [self.configuration_set.ref]}}},
            ),
            targets=[
                targets.LambdaFunction(
                    self.status,
                    retry_attempts=4,
                    max_event_age=Duration.hours(2),
                    dead_letter_queue=self.report_failures,
                )
            ],
        )

        # SMS: SNS writes a delivery log line per message once the account is
        # told which role to write them with. That is an account setting, so it
        # is set here rather than on a topic; the spend limit is left alone.
        sms_log_role = iam.Role(
            self,
            "SmsDeliveryLogRole",
            assumed_by=iam.ServicePrincipal("sns.amazonaws.com"),
            description="SNS writes SMS delivery logs to CloudWatch Logs",
        )
        sms_log_role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                    "logs:PutMetricFilter",
                    "logs:PutRetentionPolicy",
                ],
                resources=[
                    self.format_arn(
                        service="logs",
                        resource="log-group",
                        resource_name="sns/*",
                        arn_format=ArnFormat.COLON_RESOURCE_NAME,
                    )
                ],
            )
        )
        call = cr.AwsSdkCall(
            service="SNS",
            action="setSMSAttributes",
            parameters={
                "attributes": {
                    "DeliveryStatusIAMRole": sms_log_role.role_arn,
                    "DeliveryStatusSuccessSamplingRate": "100",
                }
            },
            physical_resource_id=cr.PhysicalResourceId.of("sms-delivery-logging"),
        )
        cr.AwsCustomResource(
            self,
            "SmsDeliveryLogging",
            on_create=call,
            on_update=call,
            policy=cr.AwsCustomResourcePolicy.from_statements(
                [
                    iam.PolicyStatement(actions=["sns:SetSMSAttributes"], resources=["*"]),
                    iam.PolicyStatement(actions=["iam:PassRole"], resources=[sms_log_role.role_arn]),
                ]
            ),
            install_latest_aws_sdk=False,
        )
        # The groups SNS writes to, made here so they can be subscribed to
        # before the first SMS, and so they do not keep lines for ever.
        base = f"sns/{self.region}/{self.account}/DirectPublishToPhoneNumber"
        for name, group_name in (("SmsDelivered", base), ("SmsFailed", f"{base}/Failure")):
            group = logs.LogGroup(
                self,
                f"{name}Log",
                log_group_name=group_name,
                retention=logs.RetentionDays.ONE_MONTH,
                removal_policy=RemovalPolicy.DESTROY,
            )
            logs.SubscriptionFilter(
                self,
                f"{name}Reports",
                log_group=group,
                destination=log_destinations.LambdaDestination(self.status),
                filter_pattern=logs.FilterPattern.all_events(),
            )
