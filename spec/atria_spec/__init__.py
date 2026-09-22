"""Atria Rev B specification as data.

Roles and permissions, the entity model, the DynamoDB key design and the
lifecycles. Everything that runs on AWS imports this package; the browser and
the mobile client get generated copies from spec/generate.py.
"""

from atria_spec import keys, lifecycle, model, roles

__all__ = ["keys", "lifecycle", "model", "roles"]
