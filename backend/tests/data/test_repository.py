"""The shared table access layer, at the edges the services rely on.

Most of the repository is covered through the services that use it. What is
here are the cases those services do not happen to reach, and which fail
against DynamoDB rather than against a mock.
"""

from __future__ import annotations

import pytest

from atria.data.keys import Key

pytestmark = pytest.mark.usefixtures("table")

PARTITION = "TENANT#t1#THING#x"


@pytest.fixture
def filled(repository):
    for suffix in ("ALPHA", "BETA#1", "BETA#2"):
        repository.put(Key(PARTITION, suffix), {"marker": suffix})
    return repository


class TestQueryPartition:
    def test_a_whole_partition_is_returned_without_a_prefix(self, filled):
        """A query with no sort key prefix must not declare one either: DynamoDB
        refuses an expression attribute name that goes unused."""
        found = filled.query_partition(PARTITION)
        assert {item["marker"] for item in found} == {"ALPHA", "BETA#1", "BETA#2"}

    def test_a_prefix_narrows_the_partition(self, filled):
        found = filled.query_partition(PARTITION, sk_prefix="BETA#")
        assert {item["marker"] for item in found} == {"BETA#1", "BETA#2"}

    def test_an_empty_partition_is_an_empty_list(self, filled):
        assert filled.query_partition("TENANT#t1#THING#nothing") == []
