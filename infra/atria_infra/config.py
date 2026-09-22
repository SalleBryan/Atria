"""Environment configuration for the CDK application.

One development environment for now, in us-east-1 (Atria Rev B: development in
us-east-1 only). Everything that differs between environments lives here, so a
stack never reads os.environ directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

DEV_ACCOUNT = "340752829171"


@dataclass(frozen=True, slots=True)
class Environment:
    """One deployment target."""

    name: str
    account: str
    region: str

    # Cost guard. The budget is deliberately small: development is synthetic
    # data and a handful of requests, so anything larger means a mistake.
    monthly_budget_usd: int = 25
    budget_alert_emails: tuple[str, ...] = ()

    # Per-tenant daily SMS spend cap, in XAF. Enforced by the reminder worker
    # and alarmed here (ADR 0014).
    daily_sms_cap_xaf: int = 5_000

    log_retention: str = "ONE_MONTH"
    """A member name of aws_logs.RetentionDays, such as ONE_MONTH or ONE_YEAR."""

    removal_protection: bool = False
    """Development tables and pools are destroyed with the stack. Set for production."""

    tags: dict[str, str] = field(default_factory=dict)

    @property
    def prefix(self) -> str:
        """Prefix for every resource name, so two environments can share an account."""
        return f"atria-{self.name}"

    def stack_name(self, stack: str) -> str:
        return f"{self.prefix}-{stack}"


DEV = Environment(
    name="dev",
    account=DEV_ACCOUNT,
    region="us-east-1",
    budget_alert_emails=("bryanjakevita@gmail.com",),
    tags={
        "Project": "Atria",
        "Environment": "dev",
        "Revision": "RevB",
        "DataClassification": "synthetic",
    },
)

ENVIRONMENTS: dict[str, Environment] = {DEV.name: DEV}


def get(name: str) -> Environment:
    if name not in ENVIRONMENTS:
        known = ", ".join(sorted(ENVIRONMENTS))
        raise KeyError(f"unknown environment {name!r}. Known: {known}")
    return ENVIRONMENTS[name]
