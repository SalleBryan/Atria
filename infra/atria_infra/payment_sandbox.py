"""Dev API resources for synthetic Fapshi transactions."""

from __future__ import annotations

import pathlib

from atria_spec.payment_sandbox import (
    APPOINTMENT_PAYMENT_PATH,
    HOST_ENV,
    PAYMENT_PATH,
    SECRET_ENV,
    TABLE_ENV,
    WEBHOOK_PATH,
)
from aws_cdk import CfnOutput, RemovalPolicy, Stack
from aws_cdk import aws_apigateway as apigateway
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_kms as kms
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_secretsmanager as secretsmanager
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.platform import service_function

SECRET_NAME = "atria/sandbox/fapshi"  # noqa: S105  Secrets Manager reference only


class PaymentSandbox(Construct):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        settings: Environment,
        build_dir: pathlib.Path,
        layer: lambda_.ILayerVersion,
        api: apigateway.RestApi,
        authorizer: apigateway.IAuthorizer,
        main_table: dynamodb.ITable,
        main_key: kms.IKey,
    ) -> None:
        super().__init__(scope, construct_id)
        credentials = secretsmanager.Secret.from_secret_name_v2(self, "Credentials", SECRET_NAME)
        payments = dynamodb.Table(
            self,
            "Payments",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )
        service = service_function(
            self,
            "FapshiSandbox",
            settings=settings,
            build_dir=build_dir,
            layer=layer,
            handler="atria.services.payment_sandbox.handler.handler",
            description="Creates and verifies synthetic Fapshi sandbox payments",
            environment={
                TABLE_ENV: payments.table_name,
                SECRET_ENV: credentials.secret_name,
                HOST_ENV: settings.fapshi_host,
                # Read only: an appointment and its fee band, to price its checkout.
                "MAIN_TABLE": main_table.table_name,
            },
            memory_mb=256,
            timeout_seconds=20,
        )
        service.add_to_role_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
                resources=[payments.table_arn],
            )
        )
        credentials.grant_read(service, ["AWSCURRENT"])
        # Paying an appointment reads it and its fee; nothing here writes bookings or the ledger.
        service.add_to_role_policy(
            iam.PolicyStatement(
                actions=["dynamodb:GetItem", "dynamodb:Query"],
                resources=[main_table.table_arn],
            )
        )
        main_key.grant_decrypt(service)

        # One invoke statement for the whole API, as for every function (stacks/api.py).
        from atria_infra.stacks.api import proxy_integration

        integration = proxy_integration(api, service)
        payment = api.root.resource_for_path(PAYMENT_PATH)
        for method in ("POST", "GET"):
            payment.add_method(
                method,
                integration,
                authorizer=authorizer,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        appointment_payment = api.root.resource_for_path(APPOINTMENT_PAYMENT_PATH)
        for method in ("POST", "GET"):
            appointment_payment.add_method(
                method,
                integration,
                authorizer=authorizer,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        webhook = api.root.resource_for_path(WEBHOOK_PATH)
        webhook.add_method("POST", integration, authorization_type=apigateway.AuthorizationType.NONE)
        CfnOutput(Stack.of(self), "FapshiWebhookUrl", value=api.url_for_path(WEBHOOK_PATH))
