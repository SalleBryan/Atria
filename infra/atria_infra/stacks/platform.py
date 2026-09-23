"""PlatformStack: what every Lambda function in every stack needs.

The dependency layer is 29 MB, so it is built and published once here rather
than per stack. The function code asset is small enough that each stack
uploads its own from the same folder.

This stack is not in the Technical Document's list: the seven there describe
the deployed architecture, and this one exists because two stacks need the same
layer and CDK will not let a stack reach into another to add a trigger.
"""

from __future__ import annotations

import pathlib
from typing import Any

from aws_cdk import Duration, RemovalPolicy, Stack
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from constructs import Construct

from atria_infra.config import Environment

# Must match infra/build.py.
RUNTIME = lambda_.Runtime.PYTHON_3_13
ARCHITECTURE = lambda_.Architecture.X86_64


class PlatformStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        settings: Environment,
        *,
        build_dir: pathlib.Path,
        **kwargs: Any,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        self.settings = settings
        self.build_dir = build_dir

        self.layer = lambda_.LayerVersion(
            self,
            "DependencyLayer",
            layer_version_name=f"{settings.prefix}-dependencies",
            code=lambda_.Code.from_asset(str(build_dir / "layer")),
            compatible_runtimes=[RUNTIME],
            compatible_architectures=[ARCHITECTURE],
            description="aws-lambda-powertools, pydantic, pyjwt, tzdata",
        )


def service_function(
    scope: Construct,
    name: str,
    *,
    settings: Environment,
    build_dir: pathlib.Path,
    layer: lambda_.ILayerVersion,
    handler: str,
    description: str,
    environment: dict[str, str],
    timeout_seconds: int = 10,
    memory_mb: int = 512,
) -> lambda_.Function:
    """One service function, wired the same way wherever it is created."""
    log_group = logs.LogGroup(
        scope,
        f"{name}Logs",
        log_group_name=f"/aws/lambda/{settings.prefix}-{name.lower()}",
        retention=logs.RetentionDays(settings.log_retention),
        removal_policy=RemovalPolicy.DESTROY,
    )
    return lambda_.Function(
        scope,
        name,
        function_name=f"{settings.prefix}-{name.lower()}",
        runtime=RUNTIME,
        architecture=ARCHITECTURE,
        code=lambda_.Code.from_asset(str(build_dir / "app")),
        handler=handler,
        description=description,
        layers=[layer],
        environment=environment,
        memory_size=memory_mb,
        timeout=Duration.seconds(timeout_seconds),
        tracing=lambda_.Tracing.ACTIVE,
        log_group=log_group,
    )
