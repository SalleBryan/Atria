# infra

The AWS CDK application, in Python.

## Stacks

| Stack | Holds |
| --- | --- |
| `atria-dev-data` | The main table with its five indexes, the care context table on its own customer-managed key, point in time recovery. |
| `atria-dev-identity` | The Cognito user pool and the patient, staff and admin app clients. |
| `atria-dev-api` | The REST API, the request authoriser, the service functions and the shared dependency layer. |
| `atria-dev-observability` | Alarms for server errors, latency and authoriser failures, and one dashboard. |
| `atria-dev-cost-guard` | The monthly budget with three actual thresholds and a forecast threshold. |

The async and network stacks in the Technical Document arrive with the work
that needs them: the reminder path and web hosting.

## Running it

The `cdk` command runs `python app.py`, so the virtual environment has to be
active first:

```bash
.venv/Scripts/activate            # PowerShell: .venv\Scripts\Activate.ps1
cd infra
pytest
npx aws-cdk@2 synth
npx aws-cdk@2 deploy --all
```

`app.py` builds the Lambda assets before synthesising, so there is no separate
build step and no Docker. The build installs the dependency layer for the
Lambda platform rather than the machine doing the build, which is why a
compiled wheel such as `pydantic-core` works after deployment from Windows.

First deployment into a fresh account needs the CDK bootstrap stack:

```bash
npx aws-cdk@2 bootstrap aws://340752829171/us-east-1
```

## Conventions

Resource names carry the environment prefix (`atria-dev-`), so a second
environment can share the account. Nothing reads `os.environ`: everything that
differs between environments is in `atria_infra/config.py`.

`cdk-nag` is installed but not yet wired into synthesis. It runs as a review
step before the first deployment that carries real traffic, and its findings
either get fixed or get a suppression with a reason.
