# spec

The specification as data. This folder is the single source for:

| Module | Holds |
| --- | --- |
| `roles.py` | The five roles, the permission matrix, scopes, guard rules, landing screens, fields required when an account is created. |
| `model.py` | The 26 entities with their attributes and the relationships between them. |
| `keys.py` | The DynamoDB key patterns and the five indexes. |
| `lifecycle.py` | The appointment, session and queue ticket state machines, as transitions. |

Everything that runs on AWS is Python and imports these modules directly, so
there is no second copy to keep in step:

```python
from atria_spec import lifecycle, roles

if not lifecycle.can("appointment", current, requested):
    raise Conflict("that move is not in the lifecycle")
```

The browser and the mobile client cannot import Python, so they get generated
copies:

```bash
python spec/generate.py            # write web/src/generated/*.ts
python spec/generate.py --check    # fail if a generated file is stale (used in CI)
```

The Software Requirements Specification, the Technical Document and the
diagrams are built from these same modules. If a permission, entity, key or
transition is not here, it does not exist: add it here first, then to the code
and the documents that read it.
