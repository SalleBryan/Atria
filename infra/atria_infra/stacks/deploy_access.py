"""DeployAccessStack: what lets GitHub Actions deploy, and nothing more (BR-11).

GitHub signs each workflow run with a short-lived OpenID Connect token, and
AWS trades it for credentials. No access key is stored in GitHub, so there is
no long-lived secret to leak or rotate (BR-10).

The role trusts one repository, and only a job running in its "dev"
environment, which is where required reviewers are set in GitHub. A fork, a
pull request or another repository cannot assume it.

The role can assume the roles `cdk bootstrap` created in this account, which
carry what an infrastructure deployment needs, so what CI deploys is exactly
what `cdk deploy` from a developer's machine deploys. Beyond that it may
publish the web client (tools/deploy_web.py, 2026-09-30): read the user pool's
settings the build needs (tools/web_env.py), read the hosting stack's
outputs, and run a manual deployment on Amplify. Nothing else.
"""

from __future__ import annotations

from typing import Any

from aws_cdk import CfnOutput, Duration, Stack
from aws_cdk import aws_iam as iam
from constructs import Construct

from atria_infra.config import Environment

GITHUB_ISSUER = "token.actions.githubusercontent.com"
DEPLOY_ENVIRONMENT = "dev"


class DeployAccessStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, settings: Environment, **kwargs: Any) -> None:
        super().__init__(scope, construct_id, **kwargs)

        provider = iam.OpenIdConnectProvider(
            self,
            "GitHub",
            url=f"https://{GITHUB_ISSUER}",
            client_ids=["sts.amazonaws.com"],
        )

        self.role = iam.Role(
            self,
            "DeployRole",
            role_name=f"{settings.prefix}-github-deploy",
            description=f"GitHub Actions deploys from {settings.github_repository}",
            max_session_duration=Duration.hours(1),
            assumed_by=iam.WebIdentityPrincipal(
                provider.open_id_connect_provider_arn,
                conditions={
                    "StringEquals": {
                        f"{GITHUB_ISSUER}:aud": "sts.amazonaws.com",
                        f"{GITHUB_ISSUER}:sub": (
                            f"{settings.github_subject}:environment:{DEPLOY_ENVIRONMENT}"
                        ),
                    }
                },
            ),
        )
        self.role.add_to_policy(
            iam.PolicyStatement(
                actions=["sts:AssumeRole"],
                resources=[
                    f"arn:aws:iam::{settings.account}:role/cdk-*-{settings.account}-{settings.region}"
                ],
            )
        )

        # Publishing the web client after the stacks deploy (Deploy workflow).
        region, account = settings.region, settings.account
        self.role.add_to_policy(
            iam.PolicyStatement(
                # Listing pools and APIs cannot be narrowed to one resource.
                actions=["cognito-idp:ListUserPools", "apigateway:GET"],
                resources=["*"],
            )
        )
        self.role.add_to_policy(
            iam.PolicyStatement(
                actions=["cognito-idp:DescribeUserPool", "cognito-idp:ListUserPoolClients"],
                resources=[f"arn:aws:cognito-idp:{region}:{account}:userpool/*"],
            )
        )
        self.role.add_to_policy(
            iam.PolicyStatement(
                actions=["cloudformation:DescribeStacks"],
                resources=[f"arn:aws:cloudformation:{region}:{account}:stack/{settings.prefix}-web/*"],
            )
        )
        self.role.add_to_policy(
            iam.PolicyStatement(
                actions=[
                    "amplify:CreateDeployment",
                    "amplify:StartDeployment",
                    "amplify:GetJob",
                    "amplify:ListJobs",
                    "amplify:StopJob",
                ],
                resources=[f"arn:aws:amplify:{region}:{account}:apps/*/branches/main*"],
            )
        )

        CfnOutput(self, "DeployRoleArn", value=self.role.role_arn)
