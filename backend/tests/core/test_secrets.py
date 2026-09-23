"""The BR-10 rule for what counts as a secret, on known cases either side of it."""

from __future__ import annotations

import pytest
from atria_spec.secrets import credential_in, environment_findings

# Assembled at run time, so this file never contains a credential-shaped
# literal for the repository scan to find.
ACCESS_KEY = "AKIA" + "Z" * 16
GOOGLE = "GOCSPX-" + "a" * 28


def test_ordinary_configuration_passes() -> None:
    assert (
        environment_findings(
            {
                "MAIN_TABLE": "atria-dev-main",
                "COGNITO_CLIENT_IDS": "abc,def",
                "POWERTOOLS_SERVICE_NAME": "atria",
                "USER_POOL_ID": {"Ref": "UserPool"},
            }
        )
        == []
    )


@pytest.mark.parametrize("name", ["GOOGLE_CLIENT_SECRET", "DB_PASSWORD", "API_KEY", "AUTH_TOKEN"])
def test_a_name_that_says_secret_is_refused(name: str) -> None:
    assert environment_findings({name: "anything"})


def test_a_pointer_to_a_secret_is_how_it_should_be_done() -> None:
    assert environment_findings({"GOOGLE_SECRET_ARN": {"Ref": "GoogleSecret"}}) == []


def test_a_resolved_reference_is_not_a_secret() -> None:
    value = "{{resolve:secretsmanager:atria/dev/google:SecretString:clientSecret}}"
    assert environment_findings({"GOOGLE_CLIENT_SECRET": value}) == []


def test_a_credential_is_refused_whatever_it_is_called() -> None:
    assert environment_findings({"SETTING": ACCESS_KEY}) == ["SETTING: holds a AWS access key id"]


def test_credentials_are_named_by_kind() -> None:
    assert credential_in(f"id={ACCESS_KEY} google={GOOGLE}") == [
        "AWS access key id",
        "Google OAuth client secret",
    ]
    assert credential_in("atria-dev-main") == []
