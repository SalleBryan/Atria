"""ApiStack: the REST API, the authoriser, and the service functions.

Every route goes through the request authoriser, which verifies the Cognito
token and resolves the caller. Functions are granted the narrowest data access
that lets them do their work: the identity service reads the person record, and
nothing here is given the care context key.

The functions share one dependency layer built by infra/build.py, and their
code asset is the atria and atria_spec packages, so no Docker is needed.
"""

from __future__ import annotations

import pathlib
from typing import Any

from aws_cdk import Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigateway as apigateway
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.identity import IdentityStack

# Must match infra/build.py.
RUNTIME = lambda_.Runtime.PYTHON_3_13
ARCHITECTURE = lambda_.Architecture.X86_64


class ApiStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        data: DataStack,
        identity: IdentityStack,
        build_dir: pathlib.Path,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings

        self.layer = lambda_.LayerVersion(
            self,
            "DependencyLayer",
            layer_version_name=f"{settings.prefix}-dependencies",
            code=lambda_.Code.from_asset(str(build_dir / "layer")),
            compatible_runtimes=[RUNTIME],
            compatible_architectures=[ARCHITECTURE],
            description="aws-lambda-powertools, pydantic, pyjwt",
        )
        self.code = lambda_.Code.from_asset(str(build_dir / "app"))

        pool = identity.user_pool
        client_ids = ",".join(
            client.user_pool_client_id
            for client in (identity.patient_client, identity.staff_client, identity.admin_client)
        )
        common_environment = {
            "POWERTOOLS_SERVICE_NAME": "atria",
            "POWERTOOLS_LOG_LEVEL": "INFO",
            "POWERTOOLS_LOGGER_SAMPLE_RATE": "0.1",
            "ENVIRONMENT": settings.name,
            "MAIN_TABLE": data.main_table.table_name,
        }

        self.authoriser = self._function(
            "Authoriser",
            handler="atria.services.authoriser.handler.handler",
            description="Verifies the Cognito token and resolves the caller",
            environment={
                **common_environment,
                "COGNITO_ISSUER": f"https://cognito-idp.{settings.region}.amazonaws.com/{pool.user_pool_id}",
                "COGNITO_CLIENT_IDS": client_ids,
            },
        )

        self.identity_service = self._function(
            "IdentityService",
            handler="atria.services.identity.handler.handler",
            description="Profile completion, phone verification, staff provisioning",
            environment=common_environment,
        )
        data.main_table.grant_read_write_data(self.identity_service)

        self.access_log = logs.LogGroup(
            self,
            "AccessLog",
            log_group_name=f"/aws/apigateway/{settings.prefix}",
            retention=logs.RetentionDays(settings.log_retention),
            removal_policy=RemovalPolicy.DESTROY,
        )

        self.api = apigateway.RestApi(
            self,
            "Api",
            rest_api_name=f"{settings.prefix}-api",
            description="Atria Rev B API",
            deploy_options=apigateway.StageOptions(
                stage_name=settings.name,
                access_log_destination=apigateway.LogGroupLogDestination(self.access_log),
                # Enough to trace a report from a clinic to one request, without
                # logging request bodies, which would capture patient data.
                access_log_format=apigateway.AccessLogFormat.json_with_standard_fields(
                    caller=False,
                    http_method=True,
                    ip=True,
                    protocol=True,
                    request_time=True,
                    resource_path=True,
                    response_length=True,
                    status=True,
                    user=True,
                ),
                data_trace_enabled=False,
                logging_level=apigateway.MethodLoggingLevel.ERROR,
                metrics_enabled=True,
                tracing_enabled=True,
                throttling_rate_limit=100,
                throttling_burst_limit=200,
            ),
            cloud_watch_role=True,
            endpoint_types=[apigateway.EndpointType.REGIONAL],
        )

        self.request_authoriser = apigateway.RequestAuthorizer(
            self,
            "RequestAuthoriser",
            handler=self.authoriser,
            authorizer_name=f"{settings.prefix}-authoriser",
            identity_sources=[apigateway.IdentitySource.header("Authorization")],
            # Cached per caller for the life of an access token minute, so a
            # role change takes effect at the next sign-in, as specified.
            results_cache_ttl=Duration.minutes(5),
        )

        me = self.api.root.add_resource("me")
        me.add_method(
            "GET",
            apigateway.LambdaIntegration(self.identity_service, proxy=True),
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )

    def _function(
        self,
        name: str,
        *,
        handler: str,
        description: str,
        environment: dict[str, str],
    ) -> lambda_.Function:
        """One service function, with the shared layer and code asset."""
        # An explicit log group, so retention is part of the stack rather than a
        # custom resource, and deleting the stack deletes the logs.
        log_group = logs.LogGroup(
            self,
            f"{name}Logs",
            log_group_name=f"/aws/lambda/{self.settings.prefix}-{name.lower()}",
            retention=logs.RetentionDays(self.settings.log_retention),
            removal_policy=RemovalPolicy.DESTROY,
        )
        return lambda_.Function(
            self,
            name,
            function_name=f"{self.settings.prefix}-{name.lower()}",
            runtime=RUNTIME,
            architecture=ARCHITECTURE,
            code=self.code,
            handler=handler,
            description=description,
            layers=[self.layer],
            environment=environment,
            memory_size=512,
            timeout=Duration.seconds(10),
            tracing=lambda_.Tracing.ACTIVE,
            log_group=log_group,
        )
