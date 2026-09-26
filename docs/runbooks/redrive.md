# Redriving the dead letter queues

NFR-REL-04. Every asynchronous consumer has a dead letter queue that keeps
messages 14 days. An alarm (`atria-<env>-<queue>-dead-letters`) mails the
alarms topic as soon as one message arrives in any of them.

| Queue | Holds | Gets there when |
|---|---|---|
| `outbox-dlq.fifo` | a notice or reminder job | the sender failed it five times |
| `reminder-failures` | a reminder job | EventBridge Scheduler could not put it on the outbox within the hour |
| `stream-failures` | a pointer to a range of stream records | the dispatcher could not turn a table change into jobs |

## Procedure

1. **Find the cause first.** Read the function's log for the appointment the
   message names (`/aws/lambda/atria-<env>-noticesender` for outbox and
   reminder, `-outboxdispatcher` for stream). A message redriven into the same
   fault fails again and comes back.
2. **Fix and deploy** whatever failed.
3. **Look before you send:**

       python tools/redrive.py              how many wait in each queue
       python tools/redrive.py outbox       what would be redriven, and nothing is changed

4. **Decide whether each message is still worth sending.** A booking
   confirmation for a visit that is long past helps nobody. Messages you do not
   redrive expire after 14 days.
5. **Redrive:**

       python tools/redrive.py outbox --write

   Outbox and reminder jobs go back onto the outbox, in the appointment's own
   message group, with a deduplication id made from the dead message's id, so
   running it twice in five minutes sends nothing twice. The sender drops a
   notice for an appointment that has moved on instead of sending it.

   Stream pointers are read back from the table's stream and handed to the
   dispatcher. A stream keeps records 24 hours; an older pointer is reported
   and left on the queue, and the appointments in that range are checked by
   hand in the staff console.
6. **Confirm** the queue is empty (`python tools/redrive.py`) and the alarm
   returns to OK.

## Tested

2026-09-26 on dev: a SCHEDULE_REMINDER job for a cancelled appointment
(a-3e7e3cde8c174e25) was put on `reminder-failures`, redriven with
`python tools/redrive.py reminder --write`, and the sender logged "no
reminder, the appointment moved on" at 19:58:16 UTC. Nothing was sent. The dry
run found a fault in the tool itself (it held messages invisible, so a
redrive straight after found none), fixed the same day.

Four messages from 2026-09-23 development runs were in `outbox-dlq.fifo` at
the time and were deliberately not redriven: they are confirmations for
visits already past, and expire on 2026-10-07.
