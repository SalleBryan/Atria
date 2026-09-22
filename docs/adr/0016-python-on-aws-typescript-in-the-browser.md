# 0016. Python on AWS, TypeScript in the browser

Status: accepted
Source: project decision, 2026-09-22

## Decision

Everything that runs on AWS is Python: the CDK application and all Lambda
services. The React web client is TypeScript and the mobile client is Flutter,
because those platforms leave no choice.

The specification lives in `spec/` as Python modules and is the single source
for roles and permissions, the entity model, the DynamoDB key design and the
lifecycles. Python code imports it directly. The web client gets generated
TypeScript from `spec/generate.py`, checked in and verified in CI, so the
browser cannot hold a second, drifting copy of the permission matrix or the
state machines.

## Consequences

The permission matrix, the state machines and the key design are defined once.
A change to a lifecycle transition reaches the services by import and the web
client by regeneration, and CI fails if the generated files were not
regenerated.

Lambda packaging uses a dependency layer built by `infra/build_layer.py` with
`pip install --target`, so no Docker is needed to synthesise or deploy.

Type checking and linting are per language: `ruff` and `mypy --strict` for
Python, the TypeScript compiler and ESLint for the web client, and
`flutter analyze` for the app. There is no shared toolchain across them, and
no attempt to invent one.

The documents in `Documentation v2` were produced by scripts that import the
same spec modules, so regenerating a document after a spec change stays a
one-command operation.
