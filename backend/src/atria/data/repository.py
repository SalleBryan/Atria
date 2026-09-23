"""The single table repository.

Every read and write of the main table goes through here, so the table name,
the key names and the conditional write idioms exist in one place. The methods
are the ones the services actually need; this is not a general purpose data
access library.

Two rules the type system cannot enforce, so they are enforced here:

    every item carries the tenant it belongs to, and
    a create is conditional, so a retried request cannot quietly overwrite.
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Sequence
from typing import TYPE_CHECKING, Any

import boto3
from botocore.exceptions import ClientError

from atria.core.errors import Conflict, NotFound
from atria.data.keys import Key

if TYPE_CHECKING:  # pragma: no cover
    from mypy_boto3_dynamodb.service_resource import Table
    from mypy_boto3_dynamodb.type_defs import TransactWriteItemTypeDef

Item = dict[str, Any]

MAIN_TABLE_ENV = "MAIN_TABLE"


class Repository:
    """The main table. One instance per container, reused across invocations."""

    def __init__(self, table: Table | None = None, table_name: str | None = None) -> None:
        if table is not None:
            self._table = table
        else:
            name = table_name or os.environ.get(MAIN_TABLE_ENV)
            if not name:
                raise RuntimeError(f"{MAIN_TABLE_ENV} is not set")
            self._table = boto3.resource("dynamodb").Table(name)

    # ------------------------------------------------------------------ reads
    def get(self, key: Key, *, consistent: bool = False) -> Item | None:
        response = self._table.get_item(Key=key.as_item(), ConsistentRead=consistent)
        item = response.get("Item")
        return dict(item) if item else None

    def require(self, key: Key, *, what: str, consistent: bool = False) -> Item:
        """Read an item, or raise NotFound.

        `what` names the kind of record, never the identifier: a caller outside
        the record's scope must not learn that it exists.
        """
        item = self.get(key, consistent=consistent)
        if item is None:
            raise NotFound(f"no such {what}")
        return item

    def query_partition(self, pk: str, *, sk_prefix: str | None = None) -> list[Item]:
        """Every item in one partition, optionally narrowed by sort key prefix."""
        expression = "#pk = :pk"
        values: dict[str, Any] = {":pk": pk}
        # DynamoDB refuses an attribute name the expression does not use, so
        # the sort key is declared only when it is being matched on.
        names = {"#pk": "pk"}
        if sk_prefix is not None:
            expression += " AND begins_with(#sk, :sk)"
            values[":sk"] = sk_prefix
            names["#sk"] = "sk"
        return list(
            self._paginate(
                KeyConditionExpression=expression,
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
            )
        )

    def get_many(self, wanted: Sequence[Key]) -> dict[tuple[str, str], Item]:
        """Read many items by key in as few calls as possible.

        Needed because a slot lock is one item per grid unit in its own
        partition (ADR 0004), so a day's locks cannot be reached by a query.
        Returned by (pk, sk) rather than as a list, because the caller is
        asking which of a known set exist.
        """
        if not wanted:
            return {}
        client = self._table.meta.client
        found: dict[tuple[str, str], Item] = {}
        # BatchGetItem takes at most 100 keys per call.
        for start in range(0, len(wanted), 100):
            pending: list[dict[str, str]] = [key.as_item() for key in wanted[start : start + 100]]
            while pending:
                response = client.batch_get_item(RequestItems={self._table.name: {"Keys": pending}})
                for item in response.get("Responses", {}).get(self._table.name, []):
                    found[(str(item["pk"]), str(item["sk"]))] = dict(item)
                # A throttled batch returns what it could not read, and the
                # request has to be repeated for those keys alone.
                unprocessed: dict[str, Any] = dict(
                    response.get("UnprocessedKeys", {}).get(self._table.name, {})
                )
                pending = [
                    {"pk": str(key["pk"]), "sk": str(key["sk"])}
                    for key in unprocessed.get("Keys", [])
                ]
        return found

    def query_index(
        self,
        index: str,
        attribute: str,
        value: str,
        *,
        limit: int | None = None,
        sort_attribute: str | None = None,
        between: tuple[str, str] | None = None,
        ascending: bool = True,
    ) -> list[Item]:
        """Every item an index points at for one key value.

        `between` narrows the result on the index's sort key, which is what
        makes a range view one query rather than a read of everything the
        person has ever had.
        """
        names = {"#k": attribute}
        values: dict[str, Any] = {":v": value}
        condition = "#k = :v"
        if between is not None:
            if sort_attribute is None:
                raise ValueError("a range needs the sort attribute it applies to")
            names["#s"] = sort_attribute
            values[":from"] = between[0]
            values[":to"] = between[1]
            condition += " AND #s BETWEEN :from AND :to"

        kwargs: dict[str, Any] = {
            "IndexName": index,
            "KeyConditionExpression": condition,
            "ExpressionAttributeNames": names,
            "ExpressionAttributeValues": values,
            "ScanIndexForward": ascending,
        }
        if limit is not None:
            kwargs["Limit"] = limit
        return list(self._paginate(**kwargs))

    def _paginate(self, **kwargs: Any) -> Iterator[Item]:
        while True:
            response = self._table.query(**kwargs)
            for item in response.get("Items", []):
                yield dict(item)
            last = response.get("LastEvaluatedKey")
            if not last:
                return
            kwargs["ExclusiveStartKey"] = last

    # ----------------------------------------------------------------- writes
    def put_new(self, key: Key, item: Item, *, what: str) -> Item:
        """Create an item, refusing to overwrite one that is already there."""
        record = {**item, **key.as_item()}
        try:
            self._table.put_item(
                Item=record,
                ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise Conflict(f"that {what} already exists") from exc
            raise
        return record

    def put(self, key: Key, item: Item) -> Item:
        """Write an item, replacing whatever was there. For idempotent writes only."""
        record = {**item, **key.as_item()}
        self._table.put_item(Item=record)
        return record

    def update_existing(
        self,
        key: Key,
        *,
        set_values: Item,
        what: str,
        expect: tuple[str, Any] | None = None,
        remove: Sequence[str] = (),
    ) -> Item:
        """Change fields on an item that must already exist.

        `expect` adds an attribute equality condition, which is how a state
        change is made safe against two requests racing: the caller says which
        state it believed the record was in.

        `remove` deletes attributes outright, which is how an item leaves a
        sparse index: an index only holds items that carry its key, so removing
        the key is what takes the item out of the listing.
        """
        names = {f"#f{i}": field for i, field in enumerate(set_values)}
        values = {f":v{i}": value for i, value in enumerate(set_values.values())}
        clauses = []
        if set_values:
            assignments = ", ".join(f"{n} = :v{i}" for i, n in enumerate(names))
            clauses.append(f"SET {assignments}")
        if remove:
            gone = {f"#r{i}": field for i, field in enumerate(remove)}
            names.update(gone)
            clauses.append(f"REMOVE {', '.join(gone)}")
        if not clauses:
            raise ValueError("an update must set or remove something")
        condition = "attribute_exists(pk) AND attribute_exists(sk)"
        if expect is not None:
            field, expected = expect
            names["#expect"] = field
            values[":expect"] = expected
            condition += " AND #expect = :expect"
        request: dict[str, Any] = {
            "Key": key.as_item(),
            "UpdateExpression": " ".join(clauses),
            "ConditionExpression": condition,
            "ExpressionAttributeNames": names,
            "ReturnValues": "ALL_NEW",
        }
        if values:
            request["ExpressionAttributeValues"] = values
        try:
            response = self._table.update_item(**request)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                if expect is None:
                    raise NotFound(f"no such {what}") from exc
                raise Conflict(f"that {what} is no longer in the expected state") from exc
            raise
        return dict(response["Attributes"])

    def delete(self, key: Key) -> None:
        """Remove one item. Absent is success: the caller wanted it gone."""
        self._table.delete_item(Key=key.as_item())

    def change_together(
        self,
        *,
        creates: Sequence[tuple[Key, Item]] = (),
        updates: Sequence[tuple[Key, Item, tuple[str, Any] | None]] = (),
        deletes: Sequence[Key] = (),
        conflict: str,
    ) -> None:
        """Create, change and delete items in one transaction, or do none of it.

        What `write_together` is to a booking, this is to releasing one: a
        cancellation has to move the appointment, record the event and drop
        every lock it held, and any of those happening without the others
        would leave the time either double booked or lost.

        Each update is (key, fields to set, an optional expected attribute).
        The expectation is what makes a repeated request safe: the second
        cancellation finds the state it expected already gone and is refused
        with `conflict` rather than cancelling twice.
        """
        items: list[TransactWriteItemTypeDef] = []
        table = self._table.name

        for key, item in creates:
            items.append(
                {
                    "Put": {
                        "TableName": table,
                        "Item": {**item, **key.as_item()},
                        "ConditionExpression": (
                            "attribute_not_exists(pk) AND attribute_not_exists(sk)"
                        ),
                    }
                }
            )

        for key, set_values, expect in updates:
            if not set_values:
                raise ValueError("an update must set something")
            names = {f"#f{i}": field for i, field in enumerate(set_values)}
            values = {f":v{i}": value for i, value in enumerate(set_values.values())}
            # Built from the fields alone, before the expectation is added, so
            # the placeholders cannot drift out of step with the values.
            assignments = ", ".join(f"#f{i} = :v{i}" for i in range(len(set_values)))
            condition = "attribute_exists(pk) AND attribute_exists(sk)"
            if expect is not None:
                field, expected = expect
                names["#expect"] = field
                values[":expect"] = expected
                condition += " AND #expect = :expect"
            items.append(
                {
                    "Update": {
                        "TableName": table,
                        "Key": key.as_item(),
                        "UpdateExpression": f"SET {assignments}",
                        "ConditionExpression": condition,
                        "ExpressionAttributeNames": names,
                        "ExpressionAttributeValues": values,
                    }
                }
            )

        for key in deletes:
            items.append({"Delete": {"TableName": table, "Key": key.as_item()}})

        if not items:
            raise ValueError("a transaction must do something")

        try:
            self._table.meta.client.transact_write_items(TransactItems=items)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "TransactionCanceledException":
                raise Conflict(conflict) from exc
            raise

    def write_together(self, creates: Sequence[tuple[Key, Item]]) -> list[Item]:
        """Create several items in one transaction, or none of them.

        Used where a record is only meaningful alongside another: a staff
        membership without its person, or a clinician profile without its
        membership, would be a half provisioned account.
        """
        records = [{**item, **key.as_item()} for key, item in creates]
        client = self._table.meta.client
        try:
            client.transact_write_items(
                TransactItems=[
                    {
                        "Put": {
                            "TableName": self._table.name,
                            "Item": record,
                            "ConditionExpression": (
                                "attribute_not_exists(pk) AND attribute_not_exists(sk)"
                            ),
                        }
                    }
                    for record in records
                ]
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "TransactionCanceledException":
                raise Conflict("one of those records already exists") from exc
            raise
        return records
