"""What counts as a secret, for BR-10.

BR-10: Secrets Manager holds every sensitive key, and nothing is hardcoded in
environment configuration. Two checks read this one definition: the
infrastructure tests, against every synthesised template, and
tools/scan_secrets.py, against the deployed functions and the tracked files.

A name is suspect when it says it holds a secret. A value is suspect when it
has the shape of a known credential, whatever it is called. Neither check is
proof that nothing leaked; together they catch the usual ways it happens: a
key pasted into an environment variable, and a credential committed to a file.
"""

from __future__ import annotations

import re

SECRET_NAME = re.compile(
    r"(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE_?KEY|API_?KEY|CREDENTIAL|AUTH_?KEY)",
    re.IGNORECASE,
)
# A name for where a secret is kept, not for the secret.
POINTER = re.compile(r"_(ARN|NAME|ID)$", re.IGNORECASE)

# The shapes of real credentials, each named so a finding says what it is.
SECRET_VALUES: dict[str, re.Pattern[str]] = {
    "AWS access key id": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "AWS secret access key": re.compile(r"aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{40}", re.IGNORECASE),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "Google OAuth client secret": re.compile(r"\bGOCSPX-[A-Za-z0-9_-]{20,}"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    "Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    "JSON web token": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+"),
}

# A value that is a reference to a secret rather than the secret itself.
SECRET_REFERENCE = re.compile(r"\{\{resolve:secretsmanager:|arn:aws:secretsmanager:")


def credential_in(text: str) -> list[str]:
    """The kinds of credential the text contains, by name."""
    return [kind for kind, pattern in SECRET_VALUES.items() if pattern.search(text)]


def environment_findings(variables: dict[str, object]) -> list[str]:
    """What is wrong with one function's environment, or nothing.

    A value that is not a string is a CloudFormation reference, resolved at
    deploy time to a name or an ARN, so only its name is judged.
    """
    findings = []
    for name, value in variables.items():
        text = value if isinstance(value, str) else ""
        if SECRET_REFERENCE.search(text):
            continue
        # GOOGLE_SECRET_ARN names where the secret is, which is the right way
        # to hand a function a secret; only the value decides that one.
        if SECRET_NAME.search(name) and not POINTER.search(name):
            findings.append(f"{name}: the name says it holds a secret")
        findings.extend(f"{name}: holds a {kind}" for kind in credential_in(text))
    return findings
