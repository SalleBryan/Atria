"""Prepare the Lambda assets before synthesis.

Two assets:

    build/layer/python   third party dependencies, published as a Lambda layer
    build/app            the atria and atria_spec packages, the function code

Both are built with plain `pip install --target` and file copies, so no Docker
is needed to synthesise or deploy. The install is pinned to the Lambda platform
and Python version rather than the machine running the build, so a compiled
wheel such as pydantic-core arrives as the Linux build the runtime needs and
not the developer's Windows or macOS one.

    python infra/build.py            build when stale
    python infra/build.py --force    build both unconditionally (a new layer
                                     version: see layer_fingerprint)
"""

from __future__ import annotations

import hashlib
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import time

INFRA = pathlib.Path(__file__).resolve().parent
ROOT = INFRA.parent
BUILD = INFRA / "build"
LAYER = BUILD / "layer"
APP = BUILD / "app"

REQUIREMENTS = INFRA / "requirements-lambda.txt"
SOURCES = [
    ROOT / "backend" / "src" / "atria",
    ROOT / "spec" / "atria_spec",
]

# Must match the runtime and architecture in atria_infra/stacks/api.py.
LAMBDA_PYTHON = "3.13"
LAMBDA_PLATFORM = "manylinux2014_x86_64"


def _digest(*parts: bytes) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part)
    return digest.hexdigest()


def layer_fingerprint() -> str:
    """The layer's inputs: the platform and the pinned requirements, nothing else.

    Kept apart from the code's, so a code change never reinstalls the layer.
    A reinstall can resolve a transitive dependency differently, and a new
    layer version cannot replace the one other stacks import (a CloudFormation
    export in use), so the layer is rebuilt only when its requirements change.
    """
    return _digest(f"{LAMBDA_PYTHON} {LAMBDA_PLATFORM}".encode(), REQUIREMENTS.read_bytes())


def app_fingerprint() -> str:
    parts = []
    for source in SOURCES:
        for path in sorted(source.rglob("*.py")):
            parts += [str(path.relative_to(ROOT)).encode(), path.read_bytes()]
    return _digest(*parts)


def _remove(path: pathlib.Path) -> None:
    """Delete a folder, retrying while a sync client or indexer holds a file open.

    On Windows a folder under OneDrive is briefly locked after it is written,
    and a single rmtree then fails with access denied.
    """

    def writable(function, target, _info):  # noqa: ANN001, ANN202
        os.chmod(target, stat.S_IWRITE)
        function(target)

    for attempt in range(8):
        if not path.exists():
            return
        try:
            shutil.rmtree(path, onexc=writable)
            return
        except PermissionError:
            time.sleep(0.5 * (attempt + 1))
    shutil.rmtree(path, onexc=writable)


# Provided by the Lambda runtime, so shipping them only slows cold starts.
PROVIDED = ("boto3", "botocore", "s3transfer")


def _prune(target: pathlib.Path) -> None:
    """Drop what the runtime already has, plus build residue."""
    for name in PROVIDED:
        for path in target.glob(f"{name}*"):
            shutil.rmtree(path, ignore_errors=True) if path.is_dir() else path.unlink()
    for pattern in ("**/__pycache__", "*.dist-info", "bin"):
        for path in target.glob(pattern):
            shutil.rmtree(path, ignore_errors=True)


def build(force: bool = False) -> pathlib.Path:
    """Build whichever asset is stale and return the build folder."""
    layer_stamp = BUILD / "layer.stamp"
    app_stamp = BUILD / "app.stamp"
    BUILD.mkdir(exist_ok=True)

    wanted = layer_fingerprint()
    stale = not layer_stamp.exists() or layer_stamp.read_text(encoding="utf-8").strip() != wanted
    if force or not (LAYER / "python").exists() or stale:
        _remove(LAYER)
        (LAYER / "python").mkdir(parents=True)
        subprocess.run(  # noqa: S603  trusted arguments, no shell
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--quiet",
                "--requirement",
                str(REQUIREMENTS),
                "--target",
                str(LAYER / "python"),
                # Resolve for the Lambda runtime, not for this machine.
                "--python-version",
                LAMBDA_PYTHON,
                "--platform",
                LAMBDA_PLATFORM,
                "--implementation",
                "cp",
                "--only-binary",
                ":all:",
            ],
            check=True,
        )
        _prune(LAYER / "python")
        layer_stamp.write_text(wanted + chr(10), encoding="utf-8")

    wanted = app_fingerprint()
    stale = not app_stamp.exists() or app_stamp.read_text(encoding="utf-8").strip() != wanted
    if force or not APP.exists() or stale:
        _remove(APP)
        APP.mkdir(parents=True)
        for source in SOURCES:
            shutil.copytree(
                source,
                APP / source.name,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        app_stamp.write_text(wanted + chr(10), encoding="utf-8")
    return BUILD


if __name__ == "__main__":
    folder = build(force="--force" in sys.argv[1:])
    print(f"built {folder.relative_to(ROOT)}")
