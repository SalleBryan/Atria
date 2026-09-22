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
    python infra/build.py --force    build unconditionally
"""

from __future__ import annotations

import hashlib
import pathlib
import shutil
import subprocess
import sys

INFRA = pathlib.Path(__file__).resolve().parent
ROOT = INFRA.parent
BUILD = INFRA / "build"
LAYER = BUILD / "layer"
APP = BUILD / "app"
STAMP = BUILD / "stamp.txt"

REQUIREMENTS = INFRA / "requirements-lambda.txt"
SOURCES = [
    ROOT / "backend" / "src" / "atria",
    ROOT / "spec" / "atria_spec",
]

# Must match the runtime and architecture in atria_infra/stacks/api.py.
LAMBDA_PYTHON = "3.13"
LAMBDA_PLATFORM = "manylinux2014_x86_64"


def fingerprint() -> str:
    """Hash of every input, so a rebuild happens exactly when something changed."""
    digest = hashlib.sha256()
    digest.update(f"{LAMBDA_PYTHON} {LAMBDA_PLATFORM}".encode())
    digest.update(REQUIREMENTS.read_bytes())
    for source in SOURCES:
        for path in sorted(source.rglob("*.py")):
            digest.update(str(path.relative_to(ROOT)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


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
    """Build the assets if needed and return the build folder."""
    current = fingerprint()
    if not force and STAMP.exists() and STAMP.read_text(encoding="utf-8").strip() == current:
        return BUILD

    if BUILD.exists():
        shutil.rmtree(BUILD)
    (LAYER / "python").mkdir(parents=True)
    APP.mkdir(parents=True)

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

    for source in SOURCES:
        shutil.copytree(
            source,
            APP / source.name,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )

    STAMP.write_text(current + "\n", encoding="utf-8")
    return BUILD


if __name__ == "__main__":
    folder = build(force="--force" in sys.argv[1:])
    print(f"built {folder.relative_to(ROOT)}")
