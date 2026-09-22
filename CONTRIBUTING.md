# Contributing

## Branches

`main` is always deployable. Work happens on short-lived branches taken from `main` and merged by
pull request. Name them `<type>/<short-subject>`, for example `feat/slot-lock-transaction` or
`fix/reminder-lead-time`. Rebase on `main` rather than merging it back in, and delete the branch
after the merge.

## Commits

Conventional commits, present tense, no trailing full stop in the subject:

```
feat(booking): lock consecutive grid units in one transaction
fix(authoriser): resolve tenant claim before the permission matrix
docs(adr): record the region pack decision
```

Types in use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `infra`.

Scopes follow the layout: `spec`, `infra`, `core`, `data`, `http`, `authoriser`, `identity`,
`booking`, `queue`, `tenant`, `ledger`, `notify`, `reminder`, `web`, `app`, `adr`, `openapi`, `ci`.

Every commit is authored by the person who made it. Commits carry no generated attribution
trailers.

## Pull requests

A pull request states what changed, which requirements it implements by identifier
(`FR-BKG-01`, `NFR-SEC-03`), and how it was verified. It must pass the checks before review:
`ruff`, `mypy --strict`, the test suites for `backend` and `infra`, `cdk synth`, and the check that
the web client's generated copy of the specification is current.

## Requirements traceability

Tests name the requirement they verify, so the verification column in the Software Requirements
Specification stays honest:

```python
class TestSpecialistBooking:
    def test_fr_bkg_02_locks_consecutive_units(self): ...
```

Or in the docstring of the test module, where a file covers several:

```python
"""Verifies FR-VIS-01, FR-VIS-03 and the state machine in UML-07a."""
```

## Data

Synthetic data only, in every environment (constraint C-03). No real patient data, no production
exports, no screenshots of real records in issues or pull requests.

## Changing the specification

`spec/` is the single source for roles, the data model, the table design and
the lifecycles. Change it there first, then run `python spec/generate.py` and
commit the regenerated web client copy in the same commit. CI fails if the two
disagree.

## Decisions

Architecture decisions live in [docs/adr](docs/adr). If a change contradicts one, change the
record in the same pull request rather than leaving the code and the record disagreeing.
