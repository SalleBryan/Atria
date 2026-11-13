"""The development sandbox can read only its own table and one secret."""

from __future__ import annotations

import json
from dataclasses import replace

import aws_cdk as cdk
from atria_spec.payment_sandbox import SECRET_ENV, TABLE_ENV
from aws_cdk.assertions import Match, Template

import app as application
from atria_infra import config


def _api_template() -> Template:
    app = application.main()
    stack = app.node.find_child(config.DEV.stack_name("api"))
    assert isinstance(stack, cdk.Stack)
    return Template.from_stack(stack)


def test_sandbox_routes_and_permissions() -> None:
    template = _api_template()
    tables = template.find_resources("AWS::DynamoDB::Table")
    assert len(tables) == 1
    table_id = next(iter(tables))
    template.resource_count_is("AWS::SecretsManager::Secret", 0)
    for method in ("GET", "POST"):
        template.has_resource_properties(
            "AWS::ApiGateway::Method",
            {
                "AuthorizationType": "CUSTOM",
                "HttpMethod": method,
                "ResourceId": {"Ref": Match.string_like_regexp(".*adminpaymentsandboxid.*")},
            },
        )
    template.has_resource_properties(
        "AWS::ApiGateway::Method",
        {
            "AuthorizationType": "NONE",
            "HttpMethod": "POST",
            "ResourceId": {"Ref": Match.string_like_regexp(".*webhooksfapshi.*")},
        },
    )
    variables = {
        SECRET_ENV: "atria/sandbox/fapshi",  # noqa: S105  Secrets Manager reference only
        TABLE_ENV: {"Ref": table_id},
    }
    template.has_resource_properties(
        "AWS::Lambda::Function",
        {
            "Handler": "atria.services.payment_sandbox.handler.handler",
            "Environment": {"Variables": Match.exact(variables)},
        },
    )
    policies = template.find_resources("AWS::IAM::Policy")
    sandbox_policy = next(policy for name, policy in policies.items() if "PaymentSandbox" in name)
    grants = sandbox_policy["Properties"]["PolicyDocument"]["Statement"]
    data_grants = [grant for grant in grants if "dynamodb:" in json.dumps(grant["Action"])]
    assert len(data_grants) == 1
    data_grant = data_grants[0]
    secret_grant = next(grant for grant in grants if "secretsmanager:GetSecretValue" in grant["Action"])
    assert set(data_grant["Action"]) == {"dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"}
    assert data_grant["Resource"] == {"Fn::GetAtt": [table_id, "Arn"]}
    assert ":secret:atria/sandbox/fapshi-??????" in json.dumps(secret_grant["Resource"])
    assert "AWSCURRENT" in json.dumps(secret_grant["Condition"])
    template.has_output("FapshiWebhookUrl", {"Value": Match.any_value()})


def test_only_development_can_enable_the_sandbox() -> None:
    assert config.DEV.payment_sandbox_enabled
    assert not replace(config.DEV, fapshi_sandbox=False).payment_sandbox_enabled
    assert not replace(config.DEV, name="production").payment_sandbox_enabled
