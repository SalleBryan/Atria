"""IdentityStack: the Cognito user pool and its three app clients.

Three clients because the three audiences differ: patients may sign in with
Google, staff may not, and the administration console is separate again
(ADR 0015, and the identity section of the Technical Document).

Roles are fixed on the account at creation and are carried as claims, so a
signed-in session cannot change role.

Cognito puts custom attributes in the id token but not the access token, and
the API authorises on the access token, so a pre-token generation trigger adds
the tenant, person and role claims. Without it the authoriser has a verified
token it cannot resolve a caller from.
"""

from __future__ import annotations

import pathlib
from typing import Any

from aws_cdk import Duration, RemovalPolicy, Stack
from aws_cdk import aws_cognito as cognito
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.platform import PlatformStack, service_function


class IdentityStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        platform: PlatformStack,
        data: DataStack,
        build_dir: pathlib.Path,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings
        retain = RemovalPolicy.RETAIN if settings.removal_protection else RemovalPolicy.DESTROY

        self.user_pool = cognito.UserPool(
            self,
            "UserPool",
            user_pool_name=f"{settings.prefix}-users",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(email=True, phone=True),
            sign_in_case_sensitive=False,
            # The phone is verified by one-time code in the application, not by
            # Cognito, because it must be verified whatever the identity
            # provider returned (ADR 0009, FR-ACC-15).
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            standard_attributes=cognito.StandardAttributes(
                given_name=cognito.StandardAttribute(required=True, mutable=True),
                family_name=cognito.StandardAttribute(required=True, mutable=True),
                phone_number=cognito.StandardAttribute(required=False, mutable=True),
                email=cognito.StandardAttribute(required=False, mutable=True),
                locale=cognito.StandardAttribute(required=False, mutable=True),
            ),
            custom_attributes={
                # Set by the service when the account is created, read by the
                # pre-token generation trigger. Immutable: a person's tenant and
                # the person record behind the account do not change.
                "tenantId": cognito.StringAttribute(min_len=1, max_len=64, mutable=False),
                "personId": cognito.StringAttribute(min_len=1, max_len=64, mutable=False),
                # Comma separated role names. Changed only by an administrator
                # through the staff roles endpoint, effective at next sign-in.
                "roles": cognito.StringAttribute(min_len=1, max_len=256, mutable=True),
            },
            password_policy=cognito.PasswordPolicy(
                min_length=12,
                require_lowercase=True,
                require_uppercase=True,
                require_digits=True,
                require_symbols=False,
                temp_password_validity=Duration.days(3),
            ),
            mfa=cognito.Mfa.OPTIONAL,
            mfa_second_factor=cognito.MfaSecondFactor(sms=True, otp=True),
            account_recovery=cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
            feature_plan=cognito.FeaturePlan.ESSENTIALS,
            removal_policy=retain,
        )

        # SRP only: the password never crosses the wire. Development adds the
        # admin password flow so a smoke test can sign in without SRP.
        common_auth_flows = cognito.AuthFlow(user_srp=True, user_password=False)
        staff_auth_flows = cognito.AuthFlow(
            user_srp=True,
            user_password=False,
            admin_user_password=settings.admin_password_auth,
        )
        refresh = Duration.days(30)
        access = Duration.hours(1)

        self.patient_client = self.user_pool.add_client(
            "PatientClient",
            user_pool_client_name=f"{settings.prefix}-patient",
            auth_flows=common_auth_flows,
            # Google is offered to patients only. Staff sign in to the account
            # an administrator created for them.
            supported_identity_providers=[cognito.UserPoolClientIdentityProvider.COGNITO],
            access_token_validity=access,
            id_token_validity=access,
            refresh_token_validity=refresh,
            prevent_user_existence_errors=True,
            enable_token_revocation=True,
        )

        self.staff_client = self.user_pool.add_client(
            "StaffClient",
            user_pool_client_name=f"{settings.prefix}-staff",
            auth_flows=staff_auth_flows,
            supported_identity_providers=[cognito.UserPoolClientIdentityProvider.COGNITO],
            access_token_validity=access,
            id_token_validity=access,
            # Shorter than the patient client: a staff console runs on a shared
            # desk machine.
            refresh_token_validity=Duration.days(7),
            prevent_user_existence_errors=True,
            enable_token_revocation=True,
        )

        self.admin_client = self.user_pool.add_client(
            "AdminClient",
            user_pool_client_name=f"{settings.prefix}-admin",
            auth_flows=common_auth_flows,
            supported_identity_providers=[cognito.UserPoolClientIdentityProvider.COGNITO],
            access_token_validity=Duration.minutes(30),
            id_token_validity=Duration.minutes(30),
            refresh_token_validity=Duration.days(1),
            prevent_user_existence_errors=True,
            enable_token_revocation=True,
        )

        # Cognito must be able to resolve the caller from the access token, so
        # the trigger reads the person record (ADR 0017) and copies the
        # tenant, staff membership, clinic and patient profile it finds into
        # the token. It falls back to the account's own attributes when there
        # is no person record yet, but that fallback needs table access to
        # even attempt the read; without it every sign-in silently takes the
        # fallback path, which is fine for a patient completing sign-up and
        # wrong for a provisioned staff account, which has no attributes to
        # fall back to at all.
        self.pre_token = service_function(
            self,
            "PreToken",
            settings=settings,
            build_dir=build_dir,
            layer=platform.layer,
            handler="atria.services.identity.pre_token.handler",
            description="Adds the tenant, person and role claims to the access token",
            environment={
                "POWERTOOLS_SERVICE_NAME": "atria",
                "POWERTOOLS_LOG_LEVEL": "INFO",
                "ENVIRONMENT": settings.name,
                "MAIN_TABLE": data.main_table.table_name,
            },
            timeout_seconds=5,
            memory_mb=256,
        )
        # Read only: the trigger never writes, and it must not be able to.
        data.main_table.grant_read_data(self.pre_token)
        self.user_pool.add_trigger(
            cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
            self.pre_token,
            lambda_version=cognito.LambdaVersion.V2_0,
        )
