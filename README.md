# Atria

Healthcare appointment booking for Cameroon. Patients book general
consultations, specialist consultations and procedures; clinic staff run the day
from four role consoles.

Rev B. The specifications this code implements are the Software Requirements
Specification (ATR-SRS-001), the Design Specification (ATR-DS-001) and the
Technical Document (ATR-TD-001).

## Repository layout

| Path | What it holds |
| --- | --- |
| `spec/` | The specification as data: roles and permissions, the entity model, the table design, the lifecycles. The single source for both the code and the documents. |
| `backend/` | Lambda services in Python, with the domain rules, the data access layer and the shared HTTP layer. |
| `infra/` | AWS CDK application in Python. |
| `web/` | React web client for all roles. TypeScript. |
| `app/` | Flutter application for patients and staff. |
| `docs/` | Architecture decision records, the API contract, the constraints. |

Everything that runs on AWS is Python and imports `spec/` directly. The web
client cannot, so it holds a generated copy that CI checks is current
(ADR 0016).

## Environments

One development environment in `us-east-1`, account 340752829171. Development
runs on synthetic data only: no real patient data reaches any environment in
this repository (constraint C-03).

## Getting started

Requirements: Python 3.13 or later, Node 24 or later for the CDK command line,
the AWS CLI with credentials, Flutter 3.44 or later for the mobile client.

```bash
python -m venv .venv
.venv/Scripts/activate            # PowerShell: .venv\Scripts\Activate.ps1
pip install -e ./spec -e "./backend[dev]" -r infra/requirements-dev.txt
```

Then, from the repository root:

```bash
ruff check spec backend && ruff format --check spec backend
cd backend && mypy && pytest
```

Infrastructure, from `infra/`:

```bash
pytest && npx aws-cdk@2 synth
```

After changing anything in `spec/`, regenerate the web client's copy:

```bash
python spec/generate.py
```

## Where things are decided

| Question | Answer lives in |
| --- | --- |
| Who may do what | `spec/atria_spec/roles.py`, applied by `backend/src/atria/core/permissions.py` |
| What states a booking can move through | `spec/atria_spec/lifecycle.py`, applied by `backend/src/atria/core/lifecycle.py` |
| How records are keyed | `spec/atria_spec/keys.py`, built by `backend/src/atria/data/keys.py` |
| Why the architecture is shaped this way | `docs/adr/` |
| What the API promises | `docs/openapi/atria.yaml`, with the backlog in `docs/openapi/routes.md` |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for branch, commit and review
conventions, and [docs/adr](docs/adr) for the decisions this code is built on.
