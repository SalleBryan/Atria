"""Scan what is deployed and what is committed for secrets (BR-10).

    python tools/scan_secrets.py

BR-10: Secrets Manager holds every sensitive key; nothing is hardcoded in
environment configuration. The infrastructure tests hold the templates to that
(infra/tests/test_secrets.py). This checks the two places a template cannot
see: the environment of every function actually running in the account, which
someone could have edited by hand in the console, and every file git tracks.

The rule is atria_spec.secrets, shared with the tests. Read only: nothing is
changed, and no secret value is ever printed, only where one was found.

Development only, same reasoning as tools/smoke_me.py.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

import boto3
import devkit
from atria_spec.secrets import credential_in, environment_findings

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Files that configure secrets by name without holding one.
ENV_FILES = (".env", ".env.local", ".env.production")


def deployed_functions() -> dict[str, dict[str, str]]:
    """Every function of this environment, by name, with its environment."""
    client = boto3.client("lambda", region_name=devkit.REGION)
    found = {}
    for page in client.get_paginator("list_functions").paginate():
        for function in page["Functions"]:
            if function["FunctionName"].startswith(devkit.PREFIX):
                found[function["FunctionName"]] = function.get("Environment", {}).get(
                    "Variables", {}
                )
    return found


def tracked_files() -> list[pathlib.Path]:
    listed = subprocess.run(  # noqa: S603  a fixed git command
        ["git", "ls-files", "-z"],  # noqa: S607  git from PATH, as every developer runs it
        cwd=ROOT,
        capture_output=True,
        check=True,
    ).stdout.decode()
    return [ROOT / name for name in listed.split("\0") if name]


def main() -> int:
    findings: list[str] = []

    functions = deployed_functions()
    for name, variables in sorted(functions.items()):
        found = environment_findings(variables)
        findings.extend(f"function {name}: {finding}" for finding in found)
    print(f"deployed functions scanned: {len(functions)}")

    files = tracked_files()
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        if path.name in ENV_FILES:
            findings.append(f"file {relative}: an environment file is committed")
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary, or removed from the working tree
        findings.extend(f"file {relative}: holds a {kind}" for kind in credential_in(text))
    print(f"tracked files scanned: {len(files)}")

    secrets = boto3.client("secretsmanager", region_name=devkit.REGION)
    held = [
        entry["Name"]
        for page in secrets.get_paginator("list_secrets").paginate()
        for entry in page["SecretList"]
        if entry["Name"].startswith(("atria", devkit.PREFIX))
    ]
    print(f"secrets held in Secrets Manager for Atria: {held or 'none yet'}")

    print()
    if findings:
        for finding in findings:
            print(f"  FAIL {finding}")
        print(f"\nBR-10 does not hold: {len(findings)} findings")
        return 1
    print("BR-10 holds: no secret in any deployed function's environment or any tracked file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
