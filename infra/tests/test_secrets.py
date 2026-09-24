"""BR-10: no secret is written into the infrastructure.

Every stack the app synthesises is read, not a chosen few, so a stack added
later is covered without anyone remembering to add it here. What counts as a
secret is defined once, in atria_spec.secrets, and tools/scan_secrets.py applies
the same rule to what is actually deployed.
"""

from __future__ import annotations

import json

import aws_cdk as cdk
import pytest
from atria_spec.secrets import SECRET_REFERENCE, credential_in, environment_findings
from aws_cdk.assertions import Template

import app as application


@pytest.fixture(scope="module")
def templates() -> dict[str, Template]:
    app = application.main()
    return {
        child.stack_name: Template.from_stack(child)
        for child in app.node.children
        if isinstance(child, cdk.Stack)
    }


def test_every_stack_is_read(templates: dict[str, Template]) -> None:
    assert len(templates) >= 7


def test_no_function_environment_holds_a_secret(templates: dict[str, Template]) -> None:
    findings: list[str] = []
    for stack, template in templates.items():
        for logical, function in template.find_resources("AWS::Lambda::Function").items():
            variables = function["Properties"].get("Environment", {}).get("Variables", {})
            findings.extend(f"{stack}/{logical}: {finding}" for finding in environment_findings(variables))
    assert findings == []


def test_no_template_contains_a_credential(templates: dict[str, Template]) -> None:
    """Anywhere at all: a tag, a parameter default, a policy, an output."""
    found = {
        stack: kinds
        for stack, template in templates.items()
        if (kinds := credential_in(json.dumps(template.to_json())))
    }
    assert found == {}


def test_an_identity_provider_secret_comes_from_secrets_manager(
    templates: dict[str, Template],
) -> None:
    """FR-ACC-02: the Google client secret is resolved at deploy time.

    Holds for every federated provider, so it guards Google sign-in from the
    moment it is added, not only once someone remembers to test it.
    """
    for template in templates.values():
        for provider in template.find_resources("AWS::Cognito::UserPoolIdentityProvider").values():
            secret = json.dumps(provider["Properties"]["ProviderDetails"].get("client_secret", ""))
            assert SECRET_REFERENCE.search(secret), provider["Properties"]["ProviderName"]
