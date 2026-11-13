"""ApiStack: the REST API, the authoriser, and the service functions.

Every route goes through the request authoriser, which verifies the Cognito
token and resolves the caller. Functions are granted the narrowest data access
that lets them do their work: the identity service reads the person record, and
only the booking service is given the care context table and its key, since it
is the one that stores a patient's intake answers and hands them to the patient
and the assigned clinician (FR-PRV-10).

The functions share one dependency layer built by infra/build.py, and their
code asset is the atria and atria_spec packages, so no Docker is needed.
"""

from __future__ import annotations

import pathlib
from typing import Any

from atria_spec.payment_sandbox import ENABLED_ENV
from aws_cdk import Aws, Duration, RemovalPolicy, Stack
from aws_cdk import aws_apigateway as apigateway
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.payment_sandbox import PaymentSandbox
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.identity import IdentityStack
from atria_infra.stacks.platform import (
    PlatformStack,
    grant_audit_write,
    grant_table_write,
    grant_vapid,
    service_function,
)

# POST /appointments/{id}/<action>, the moves after booking.
VISIT_ACTIONS = (
    "reschedule",
    "confirm",
    "arrive",
    "start",
    "complete",
    "no-show",
    "place",
    "decline",
    "urgent",
    "invite-reply",
)


def proxy_integration(api: apigateway.RestApi, handler: lambda_.IFunction) -> apigateway.Integration:
    """A Lambda proxy integration whose invoke right is ONE statement for the whole API.

    `LambdaIntegration` adds two statements to the function's resource policy for
    every method it serves (the deployed stage and the console's test invoke).
    The booking function serves so many routes that its policy passed Lambda's
    20,480 byte limit and the dev deploy of 2026-11-13 rolled back. One statement,
    scoped to this API, keeps the policy the same size however many routes are
    added. Who may call a route is still decided by the request authoriser on
    every method and by the permission matrix in the service.
    """
    handler.add_permission(
        "InvokedByApi",
        principal=iam.ServicePrincipal("apigateway.amazonaws.com"),
        source_arn=api.arn_for_execute_api(),
    )
    return apigateway.Integration(
        type=apigateway.IntegrationType.AWS_PROXY,
        integration_http_method="POST",
        uri=(
            f"arn:{Aws.PARTITION}:apigateway:{Aws.REGION}:lambda:path/2015-03-31/functions/"
            f"{handler.function_arn}/invocations"
        ),
    )


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

        self.layer = platform.layer_in(self)
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
            description="Who the caller is, and their own details",
            environment={
                **common_environment,
                "USER_POOL_ID": pool.user_pool_id,
                "VAPID_PARAMETER": settings.vapid_parameter,
            },
        )
        grant_table_write(data.main_table, self.identity_service)
        grant_vapid(self, self.identity_service, settings)
        # POST /me/email reads the address Cognito has verified, one account
        # at a time; it changes nothing in the pool.
        self.identity_service.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:AdminUpdateUserAttributes",
                    # DELETE /me and POST /me/restore (services/identity/deletion.py).
                    "cognito-idp:ListUsers",
                    "cognito-idp:AdminEnableUser",
                    "cognito-idp:AdminUserGlobalSignOut",
                ],
                resources=[pool.user_pool_arn],
            )
        )

        self.staff_service = self._service(
            "StaffService",
            handler="atria.services.identity.staff.handler",
            description="Tenant administrator creates, changes and suspends staff accounts",
            environment={**common_environment, "USER_POOL_ID": pool.user_pool_id},
        )
        grant_table_write(data.main_table, self.staff_service)
        # Scoped to this one pool and to exactly the calls the service makes:
        # create an account, roll it back if the table write fails, and end a
        # suspended account's sessions. Nothing that reads the pool's users:
        # the staff list learns who has signed in from the table.
        self.staff_service.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminUpdateUserAttributes",
                    "cognito-idp:AdminDeleteUser",
                    "cognito-idp:AdminUserGlobalSignOut",
                    # A fresh temporary password for an account whose first
                    # one expired, or whose holder forgot theirs.
                    "cognito-idp:AdminSetUserPassword",
                    # Deleting and restoring accounts, with 30 days' grace.
                    "cognito-idp:ListUsers",
                    "cognito-idp:AdminDisableUser",
                    "cognito-idp:AdminEnableUser",
                ],
                resources=[pool.user_pool_arn],
            )
        )

        # The daily purge of accounts whose 30 days are over (identity/purge.py).
        self.purge_service = self._service(
            "PurgeService",
            handler="atria.services.identity.purge.handler",
            description="Erases accounts deleted more than 30 days ago",
            environment={**common_environment, "USER_POOL_ID": pool.user_pool_id},
        )
        grant_table_write(data.main_table, self.purge_service)
        self.purge_service.add_to_role_policy(
            iam.PolicyStatement(
                actions=["cognito-idp:ListUsers", "cognito-idp:AdminDeleteUser"],
                resources=[pool.user_pool_arn],
            )
        )
        events.Rule(
            self,
            "DailyPurge",
            schedule=events.Schedule.cron(minute="0", hour="2"),
            targets=[targets.LambdaFunction(self.purge_service)],
        )

        self.booking_service = self._service(
            "BookingService",
            handler="atria.services.booking.appointments.handler",
            description="Books appointments on the specialist line and holds their grid units",
            environment={
                **common_environment,
                "CARE_CONTEXT_TABLE": data.care_context_table.table_name,
            },
        )
        # Read and write on the one table: the booking transaction writes the
        # appointment, its first event and a lock per grid unit, and reads the
        # tenant, the appointment type, the patient and the clinician first.
        grant_table_write(data.main_table, self.booking_service)
        # The intake answers (care.py), on their own table and key. The grant
        # covers the key; no other function holds either.
        data.care_context_table.grant_read_write_data(self.booking_service)

        # Every hour, visits on a day that has ended are closed: a no-show, or
        # for a disrupted one with no new time, cancelled by the hospital
        # (services/booking/closing.py). It writes the visit, its event and
        # its fee ledger entry, and frees a cancelled visit's units.
        self.closing_service = self._service(
            "ClosingService",
            handler="atria.services.booking.closing.handler",
            description="Closes visits left open once their day has ended",
            environment={**common_environment, "DEFAULT_TENANT_ID": settings.default_tenant_id},
        )
        grant_table_write(data.main_table, self.closing_service)
        events.Rule(
            self,
            "HourlyClosing",
            schedule=events.Schedule.rate(Duration.hours(1)),
            targets=[targets.LambdaFunction(self.closing_service)],
        )

        self.directory_service = self._service(
            "DirectoryService",
            handler="atria.services.directory.clinicians.handler",
            description="Lists the tenant's clinicians and the starts they are free for",
            environment=common_environment,
        )
        # Read only. The directory and the slot search answer questions; the
        # only thing that writes a lock is a booking.
        data.main_table.grant_read_data(self.directory_service)
        # Except its own audit entries: a day list shows patients (FR-PRV-06).
        grant_audit_write(data.main_table, self.directory_service)
        # The delivery figures name the sender identities and whether email and
        # SMS are still in their sandboxes (FR-MSG-06). Reads of the account,
        # which have no narrower resource; nothing that sends or changes it.
        self.directory_service.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "ses:ListEmailIdentities",
                    "ses:GetAccount",
                    "sns:GetSMSSandboxAccountStatus",
                    # SNS answers that from the SMS service behind it.
                    "sms-voice:DescribeAccountAttributes",
                ],
                resources=["*"],
            )
        )

        self.availability_service = self._service(
            "AvailabilityService",
            handler="atria.services.directory.availability.handler",
            description="Clinicians' working hours and time off, and the disruptions time off causes",
            environment=common_environment,
        )
        # Writes hours and time off, and moves the visits inside time off to
        # DISRUPTED. Never a lock: only a booking holds time.
        grant_table_write(data.main_table, self.availability_service)

        self.audit_service = self._service(
            "AuditService",
            handler="atria.services.audit.log.handler",
            description="Reads the audit trail back and exports it",
            environment=common_environment,
        )
        # Reads the log, and adds the one entry an export leaves. Never edits.
        data.main_table.grant_read_data(self.audit_service)
        grant_audit_write(data.main_table, self.audit_service)

        self.patient_service = self._service(
            "PatientService",
            handler="atria.services.patients.register.handler",
            description="The patient register: search, minimal records and the record",
            environment=common_environment,
        )
        grant_table_write(data.main_table, self.patient_service)

        self.settings_service = self._service(
            "SettingsService",
            handler="atria.services.admin.settings.handler",
            description="Tenant settings, units, appointment types, intake forms and fee bands",
            environment={
                **common_environment,
                ENABLED_ENV: "true" if settings.payment_sandbox_enabled else "false",
            },
        )
        grant_table_write(data.main_table, self.settings_service)

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
        identity_integration = proxy_integration(self.api, self.identity_service)
        for resource, method in (
            (me, "GET"),
            (me, "PATCH"),
            (me, "DELETE"),
            (me.add_resource("email"), "POST"),
            (me.add_resource("restore"), "POST"),
            *((push, verb) for push in [me.add_resource("push")] for verb in ("GET", "POST", "DELETE")),
        ):
            resource.add_method(
                method,
                identity_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )

        # /admin/staff (GET lists, POST creates), /admin/staff/{id}/roles,
        # /admin/staff/{id}/suspend.
        # Every route still goes through the same authoriser; staff.create,
        # staff.update_roles and staff.suspend are what actually confine these
        # to a tenant administrator (core.permissions, checked in the service).
        staff_integration = proxy_integration(self.api, self.staff_service)
        admin = self.api.root.add_resource("admin")
        staff = admin.add_resource("staff")
        for verb in ("GET", "POST"):
            staff.add_method(
                verb,
                staff_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        staff_member = staff.add_resource("{id}")
        patient_account = admin.add_resource("patients").add_resource("{id}")
        # Deleting an account and restoring it within 30 days (deletion.py).
        for resource, method in (
            (staff_member, "DELETE"),
            (staff_member.add_resource("restore"), "POST"),
            (patient_account, "DELETE"),
            (patient_account.add_resource("restore"), "POST"),
        ):
            resource.add_method(
                method,
                staff_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        for path, method in (
            ("roles", "PATCH"),
            ("suspend", "POST"),
            ("priority-allowance", "PUT"),
            ("temporary-password", "POST"),
        ):
            staff_member.add_resource(path).add_method(
                method,
                staff_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        # A clinician's professional details, read and corrected.
        clinician_details = staff_member.add_resource("clinician")
        for method in ("GET", "PATCH"):
            clinician_details.add_method(
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
        booking_integration = proxy_integration(self.api, self.booking_service)
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
        # Care context: the patient's intake answers for the visit (care.py).
        care_context = one_appointment.add_resource("care-context")
        for method in ("GET", "PUT"):
            care_context.add_method(
                method,
                booking_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        # The patient's own live place in a queue (services/booking/queue.py).
        one_appointment.add_resource("ticket").add_method(
            "GET",
            booking_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        # What happens after booking (services/booking/visits.py): one resource
        # per action, so a mistyped action is API Gateway's 403, not a handler's.
        for action in VISIT_ACTIONS:
            one_appointment.add_resource(action).add_method(
                "POST",
                booking_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        patients = self.api.root.add_resource("patients")
        # The register (services/patients/register.py), beside the patient's own list.
        patient_integration = proxy_integration(self.api, self.patient_service)
        for resource, method in (
            (patients, "GET"),
            (patients, "POST"),
            (patients.add_resource("{id}"), "GET"),
        ):
            resource.add_method(
                method,
                patient_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        patients.add_resource("me").add_resource("appointments").add_method(
            "GET",
            booking_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )

        # /clinicians and /clinicians/{id}/slots. Any signed-in account of the
        # tenant reads these; the directory is what a patient chooses from, so
        # it is not under /admin either.
        directory_integration = proxy_integration(self.api, self.directory_service)
        clinicians = self.api.root.add_resource("clinicians")
        clinicians.add_method(
            "GET",
            directory_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        one_clinician = clinicians.add_resource("{id}")
        # Free starts, and what is booked. Both read only, so both live on the
        # directory function, which cannot write.
        for path in ("slots", "calendar"):
            one_clinician.add_resource(path).add_method(
                "GET",
                directory_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        # A clinician's hours and time off, on their own function so the
        # directory stays read only.
        availability_integration = proxy_integration(self.api, self.availability_service)
        time_off = one_clinician.add_resource("time-off")
        for resource, method in (
            (one_clinician.add_resource("availability"), "GET"),
            (one_clinician.add_resource("hours"), "PUT"),
            (time_off, "POST"),
            (time_off.add_resource("{groupId}"), "DELETE"),
        ):
            resource.add_method(
                method,
                availability_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        # /clinics lists where the tenant's clinics are; /appointment-types
        # what can be booked and for how long. Both read only, and both what a
        # patient needs to book without the front desk.
        clinics = self.api.root.add_resource("clinics")
        for resource in (clinics, self.api.root.add_resource("appointment-types")):
            resource.add_method(
                "GET",
                directory_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        # The front desk's day. appointment.read at clinic scope decides who
        # reaches it; a clinician's scope is their own and is refused.
        one_clinic = clinics.add_resource("{id}")
        # Sessions, the queue and procedure requests (services/booking/queue.py
        # and requests.py), on the booking function: they write appointments.
        sessions = one_clinic.add_resource("sessions")
        one_session = self.api.root.add_resource("sessions").add_resource("{id}")
        for resource, method in (
            (sessions, "GET"),
            (sessions, "POST"),
            (one_clinic.add_resource("requests"), "GET"),
            (one_session, "GET"),
            (one_session.add_resource("tickets"), "POST"),
            (one_session.add_resource("queue"), "GET"),
            (one_session.add_resource("next"), "POST"),
            (one_session.add_resource("close"), "POST"),
            # ADR 0022 R4: the desk invites booked patients to come early.
            (one_session.add_resource("invites"), "POST"),
            # ADR 0022: a unit's queue rules, and the desk's adjustment for one session.
            (queue_policy := one_clinic.add_resource("queue-policy"), "PATCH"),
            (queue_policy, "GET"),
            (one_session.add_resource("policy"), "PATCH"),
            (self.api.root.add_resource("procedure-requests"), "POST"),
        ):
            resource.add_method(
                method,
                booking_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )
        # The front desk's day, and who is working it.
        # The unit's week in figures (services/directory/report.py), read only.
        # The unit's message log (services/directory/messages.py), FR-MSG-05.
        for path in ("day", "roster", "report", "messages"):
            one_clinic.add_resource(path).add_method(
                "GET",
                directory_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )

        self.api.root.add_resource("reports").add_method(
            "GET",
            directory_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        # Hospital-wide capacity for the coming week (services/directory/capacity.py).
        self.api.root.add_resource("capacity").add_method(
            "GET",
            directory_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        # Every unit's message log (FR-MSG-05) and the administrator's
        # delivery figures (FR-MSG-06).
        messages = self.api.root.add_resource("messages")
        messages.add_method(
            "GET",
            directory_integration,
            authorizer=self.request_authoriser,
            authorization_type=apigateway.AuthorizationType.CUSTOM,
        )
        # The month's usage statement (ADR 0031), also the administrator's.
        for path in ("delivery", "usage"):
            messages.add_resource(path).add_method(
                "GET",
                directory_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )

        # The administrator's settings (services/admin/settings.py). Each route
        # is its own permission, checked in the service.
        settings_integration = proxy_integration(self.api, self.settings_service)
        admin_settings = admin.add_resource("settings")
        admin_clinics = admin.add_resource("clinics")
        admin_clinic = admin_clinics.add_resource("{id}")
        admin_types = admin.add_resource("appointment-types")
        admin_band = admin.add_resource("fee-bands").add_resource("{id}")
        admin_forms = admin.add_resource("intake-forms")
        for resource, method in (
            (admin_forms, "GET"),
            (admin_forms, "POST"),
            (admin_forms.add_resource("{id}"), "PUT"),
            (admin_settings, "GET"),
            (admin_settings, "PATCH"),
            (admin_clinics, "POST"),
            (admin_clinic, "PATCH"),
            (admin_clinic, "DELETE"),
            (admin_types, "POST"),
            (admin_types.add_resource("{id}"), "PATCH"),
            (admin_band, "PUT"),
        ):
            resource.add_method(
                method,
                settings_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )

        # /audit and /audit/export. audit.read decides who reaches them.
        audit_integration = proxy_integration(self.api, self.audit_service)
        audit = self.api.root.add_resource("audit")
        for resource in (audit, audit.add_resource("export"), audit.add_resource("changes")):
            resource.add_method(
                "GET",
                audit_integration,
                authorizer=self.request_authoriser,
                authorization_type=apigateway.AuthorizationType.CUSTOM,
            )

        if settings.payment_sandbox_enabled:
            PaymentSandbox(
                self,
                "PaymentSandbox",
                settings=settings,
                build_dir=build_dir,
                layer=self.layer,
                api=self.api,
                authorizer=self.request_authoriser,
                main_table=data.main_table,
                main_key=data.main_key,
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
