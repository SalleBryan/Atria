"""ObservabilityStack: alarms and a dashboard for the API.

The alarms here are the ones that matter while the API is the only moving part:
server errors, authoriser failures and latency. The queue and reminder alarms
in the Technical Document arrive with the stacks that create those resources.
"""

from __future__ import annotations

from typing import Any

from aws_cdk import Duration, Stack
from aws_cdk import aws_cloudwatch as cloudwatch
from aws_cdk import aws_cloudwatch_actions as cloudwatch_actions
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sns_subscriptions as subscriptions
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.api import ApiStack


class ObservabilityStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        api: ApiStack,
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
        for alarm in alarms:
            alarm.add_alarm_action(cloudwatch_actions.SnsAction(self.alarms_topic))

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
                title="Functions",
                left=[api.identity_service.metric_invocations(), api.authoriser.metric_invocations()],
                right=[api.identity_service.metric_errors(), api.authoriser.metric_errors()],
                width=12,
            ),
        )
