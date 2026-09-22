"""CostGuardStack: budgets and anomaly detection.

This is in the first infrastructure commit on purpose. Development is synthetic
data and a handful of requests, so any real spend means a mistake, and the
cheapest time to find that out is immediately (ADR 0014).
"""

from __future__ import annotations

from typing import Any

from aws_cdk import Stack
from aws_cdk import aws_budgets as budgets
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sns_subscriptions as subscriptions
from constructs import Construct

from atria_infra.config import Environment

# Warn early, warn again, then warn on the forecast.
THRESHOLDS = (50, 80, 100)


class CostGuardStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, settings: Environment, **kwargs: Any) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings

        self.alerts = sns.Topic(
            self,
            "CostAlerts",
            topic_name=f"{settings.prefix}-cost-alerts",
            display_name="Atria cost alerts",
            enforce_ssl=True,
        )
        for address in settings.budget_alert_emails:
            self.alerts.add_subscription(subscriptions.EmailSubscription(address))

        subscribers = [
            budgets.CfnBudget.SubscriberProperty(address=self.alerts.topic_arn, subscription_type="SNS")
        ]
        notifications = [
            budgets.CfnBudget.NotificationWithSubscribersProperty(
                notification=budgets.CfnBudget.NotificationProperty(
                    comparison_operator="GREATER_THAN",
                    notification_type="ACTUAL",
                    threshold=threshold,
                    threshold_type="PERCENTAGE",
                ),
                subscribers=subscribers,
            )
            for threshold in THRESHOLDS
        ]
        notifications.append(
            budgets.CfnBudget.NotificationWithSubscribersProperty(
                notification=budgets.CfnBudget.NotificationProperty(
                    comparison_operator="GREATER_THAN",
                    notification_type="FORECASTED",
                    threshold=100,
                    threshold_type="PERCENTAGE",
                ),
                subscribers=subscribers,
            )
        )

        self.budget = budgets.CfnBudget(
            self,
            "MonthlyBudget",
            budget=budgets.CfnBudget.BudgetDataProperty(
                budget_name=f"{settings.prefix}-monthly",
                budget_type="COST",
                time_unit="MONTHLY",
                budget_limit=budgets.CfnBudget.SpendProperty(amount=settings.monthly_budget_usd, unit="USD"),
                cost_filters={"TagKeyValue": [f"user:Project${settings.tags.get('Project', 'Atria')}"]},
            ),
            notifications_with_subscribers=notifications,
        )
