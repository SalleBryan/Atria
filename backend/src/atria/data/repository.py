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

    def query_index(
        self, index: str, attribute: str, value: str, *, limit: int | None = None
    ) -> list[Item]:
        """Every item an index points at for one key value."""
        kwargs: dict[str, Any] = {
            "IndexName": index,
            "KeyConditionExpression": "#k = :v",
            "ExpressionAttributeNames": {"#k": attribute},
            "ExpressionAttributeValues": {":v": value},
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
    ) -> Item:
        """Change fields on an item that must already exist.

        `expect` adds an attribute equality condition, which is how a state
        change is made safe against two requests racing: the caller says which
        state it believed the record was in.
        """
        names = {f"#f{i}": field for i, field in enumerate(set_values)}
        values = {f":v{i}": value for i, value in enumerate(set_values.values())}
        assignments = ", ".join(f"{n} = :v{i}" for i, n in enumerate(names))
        condition = "attribute_exists(pk) AND attribute_exists(sk)"
        if expect is not None:
            field, expected = expect
            names["#expect"] = field
            values[":expect"] = expected
            condition += " AND #expect = :expect"
        try:
            response = self._table.update_item(
                Key=key.as_item(),
                UpdateExpression=f"SET {assignments}",
                ConditionExpression=condition,
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                if expect is None:
                    raise NotFound(f"no such {what}") from exc
                raise Conflict(f"that {what} is no longer in the expected state") from exc
            raise
        return dict(response["Attributes"])

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
