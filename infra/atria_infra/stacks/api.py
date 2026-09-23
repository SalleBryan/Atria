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
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.identity import IdentityStack
from atria_infra.stacks.platform import PlatformStack, service_function


class ApiStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        data: DataStack,
        identity: IdentityStack,
        platform: PlatformStack,
        build_dir: pathlib.Path,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings

        self.layer = platform.layer
        self.build_dir = build_dir

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

        self.authoriser = self._service(
            "Authoriser",
            handler="atria.services.authoriser.handler.handler",
            description="Verifies the Cognito token and resolves the caller",
            environment={
                **common_environment,
                "COGNITO_ISSUER": f"https://cognito-idp.{settings.region}.amazonaws.com/{pool.user_pool_id}",
                "COGNITO_CLIENT_IDS": client_ids,
            },
        )

        self.identity_service = self._service(
            "IdentityService",
            handler="atria.services.identity.handler.handler",
            description="Profile completion, phone verification",
            environment=common_environment,
        )
        data.main_table.grant_read_write_data(self.identity_service)

        self.staff_service = self._service(
            "StaffService",
            handler="atria.services.identity.staff.handler",
            description="Tenant administrator creates, changes and suspends staff accounts",
            environment={**common_environment, "USER_POOL_ID": pool.user_pool_id},
        )
        data.main_table.grant_read_write_data(self.staff_service)
        # Scoped to this one pool and to exactly the calls the service makes:
        # create an account, roll it back if the table write fails, and end a
        # suspended account's sessions. Nothing wider, and no read of another
        # pool's users.
        self.staff_service.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminDeleteUser",
                    "cognito-idp:AdminUserGlobalSignOut",
                ],
                resources=[pool.user_pool_arn],
            )
        )

        self.booking_service = self._service(
            "BookingService",
            handler="atria.services.booking.appointments.handler",
            description="Books appointments on the specialist line and holds their grid units",
            environment=common_environment,
        )
        # Read and write on the one table: the booking transaction writes the
        # appointment, its first event and a lock per grid unit, and reads the
        # tenant, the appointment type, the patient and the clinician first.
        data.main_table.grant_read_write_data(self.booking_service)

        self.directory_service = self._service(
            "DirectoryService",
            handler="atria.services.directory.clinicians.handler",
            description="Lists the tenant's clinicians and the starts they are free for",
            environment=common_environment,
        )
        # Read only. The directory and the slot search answer questions; the
        # only thing that writes a lock is a booking.
        data.main_table.grant_read_data(self.directory_service)

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

        # /admin/staff, /admin/staff/{id}/roles, /admin/staff/{id}/suspend.
        # Every route still goes through the same authoriser; staff.create,
        # staff.update_roles and staff.suspend are what actually confine these
        # to a tenant administrator (core.permissions, checked in the service).
        staff_integration = apigateway.LambdaIntegration(self.staff_service, proxy=True)
        admin = self.api.root.add_resource("admin")
        staff = admin.add_resource("staff")
        staff.add_method(
            "POST",
            staff_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        staff_member = staff.add_resource("{id}")
        for path, method in (("roles", "PATCH"), ("suspend", "POST")):
            staff_member.add_resource(path).add_method(
                method,
                staff_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )

        # /appointments. A patient reaches this as well as staff, so the route
        # is not under /admin; appointment.create and its scope are what decide
        # who may book for whom (core.permissions, checked in the service).
        # /appointments, /appointments/{id} and /patients/me/appointments.
        # A patient reaches all three as well as staff, so none of them sit
        # under /admin; appointment.create, .read and .cancel and their scopes
        # are what decide who may act on whose record.
        booking_integration = apigateway.LambdaIntegration(self.booking_service, proxy=True)
        appointments = self.api.root.add_resource("appointments")
        appointments.add_method(
            "POST",
            booking_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        one_appointment = appointments.add_resource("{id}")
        for method in ("GET", "DELETE"):
            one_appointment.add_method(
                method,
                booking_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        self.api.root.add_resource("patients").add_resource("me").add_resource(
            "appointments"
        ).add_method(
            "GET",
            booking_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )

        # /clinicians and /clinicians/{id}/slots. Any signed-in account of the
        # tenant reads these; the directory is what a patient chooses from, so
        # it is not under /admin either.
        directory_integration = apigateway.LambdaIntegration(self.directory_service, proxy=True)
        clinicians = self.api.root.add_resource("clinicians")
        clinicians.add_method(
            "GET",
            directory_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        clinicians.add_resource("{id}").add_resource("slots").add_method(
            "GET",
            directory_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )

    def _service(
        self,
        name: str,
        *,
        handler: str,
        description: str,
        environment: dict[str, str],
    ) -> lambda_.Function:
        return service_function(
            self,
            name,
            settings=self.settings,
            build_dir=self.build_dir,
            layer=self.layer,
            handler=handler,
            description=description,
            environment=environment,
        )
