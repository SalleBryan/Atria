"""Contract for the synthetic Fapshi payment API, outside booking and fees.

FR-MSR-07 and ADRs 0007 and 0030 continue to govern Atria's payment scope.
This test API uses a separate store and a fixed synthetic amount.
"""

PERMISSION = "payment_sandbox.use"
ENABLED_ENV = "FAPSHI_SANDBOX_ENABLED"
PAYMENT_PATH = "/admin/payment-sandbox/{id}"
WEBHOOK_PATH = "/webhooks/fapshi"
TABLE_ENV = "FAPSHI_SANDBOX_TABLE"
SECRET_ENV = "FAPSHI_SANDBOX_SECRET_NAME"
WEBHOOK_HEADER = "x-wh-secret"

CURRENCY = "XAF"
TEST_AMOUNT = 500
REFERENCE_PREFIX = "atria-sandbox-"
PROVIDER_STATUSES = ("CREATED", "PENDING", "SUCCESSFUL", "FAILED", "EXPIRED")
