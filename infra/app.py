#!/usr/bin/env python
"""The Atria CDK application.

    cdk synth                       synthesise the dev environment
    cdk deploy --all                deploy every stack
    cdk deploy atria-dev-api        deploy one
    cdk synth -c environment=dev    choose the environment explicitly

Stacks land as their milestones do. Present: platform, data, identity, api,
async, observability, cost guard, deploy access. The network stack in the Technical Document
arrives with web hosting.
"""

from __future__ import annotations

import aws_cdk as cdk

from atria_infra import config
from atria_infra.stacks.api import ApiStack
from atria_infra.stacks.async_stack import AsyncStack
from atria_infra.stacks.cost_guard import CostGuardStack
from atria_infra.stacks.data import DataStack
from atria_infra.stacks.deploy_access import DeployAccessStack
from atria_infra.stacks.identity import IdentityStack
from atria_infra.stacks.observability import ObservabilityStack
from atria_infra.stacks.platform import PlatformStack
from build import build


def main() -> cdk.App:
    app = cdk.App()
    name = app.node.try_get_context("environment") or "dev"
    env = config.get(str(name))
    target = cdk.Environment(account=env.account, region=env.region)

    # The Lambda assets are built before synthesis, so `cdk synth` and
    # `cdk deploy` need no separate build step and no Docker.
    build_dir = build()

    platform = PlatformStack(app, env.stack_name("platform"), settings=env, build_dir=build_dir, env=target)
    data = DataStack(app, env.stack_name("data"), settings=env, env=target)
    identity = IdentityStack(
        app,
        env.stack_name("identity"),
        settings=env,
        platform=platform,
        data=data,
        build_dir=build_dir,
        env=target,
    )
    api = ApiStack(
        app,
        env.stack_name("api"),
        settings=env,
        data=data,
        identity=identity,
        platform=platform,
        build_dir=build_dir,
        env=target,
    )
    AsyncStack(
        app,
        env.stack_name("async"),
        settings=env,
        data=data,
        platform=platform,
        build_dir=build_dir,
        env=target,
    )
    ObservabilityStack(app, env.stack_name("observability"), settings=env, api=api, env=target)
    CostGuardStack(app, env.stack_name("cost-guard"), settings=env, env=target)
    DeployAccessStack(app, env.stack_name("deploy-access"), settings=env, env=target)

    for key, value in env.tags.items():
        cdk.Tags.of(app).add(key, value)

    return app


if __name__ == "__main__":
    main().synth()
