"""ObservabilityStack: alarms, one dashboard, and the audit trail of the account.

Alarms (NFR-OBS-02, NFR-OBS-05), each mailed to the alarms topic:

- the API: server errors, 95th percentile latency, authoriser failures;
- every function: errors and throttles;
- both tables: read and write throttles;
- every dead letter queue: any message at all, since each one is a booking
  event, a stream record or a reminder that was not delivered;
- SES: the account's bounce rate;
- SMS: the month's spend passing the environment's warning line.

CloudTrail records every control-plane action in every region into a bucket
of its own (NFR-SEC-08). WAF, the other half of that requirement, is
production's only (decision 2026-09-26).
"""

from __future__ import annotations

from typing import Any

from aws_cdk import Duration, RemovalPolicy, Stack
from aws_cdk import aws_cloudtrail as cloudtrail
from aws_cdk import aws_cloudwatch as cloudwatch
from aws_cdk import aws_cloudwatch_actions as cloudwatch_actions
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sns_subscriptions as subscriptions
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.api import ApiStack
from atria_infra.stacks.async_stack import AsyncStack
from atria_infra.stacks.data import DataStack

FIVE_MINUTES = Duration.minutes(5)


class ObservabilityStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        api: ApiStack,
        async_: AsyncStack,
        data: DataStack,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings

        self.alarms_topic = sns.Topic(
            self,
            "Alarms",
            topic_name=f"{settings.prefix}-alarms",
            display_name="Atria alarms",
            enforce_ssl=True,
        )
        for address in settings.budget_alert_emails:
            self.alarms_topic.add_subscription(subscriptions.EmailSubscription(address))

        rest_api = api.api
        alarms = [
            cloudwatch.Alarm(
                self,
                "ApiServerErrors",
                alarm_name=f"{settings.prefix}-api-5xx",
                alarm_description="The API returned server errors",
                metric=rest_api.metric_server_error(period=Duration.minutes(5)),
                threshold=1,
                evaluation_periods=1,
                treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
            ),
            cloudwatch.Alarm(
                self,
                "ApiLatency",
                alarm_name=f"{settings.prefix}-api-latency",
                alarm_description="The API is slow at the 95th percentile",
                metric=rest_api.metric_latency(period=Duration.minutes(5), statistic="p95"),
                threshold=2_000,
                evaluation_periods=2,
                treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
            ),
            cloudwatch.Alarm(
                self,
                "AuthoriserErrors",
                alarm_name=f"{settings.prefix}-authoriser-errors",
                alarm_description="The authoriser is failing, so every request is refused",
                metric=api.authoriser.metric_errors(period=Duration.minutes(5)),
                threshold=1,
                evaluation_periods=1,
                treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
            ),
        ]
        functions: dict[str, lambda_.IFunction] = {
            "authoriser": api.authoriser,
            "identity": api.identity_service,
            "staff": api.staff_service,
            "booking": api.booking_service,
            "directory": api.directory_service,
            "dispatcher": async_.dispatcher,
            "sender": async_.sender,
        }
        for name, function in functions.items():
            if name != "authoriser":  # its errors are alarmed above, as a refusal of every request
                alarms.append(
                    self._alarm(
                        f"{name.title()}Errors",
                        f"{settings.prefix}-{name}-errors",
                        f"The {name} function is failing",
                        function.metric_errors(period=FIVE_MINUTES),
                    )
                )
            alarms.append(
                self._alarm(
                    f"{name.title()}Throttles",
                    f"{settings.prefix}-{name}-throttles",
                    f"The {name} function is being throttled",
                    function.metric_throttles(period=FIVE_MINUTES),
                )
            )

        for label, table in (("Main", data.main_table), ("CareContext", data.care_context_table)):
            for kind in ("Read", "Write"):
                alarms.append(
                    self._alarm(
                        f"{label}{kind}Throttles",
                        f"{settings.prefix}-{label.lower()}-table-{kind.lower()}-throttles",
                        f"The {label} table is throttling {kind.lower()}s",
                        cloudwatch.Metric(
                            namespace="AWS/DynamoDB",
                            metric_name=f"{kind}ThrottleEvents",
                            dimensions_map={"TableName": table.table_name},
                            statistic="Sum",
                            period=FIVE_MINUTES,
                        ),
                    )
                )

        dead_letters = {
            "outbox": async_.outbox_dead_letters,
            "stream": async_.stream_failures,
            "reminder": async_.reminder_failures,
        }
        for name, queue in dead_letters.items():
            alarms.append(
                self._alarm(
                    f"{name.title()}DeadLetters",
                    f"{settings.prefix}-{name}-dead-letters",
                    f"Messages wait in the {name} dead letter queue; redrive them (docs/runbooks/redrive.md)",
                    queue.metric_approximate_number_of_messages_visible(
                        period=FIVE_MINUTES, statistic="Maximum"
                    ),
                )
            )

        alarms.append(
            self._alarm(
                "SesBounceRate",
                f"{settings.prefix}-ses-bounce-rate",
                "The SES bounce rate is above 5 per cent; SES reviews an account at 5 and pauses it at 10",
                cloudwatch.Metric(
                    namespace="AWS/SES",
                    metric_name="Reputation.BounceRate",
                    statistic="Maximum",
                    period=Duration.hours(1),
                ),
                threshold=0.05,
            )
        )
        alarms.append(
            self._alarm(
                "SmsSpend",
                f"{settings.prefix}-sms-spend",
                f"SMS spend this month has passed {settings.sms_spend_alarm_usd} USD",
                cloudwatch.Metric(
                    namespace="AWS/SNS",
                    metric_name="SMSMonthToDateSpentUSD",
                    statistic="Maximum",
                    period=Duration.hours(1),
                ),
                threshold=settings.sms_spend_alarm_usd,
            )
        )

        for alarm in alarms:
            alarm.add_alarm_action(cloudwatch_actions.SnsAction(self.alarms_topic))

        trail_bucket = s3.Bucket(
            self,
            "TrailBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            versioned=True,
            lifecycle_rules=[s3.LifecycleRule(expiration=Duration.days(settings.trail_retention_days))],
            removal_policy=RemovalPolicy.RETAIN,
        )
        self.trail = cloudtrail.Trail(
            self,
            "Trail",
            trail_name=f"{settings.prefix}-trail",
            bucket=trail_bucket,
            is_multi_region_trail=True,
            include_global_service_events=True,
            enable_file_validation=True,
            management_events=cloudtrail.ReadWriteType.ALL,
        )

        self.dashboard = cloudwatch.Dashboard(
            self,
            "Dashboard",
            dashboard_name=f"{settings.prefix}-overview",
            default_interval=Duration.hours(12),
        )
        self.dashboard.add_widgets(
            cloudwatch.GraphWidget(
                title="API requests and errors",
                left=[rest_api.metric_count()],
                right=[rest_api.metric_client_error(), rest_api.metric_server_error()],
                width=12,
            ),
            cloudwatch.GraphWidget(
                title="API latency",
                left=[
                    rest_api.metric_latency(statistic="p50"),
                    rest_api.metric_latency(statistic="p95"),
                ],
                width=12,
            ),
            cloudwatch.GraphWidget(
                title="Function errors",
                left=[function.metric_errors(label=name) for name, function in functions.items()],
                width=12,
            ),
            cloudwatch.GraphWidget(
                title="Dead letter queues",
                left=[
                    queue.metric_approximate_number_of_messages_visible(label=name)
                    for name, queue in dead_letters.items()
                ],
                width=12,
            ),
        )

    def _alarm(
        self,
        construct_id: str,
        name: str,
        description: str,
        metric: cloudwatch.IMetric,
        *,
        threshold: float = 1,
    ) -> cloudwatch.Alarm:
        """An alarm that fires on one period at or over the threshold, and not on silence."""
        return cloudwatch.Alarm(
            self,
            construct_id,
            alarm_name=name,
            alarm_description=description,
            metric=metric,
            threshold=threshold,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
