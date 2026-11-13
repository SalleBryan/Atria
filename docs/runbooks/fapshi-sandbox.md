# Fapshi sandbox

Atria's development admin console can create a synthetic 500 XAF checkout. Its
Lambda has a separate DynamoDB table and server-side sandbox credentials. Access
requires a tenant administrator with an authenticator. ADRs
[0007](../adr/0007-fee-ledger-without-moving-money.md) and
[0030](../adr/0030-commercial-scope-moves-into-phase-3.md) govern production
payments. The sandbox uses its own attempt records. To price an appointment's
checkout it may read the booking table (the appointment and its fee band,
`GetItem` and `Query` only, plus decrypt on its key); it never writes the
booking table or the fee ledger.

## Enter the sandbox credentials

1. In the [Fapshi dashboard](https://dashboard.fapshi.com/), choose **Developers**,
   open the dedicated test collection service, and open its **Sandbox** tab.
   Copy the API User and API Key from that tab. The key starts with `FAK_TEST_`.
   Regenerate the test key if it was shared. [Fapshi service setup](https://docs.fapshi.com/en/api-reference/create-a-service)
2. Generate a fresh random webhook secret in a password manager, using at least
   32 alphanumeric characters. Keep it for the Fapshi webhook setup below.
3. In the Atria development account, open [Secrets Manager in us-east-1](https://us-east-1.console.aws.amazon.com/secretsmanager/listsecrets?region=us-east-1).
   Choose **Store a new secret**, select **Other type of secret**, and enter
   these case-sensitive key/value pairs.

   | Key | Value |
   | --- | --- |
   | `apiuser` | API User from the collection service's **Sandbox** tab |
   | `apikey` | API Key from the same **Sandbox** tab |
   | `webhookSecret` | The random value generated in step 2 |

4. Choose the default encryption key `aws/secretsmanager`. Set **Secret name**
   to `atria/sandbox/fapshi` and choose **Store**. If the secret already exists,
   use **Retrieve secret value**, then **Edit**. Enter the values directly in
   the consoles and keep them out of chat, files and terminal commands.
   [AWS Secrets Manager setup](https://docs.aws.amazon.com/secretsmanager/latest/userguide/create_secret.html)

The Lambda reads the current secret at runtime. Rotation takes effect on the
next request. Update both Secrets Manager and Fapshi when rotating the shared
webhook secret.

## Deploy and register the webhook

The regular dev deployment creates the routes and sandbox table in
`atria-dev-api` and publishes the admin UI to Amplify. After that deployment,
open **CloudFormation → atria-dev-api → Outputs** in `us-east-1` and copy
`FapshiWebhookUrl`. It points to API Gateway and ends in `/dev/webhooks/fapshi`.

In Fapshi's dedicated test collection service, set the **Webhook URL** to that
output and the **Webhook secret** to the same value as `webhookSecret` in
Secrets Manager. Fapshi sends the secret in the `x-wh-secret` header.
[Fapshi webhook configuration](https://docs.fapshi.com/en/api-reference/endpoint/webhook)

## Run a synthetic checkout

1. Sign in to the dev web app as a tenant administrator with an authenticator.
   Go to **Settings → Payment sandbox → Create test checkout**.
2. Choose **Open test checkout**. Use Fapshi's MTN sandbox number `670000000`
   for success or `670000001` for failure. If checkout asks for a name or email,
   use a fictional name and an address under `example.com`.
   [Fapshi sandbox test numbers](https://docs.fapshi.com/en/api-reference/preliminary-knowledge/environment)
3. Return to the same Atria tab and choose **Check status**. Check the Fapshi
   dashboard for webhook delivery. Space status checks at least ten seconds
   apart. A failed hosted attempt can be retried on the same link until it
   expires. For a separate failure exercise after success, create a fresh test
   checkout. [Fapshi status API](https://docs.fapshi.com/en/api-reference/endpoint/payment-status) ·
   [Fapshi transaction handling](https://docs.fapshi.com/en/api-reference/preliminary-knowledge/transaction-handling)

## Reconcile errors

Atria sends checkout creation at most once per attempt ID. If a request times
out, check status on that attempt. The status route can recover the provider's
transaction ID after a lost initiation response. If Fapshi returns the
transaction without a checkout URL, use the test service dashboard to review
it. A creation refusal is safe to retry with a fresh attempt ID after resolving
the error.

A `503` means the sandbox credentials are missing or invalid. A `502` means
the provider call failed or its response could not be verified. If Lambda logs
show Fapshi returned `403` on initiation, check the credentials and the test
service's IP allowlist. The development Lambda has dynamic egress addresses.
A `429` means the request hit a rate limit. Fapshi sends each webhook once.
Use a dashboard resend or **Check status** after a delivery failure.
[Fapshi API errors](https://docs.fapshi.com/en/api-reference/preliminary-knowledge/request-status) ·
[Fapshi webhook delivery](https://docs.fapshi.com/en/api-reference/endpoint/webhook)

## Pay for an appointment (sandbox)

1. As the patient, open a visit that has a fee and choose **Pay ... now**.
   Atria starts a sandbox checkout for exactly the fee band in force on the
   visit day (`POST /appointments/{id}/payment`, a new UUIDv4 `attemptId`).
2. Choose **Open the test checkout** and pay with Fapshi's MTN sandbox number
   `670000000` (success) or `670000001` (failure). Return and choose
   **I have paid, check**.
3. As the receptionist or administrator, open the same visit in the console.
   The **Fee payment** row reads **Paid in full** only when Fapshi's status API
   reports a successful collection of the full amount; a short or failed
   payment stays **Not paid**. **Check again** refreshes it.

A visit with no fee band, a free visit, a cancelled visit or one already paid
cannot start a checkout (`409`). Whoever may read the appointment may start one
or see its status. Synthetic money only; nothing reaches the fee ledger.
