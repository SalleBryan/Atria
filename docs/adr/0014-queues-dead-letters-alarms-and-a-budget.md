# 0014. Queues, dead letters, alarms and a budget

Status: accepted
Source: AD-14 in the Technical Document (ATR-TD-001, section 3)

## Decision

Every asynchronous consumer reads from SQS with a dead letter queue. CloudWatch alarms, X-Ray on
the booking path, AWS Budgets with anomaly detection, WAF, CloudTrail and customer-managed KMS
keys are part of the baseline.

## Consequences

Established by the notice pipeline, 2026-09-23, and verified against acceptance test BR-09:
40 emails to the SES mailbox simulator, 40 message log entries SENT, every queue empty after.

The pipeline is change capture on the main table, a FIFO outbox queue, and a sender. The
stream is the source of truth for what happened, so a booking that committed cannot then fail
to notify, which it could if the API enqueued the notice itself and died between the two.

One deliberate departure from the Technical Document, which sketches two queues with a
notification service composing between them. The sender has to re-read the appointment and
the patient's current contact details at send time regardless (FR-REM-02, FR-REM-03), so
composing earlier would compose twice and act on the earlier of two answers. Composition
lives in the sender and there is one queue. The scheduled reminder path joins the same queue.

Consequences that followed, and are worth knowing before changing any of this:

- Two failure queues, not one, because AWS pulls the two failure paths in opposite
  directions. A FIFO queue's dead letter queue must be FIFO; a stream consumer's on-failure
  destination must not be. Synthesis accepted a FIFO destination and only the deploy refused
  it, so the rule is pinned by a synthesis test.
- The stream is read from LATEST. It holds 24 hours, and starting at the horizon would replay
  yesterday's changes on every first deploy and send a second confirmation for each booking.
- One message log row per message, not per attempt. The row is keyed on the queue's message
  id and its first-enqueued time, both of which survive redelivery, so a send throttled and
  then retried settles on a single SENT row. A row per attempt would leave a FAILED entry
  beside the SENT one for a message the patient received.
- The sender is capped at two concurrent invocations through the queue mapping, because
  messages for different appointments sit in different FIFO groups and would otherwise burst
  past the SES sandbox rate of one a second. It is capped there rather than by reserving
  concurrency: the development account's limit is 10, AWS keeps all 10 unreserved, and
  reserving any fails the deploy.
- The sender will not send a confirmation for an appointment already cancelled. A patient who
  books and cancels within seconds receives the cancellation and not a contradictory
  confirmation after it.

Alarms on the dead letter queues are not yet in place and belong with the observability work.
