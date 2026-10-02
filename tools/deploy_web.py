"""Build the web client and publish it to Amplify Hosting.

    python tools/deploy_web.py            build web/dist and deploy it
    python tools/deploy_web.py --no-build deploy the web/dist already built

The Amplify app is the atria-<env>-web stack's (infra/atria_infra/stacks/
hosting.py). It is not connected to the repository, so each deployment is a
zip of web/dist uploaded here: what goes live is exactly what was built and
tested. The build reads web/.env.local for the Cognito settings, as the
development server does. The Deploy workflow runs this after every successful
deployment of main (tools/web_env.py first, to write web/.env.local).
"""

from __future__ import annotations

import io
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DIST = WEB / "dist"
STACK = "atria-dev-web"
BRANCH = "main"
REGION = "us-east-1"


def outputs() -> dict[str, str]:
    cf = boto3.client("cloudformation", region_name=REGION)
    stack = cf.describe_stacks(StackName=STACK)["Stacks"][0]
    return {o["OutputKey"]: o["OutputValue"] for o in stack.get("Outputs", [])}


def zipped() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(DIST.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(DIST).as_posix())
    return buffer.getvalue()


def upload(url: str, body: bytes, attempts: int = 3) -> None:
    """PUT the zip to the URL Amplify issued, trying again if the link drops."""
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(  # noqa: S310  the URL Amplify just issued
            url, data=body, method="PUT", headers={"Content-Type": "application/zip"}
        )
        try:
            with urllib.request.urlopen(request) as response:  # noqa: S310
                response.read()
            return
        except OSError:
            if attempt == attempts:
                raise
            print(f"upload dropped, trying again ({attempt}/{attempts})")
            time.sleep(5 * attempt)


def main() -> int:
    if "--no-build" not in sys.argv:
        subprocess.run("npm run build", cwd=WEB, shell=True, check=True)  # noqa: S602, S607  a fixed command
    if not (DIST / "index.html").exists():
        print("web/dist has no index.html; build first")
        return 1

    found = outputs()
    app_id = found["AppId"]
    amplify = boto3.client("amplify", region_name=REGION)
    # An upload that dropped leaves its job pending, and Amplify then refuses
    # every new deployment until it is stopped (seen 2026-09-30).
    for stale in amplify.list_jobs(appId=app_id, branchName=BRANCH, maxResults=10)["jobSummaries"]:
        if stale["status"] == "PENDING":
            amplify.stop_job(appId=app_id, branchName=BRANCH, jobId=stale["jobId"])
            print(f"stopped job {stale['jobId']}, left pending by an earlier upload")
    job = amplify.create_deployment(appId=app_id, branchName=BRANCH)
    body = zipped()
    upload(job["zipUploadUrl"], body)
    amplify.start_deployment(appId=app_id, branchName=BRANCH, jobId=job["jobId"])
    print(f"deploying job {job['jobId']} ({len(body) // 1024} KB)")

    while True:
        job_info = amplify.get_job(appId=app_id, branchName=BRANCH, jobId=job["jobId"])
        status = job_info["job"]["summary"]["status"]
        if status in ("SUCCEED", "FAILED", "CANCELLED"):
            break
        time.sleep(5)
    print(f"{status}: {found['Url']}")
    return 0 if status == "SUCCEED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
