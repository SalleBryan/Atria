# 0014. Queues, dead letters, alarms and a budget

Status: accepted
Source: AD-14 in the Technical Document (ATR-TD-001, section 3)

## Decision

Every asynchronous consumer reads from SQS with a dead letter queue. CloudWatch alarms, X-Ray on
the booking path, AWS Budgets with anomaly detection, WAF, CloudTrail and customer-managed KMS
keys are part of the baseline.

## Consequences

Recorded from the specification. Fill in the implementation consequences as the code
that depends on this decision lands, and link the pull requests that establish them.
