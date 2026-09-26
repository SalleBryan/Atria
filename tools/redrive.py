"""Put what the dead letter queues hold back through the system (NFR-REL-04).

    python tools/redrive.py                        how many wait in each queue
    python tools/redrive.py outbox  [--write]      notices the sender gave up on
    python tools/redrive.py reminder [--write]     reminders the scheduler could not deliver
    python tools/redrive.py stream  [--write]      stream records the dispatcher could not handle

Without --write it only says what it would do. The procedure, and when to use
each, is docs/runbooks/redrive.md. Fix the cause first: a message redriven
into the same fault comes straight back.

outbox and reminder go back onto the outbox queue, in the appointment's own
message group so its notices stay in order. Each carries a deduplication id
made from the dead message's id, so running the same redrive twice within
five minutes sends nothing twice. The sender is idempotent past that: a
notice for an appointment that has moved on is dropped, not sent.

stream holds pointers, not changes: a shard and a range of sequence numbers.
The records are read back from the table's stream and handed to the
dispatcher as the event it would have had. A stream keeps records 24 hours,
so a pointer older than that can only be reported, and the appointments it
names checked by hand.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import boto3

REGION = "us-east-1"
PREFIX = "atria-dev"
QUEUES = {
    "outbox": f"{PREFIX}-outbox-dlq.fifo",
    "reminder": f"{PREFIX}-reminder-failures",
    "stream": f"{PREFIX}-stream-failures",
}
OUTBOX = f"{PREFIX}-outbox.fifo"
DISPATCHER = f"{PREFIX}-outboxdispatcher"


def queue_url(sqs: Any, name: str) -> str:  # noqa: ANN401  a boto3 client
    return str(sqs.get_queue_url(QueueName=name)["QueueUrl"])


def waiting(sqs: Any, url: str) -> int:  # noqa: ANN401
    count = "ApproximateNumberOfMessages"
    return int(sqs.get_queue_attributes(QueueUrl=url, AttributeNames=[count])["Attributes"][count])


def drain(sqs: Any, url: str) -> list[dict[str, Any]]:  # noqa: ANN401
    """Every message in the queue, held invisible for five minutes while it is redriven."""
    messages: list[dict[str, Any]] = []
    while True:
        batch = sqs.receive_message(
            QueueUrl=url,
            MaxNumberOfMessages=10,
            VisibilityTimeout=300,
            WaitTimeSeconds=1,
            MessageSystemAttributeNames=["All"],
        ).get("Messages", [])
        if not batch:
            return messages
        messages += batch


def back_to_outbox(message: dict[str, Any]) -> dict[str, str]:
    """The send that puts one dead notice or reminder back on the outbox."""
    body = message["Body"]
    job = json.loads(body)
    return {
        "MessageBody": body,
        "MessageGroupId": str(job["appointmentId"]),
        "MessageDeduplicationId": f"redrive-{message['MessageId']}",
    }


def stream_event(streams: Any, pointer: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:  # noqa: ANN401
    """The records one failure pointer names, or why they cannot be read back."""
    info = pointer.get("DDBStreamBatchInfo") or {}
    try:
        iterator = streams.get_shard_iterator(
            StreamArn=info["streamArn"],
            ShardId=info["shardId"],
            ShardIteratorType="AT_SEQUENCE_NUMBER",
            SequenceNumber=info["startSequenceNumber"],
        )["ShardIterator"]
    except streams.exceptions.TrimmedDataAccessException:
        return [], "older than the stream's 24 hours"
    except (KeyError, streams.exceptions.ResourceNotFoundException):
        return [], "the pointer names no stream or shard that exists"
    last = int(info["endSequenceNumber"])
    records: list[dict[str, Any]] = []
    while iterator:
        page = streams.get_records(ShardIterator=iterator, Limit=100)
        for record in page.get("Records", []):
            if int(record["dynamodb"]["SequenceNumber"]) > last:
                return records, None
            records.append({**record, "eventSourceARN": info["streamArn"]})
        if not page.get("Records"):
            break
        iterator = page.get("NextShardIterator")
    return records, None


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    sqs = boto3.client("sqs", region_name=REGION)

    if not args:
        for name, queue in QUEUES.items():
            print(f"{name:9} {waiting(sqs, queue_url(sqs, queue))} waiting")
        return 0
    which = args[0]
    if which not in QUEUES:
        print(f"no queue called {which}; choose from {', '.join(QUEUES)}")
        return 2

    url = queue_url(sqs, QUEUES[which])
    messages = drain(sqs, url)
    verb = "redrove" if write else "would redrive"
    done = 0

    if which in ("outbox", "reminder"):
        outbox = queue_url(sqs, OUTBOX)
        for message in messages:
            send = back_to_outbox(message)
            print(f"{verb} {send['MessageGroupId']}: {message['Body'][:120]}")
            if write:
                sqs.send_message(QueueUrl=outbox, **send)
                sqs.delete_message(QueueUrl=url, ReceiptHandle=message["ReceiptHandle"])
            done += 1
    else:
        streams = boto3.client("dynamodbstreams", region_name=REGION)
        functions = boto3.client("lambda", region_name=REGION)
        for message in messages:
            records, why = stream_event(streams, json.loads(message["Body"]))
            if why:
                print(f"cannot redrive {message['MessageId']}: {why}; left for a person to check")
                continue
            print(f"{verb} {len(records)} stream records")
            if write:
                payload = json.dumps({"Records": records}, default=str).encode()
                result = functions.invoke(FunctionName=DISPATCHER, Payload=payload)
                answer = json.loads(result["Payload"].read() or b"{}")
                if result.get("FunctionError") or answer.get("batchItemFailures"):
                    print(f"the dispatcher still refused some: {answer}; left on the queue")
                    continue
                sqs.delete_message(QueueUrl=url, ReceiptHandle=message["ReceiptHandle"])
            done += 1

    if not write:
        # A dry run only looked: make every message visible again at once, so
        # a redrive straight after it finds them rather than an empty queue.
        for message in messages:
            sqs.change_message_visibility(
                QueueUrl=url, ReceiptHandle=message["ReceiptHandle"], VisibilityTimeout=0
            )
    note = "" if write else " (dry run: add --write)"
    print(f"{done} of {len(messages)} {verb.split()[-1]}{note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
