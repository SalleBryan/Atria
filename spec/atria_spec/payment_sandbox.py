"""Contract for Fapshi payments and the development-only checkout tool.

ADR 0023 allows paying the visit fee through Fapshi. The development checkout
uses the same separate store and a fixed synthetic amount.
"""

PERMISSION = "payment_sandbox.use"
ENABLED_ENV = "FAPSHI_SANDBOX_ENABLED"
PAYMENT_PATH = "/admin/payment-sandbox/{id}"
# Pay one appointment's fee; the desk reads whether it was paid.
APPOINTMENT_PAYMENT_PATH = "/appointments/{id}/payment"
WEBHOOK_PATH = "/webhooks/fapshi"
TABLE_ENV = "FAPSHI_SANDBOX_TABLE"
SECRET_ENV = "FAPSHI_SANDBOX_SECRET_NAME"
# Which Fapshi environment the function talks to, set per deployment like the SMS sender:
# sandbox.fapshi.com in development, live.fapshi.com in production.
HOST_ENV = "FAPSHI_HOST"
HOSTS = ("sandbox.fapshi.com", "live.fapshi.com")
WEBHOOK_HEADER = "x-wh-secret"

CURRENCY = "XAF"
TEST_AMOUNT = 500
REFERENCE_PREFIX = "atria-sandbox-"
PROVIDER_STATUSES = ("CREATED", "PENDING", "SUCCESSFUL", "FAILED", "EXPIRED")
