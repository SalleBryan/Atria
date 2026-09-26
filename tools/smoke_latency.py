"""How fast the development API answers the reads the web app makes (NFR-PERF-01).

    python tools/smoke_latency.py            every read, 15 times each
    python tools/smoke_latency.py 40         40 times each

NFR-PERF-01 asks that 95 per cent of reads complete in under 800 ms, measured
at the API. This measures from here, so it includes the round trip to
us-east-1 and is the stricter of the two. Reads go over one kept-open
connection, as a browser sends them, so a new TLS handshake is not counted
against every call. For each read it reports the first call on its own, since
it may meet a cold function, then the median and the 95th percentile of the
rest. Last, it sends seven day reads at once, as the week view used to,
because a burst wakes several cold functions together, then the same week in
the one call the view makes now.

Reads only, as the development administrator. Nothing is written.
"""

from __future__ import annotations

import http.client
import json
import statistics
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import devkit

BUDGET_MS = 800

_connection: http.client.HTTPSConnection | None = None


def timed(url: str, token: str) -> tuple[int, float]:
    """One read over the kept-open connection, opened again if the API closed it."""
    global _connection
    parts = urllib.parse.urlsplit(url)
    headers = {"Authorization": f"Bearer {token}"}
    for attempt in (1, 2):
        if _connection is None:
            _connection = http.client.HTTPSConnection(parts.netloc, timeout=20)
        start = time.perf_counter()
        try:
            _connection.request("GET", f"{parts.path}?{parts.query}", headers=headers)
            response = _connection.getresponse()
            response.read()
        except (ConnectionError, http.client.HTTPException):
            # API Gateway closes an idle connection; the retry pays for a new one.
            _connection.close()
            _connection = None
            if attempt == 2:
                raise
            continue
        return response.status, (time.perf_counter() - start) * 1000
    raise AssertionError("unreachable")


def fresh(url: str, token: str) -> float:
    """One read on a new connection, as each of a burst of parallel requests is."""
    start = time.perf_counter()
    devkit.call(url, token)
    return (time.perf_counter() - start) * 1000


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(share * (len(ordered) - 1)))]


def main(argv: list[str]) -> int:
    rounds = int(argv[0]) if argv else 15
    idp = devkit.cognito()
    pool = devkit.user_pool(idp)
    base = devkit.api_base()
    token = devkit.admin_token(idp, pool, devkit.app_client(idp, pool, "staff"))

    _s, raw, _h = devkit.call(f"{base}/clinicians", token)
    clinician = json.loads(raw)["clinicians"][0]
    _s, raw, _h = devkit.call(f"{base}/appointment-types", token)
    types = json.loads(raw)["appointmentTypes"]
    spec = next(t for t in types if t.get("serviceLine") == "SPECIALIST")
    today = time.strftime("%Y-%m-%d", time.gmtime())
    week_end = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 6 * 86400))
    clinic = clinician["clinicId"]
    who = clinician["clinicianProfileId"]
    kind = spec["appointmentTypeId"]
    reads = {
        "GET /me": "/me",
        "GET /clinicians": "/clinicians",
        "GET /clinics": "/clinics",
        "GET /appointment-types": "/appointment-types",
        "GET /clinicians/{id}/slots": f"/clinicians/{who}/slots?date={today}&typeId={kind}",
        "  a week of slots": f"/clinicians/{who}/slots?from={today}&to={week_end}&typeId={kind}",
        "GET /clinics/{id}/day": f"/clinics/{clinic}/day?date={today}",
        "  a week of days": f"/clinics/{clinic}/day?from={today}&to={week_end}",
        "GET /admin/staff": "/admin/staff?limit=10",
    }

    print(f"api {base}, {rounds} calls a read, budget {BUDGET_MS} ms at p95\n")
    print(f"{'read':30} {'first':>8} {'p50':>8} {'p95':>8}  result")
    failed = False
    for name, path in reads.items():
        status, first = timed(base + path, token)
        rest = [timed(base + path, token)[1] for _ in range(rounds)]
        p50, p95 = statistics.median(rest), percentile(rest, 0.95)
        verdict = "ok" if status == 200 and p95 < BUDGET_MS else f"OVER ({status})"
        failed |= verdict != "ok"
        print(f"{name:30} {first:8.0f} {p50:8.0f} {p95:8.0f}  {verdict}")

    day = f"{base}/clinics/{clinic}/day?date={today}"
    with ThreadPoolExecutor(max_workers=7) as workers:
        burst = list(workers.map(lambda _i: fresh(day, token), range(7)))
    week = fresh(f"{base}/clinics/{clinic}/day?from={today}&to={week_end}", token)
    print(f"\nseven day reads at once, as the week view used to: slowest {max(burst):.0f} ms")
    print(f"the same week in one call, as it asks now:          {week:.0f} ms")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
