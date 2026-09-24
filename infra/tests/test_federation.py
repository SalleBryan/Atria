"""FR-ACC-02: patients may sign in with Google; staff and administrators may not."""

from __future__ import annotations

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Template

import app as application
from atria_infra import config


@pytest.fixture(scope="module")
def identity() -> Template:
    found = application.main().node.find_child(config.DEV.stack_name("identity"))
    assert isinstance(found, cdk.Stack)
    return Template.from_stack(found)


def clients(template: Template) -> dict[str, dict]:
    return {
        c["Properties"]["ClientName"].rsplit("-", 1)[-1]: c["Properties"]
        for c in template.find_resources("AWS::Cognito::UserPoolClient").values()
    }


def test_google_is_a_provider(identity: Template) -> None:
    identity.has_resource_properties(
        "AWS::Cognito::UserPoolIdentityProvider", {"ProviderName": "Google", "ProviderType": "Google"}
    )


def test_the_hosted_domain_is_the_one_registered_with_google(identity: Template) -> None:
    identity.has_resource_properties(
        "AWS::Cognito::UserPoolDomain", {"Domain": config.DEV.auth_domain_prefix}
    )


def test_only_the_patient_client_offers_google(identity: Template) -> None:
    found = clients(identity)
    assert "Google" in found["patient"]["SupportedIdentityProviders"]
    assert found["staff"]["SupportedIdentityProviders"] == ["COGNITO"]
    assert found["admin"]["SupportedIdentityProviders"] == ["COGNITO"]


def test_the_patient_client_uses_the_code_flow(identity: Template) -> None:
    patient = clients(identity)["patient"]
    assert patient["AllowedOAuthFlows"] == ["code"]
    assert patient["CallbackURLs"] == list(config.DEV.oauth_callback_urls)


def test_only_the_repository_dev_environment_can_deploy() -> None:
    """BR-11: the deploy role trusts one repository's dev environment, nothing wider."""
    found = application.main().node.find_child(config.DEV.stack_name("deploy-access"))
    assert isinstance(found, cdk.Stack)
    roles = Template.from_stack(found).find_resources("AWS::IAM::Role").values()
    role = next(r for r in roles if r["Properties"].get("RoleName", "").endswith("-github-deploy"))
    condition = role["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]["Condition"]
    assert condition["StringEquals"]["token.actions.githubusercontent.com:sub"] == (
        f"repo:{config.DEV.github_repository}:environment:dev"
    )
    assert "StringLike" not in condition
