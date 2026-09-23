"""Acceptance test BR-08: the reminder fires ahead of the appointment.

    python tools/smoke_reminder.py

GIVEN an appointment booked just over a day ahead with a 24 hour lead time,
WHEN the schedule fires,
THEN an SMS is published to the current number within 2 minutes of the
scheduled time and before the appointment,
AND for an appointment cancelled before that time, nothing is published and
the skip is logged.

The acceptance test books 26 hours ahead and waits two hours. This books 24
hours and about five minutes ahead instead, so the reminder is due in about
five minutes and the run takes a quarter of an hour. Nothing else differs.

What "published" means here, measured rather than assumed. SNS accepts the
publish call and returns a message id even in the SMS sandbox; delivery is
attempted afterwards and, to an unverified number in the sandbox, fails. The
message log records SENT on acceptance, the same as for email, so it cannot yet
tell an accepted SMS from a delivered one. DELIVERED arrives with provider
delivery status, which FR-MSG-03 places in Phase 2. SNS's own metrics
(NumberOfNotificationsFailed, SMSSuccessRate) are where a failed delivery shows
until then.

The patient's number is +1 202 555 0142, from the 555-01xx range reserved for
fiction, so this script cannot text a real person, in the sandbox or out of it.

Development only, same reasoning as tools/smoke_me.py.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
import secrets
import sys
import time
import urllib.error
import urllib.request

import boto3
import devkit

REGION = "us-east-1"
PREFIX = "atria-dev"
TENANT_ID = "t-cm-001"
CLINIC_ID = "c-douala-01"
ADMIN_USERNAME = "smoke.admin.t1@atria.invalid"
SCHEDULE_GROUP = f"{PREFIX}-reminders"

FICTIONAL_NUMBER = "+12025550142"

RUN = secrets.token_hex(4)
APPOINTMENT_TYPE_ID = f"at-reminder-{RUN}"
PERSON_ID = f"p-reminder-{RUN}"
PATIENT_PROFILE_ID = f"pp-reminder-{RUN}"

LEAD = dt.timedelta(hours=24)
# How far past the lead the first appointment starts, so its reminder is due
# this long from now, give or take the grid.
AHEAD = dt.timedelta(minutes=5)
GRID = 10

# BR-08: within two minutes of the scheduled time.
WITHIN = dt.timedelta(minutes=2)


def utc_now() -> dt.datetime:
    return dt.datetime.now(tz=dt.UTC)


def stamp(value: dt.datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(value: object) -> dt.datetime:
    return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def on_grid_after(moment: dt.datetime) -> dt.datetime:
    """The first grid unit boundary at or after a moment."""
    base = moment.replace(second=0, microsecond=0)
    extra = (-base.minute) % GRID
    if extra == 0 and moment > base:
        extra = GRID
    return base + dt.timedelta(minutes=extra)


def phone() -> str:
    """Reserved for fiction, so no run can text a real person (see tools/devkit.py)."""
    return devkit.fictional_phone()


def find(idp) -> tuple[str, str]:  # noqa: ANN001  boto3 client
    pool = next(
        p["Id"]
        for page in idp.get_paginator("list_user_pools").paginate(MaxResults=60)
        for p in page["UserPools"]
        if p["Name"] == f"{PREFIX}-users"
    )
    client = next(
        c["ClientId"]
        for page in idp.get_paginator("list_user_pool_clients").paginate(
            UserPoolId=pool, MaxResults=60
        )
        for c in page["UserPoolClients"]
        if c["ClientName"] == f"{PREFIX}-staff"
    )
    return str(pool), str(client)


def api_base() -> str:
    for item in boto3.client("apigateway", region_name=REGION).get_rest_apis(limit=500)["items"]:
        if item["name"] == f"{PREFIX}-api":
            return f"https://{item['id']}.execute-api.{REGION}.amazonaws.com/dev"
    raise SystemExit(f"no REST API named {PREFIX}-api")


def call(url: str, token: str, *, method: str = "GET", body: object = None) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, method=method, data=data)  # noqa: S310  https only
    if data is not None:
        request.add_header("Content-Type", "application/json")
    request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
            return response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def sign_in(idp, pool: str, client: str, username: str, password: str) -> str:  # noqa: ANN001
    result = idp.admin_initiate_auth(
        UserPoolId=pool,
        ClientId=client,
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )
    return str(result["AuthenticationResult"]["AccessToken"])


def ensure_admin(idp, pool: str) -> str:  # noqa: ANN001  boto3 client
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    with contextlib.suppress(idp.exceptions.UsernameExistsException):
        idp.admin_create_user(
            UserPoolId=pool,
            Username=ADMIN_USERNAME,
            UserAttributes=[
                {"Name": "email", "Value": ADMIN_USERNAME},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:tenantId", "Value": TENANT_ID},
                {"Name": "custom:personId", "Value": "p-smoke-admin-t1"},
                {"Name": "custom:roles", "Value": "TENANT_ADMIN"},
            ],
            MessageAction="SUPPRESS",
        )
    idp.admin_set_user_password(
        UserPoolId=pool, Username=ADMIN_USERNAME, Password=password, Permanent=True
    )
    return password


def seed(table) -> None:  # noqa: ANN001  boto3 table
    devkit.put_tenant(table, TENANT_ID)
    # The whole pack from the specification (FR-TEN-08), never a partial copy.
    devkit.put_region_pack(table)
    items = [
        {
            "pk": f"TENANT#{TENANT_ID}#CLINIC#{CLINIC_ID}",
            "sk": "PROFILE",
            "type": "CLINIC",
            "clinicId": CLINIC_ID,
            "tenantId": TENANT_ID,
            "name": "Clinique de Douala",
            "openingHours": {str(d): {"start": "00:00", "end": "23:50"} for d in range(7)},
        },
        {
            "pk": f"TENANT#{TENANT_ID}#TYPE#{APPOINTMENT_TYPE_ID}",
            "sk": "TYPE",
            "type": "APPOINTMENT_TYPE",
            "appointmentTypeId": APPOINTMENT_TYPE_ID,
            "tenantId": TENANT_ID,
            "serviceLine": "SPECIALIST",
            "durationUnits": 3,
            "bufferUnits": 1,
            "bookableBy": "BOTH",
            "minNoticeMinutes": 30,
            "maxAdvanceDays": 60,
            "cancellationWindowMinutes": 1440,
            "active": True,
        },
        # No email, so the confirmation email records "no address" and stops,
        # and the only message this run can produce for the patient is the SMS.
        {
            "pk": f"PERSON#{PERSON_ID}",
            "sk": "PERSON",
            "type": "PERSON",
            "personId": PERSON_ID,
            "givenName": "Amina",
            "familyName": "Ngo",
            "phoneE164": FICTIONAL_NUMBER,
            "preferredLanguage": "fr",
        },
        {
            "pk": f"TENANT#{TENANT_ID}#PAT#{PATIENT_PROFILE_ID}",
            "sk": "PROFILE",
            "type": "PATIENT_PROFILE",
            "patientProfileId": PATIENT_PROFILE_ID,
            "personId": PERSON_ID,
            "tenantId": TENANT_ID,
        },
    ]
    for item in items:
        table.put_item(Item=item)


def create_staff(base: str, token: str, body: dict[str, object]) -> dict[str, object]:
    status, raw = call(f"{base}/admin/staff", token, method="POST", body=body)
    if status != 201:
        raise SystemExit(f"could not create staff account: {status} {raw}")
    return dict(json.loads(raw))


def reminder_row(table, appointment: dict[str, object]) -> dict[str, object] | None:  # noqa: ANN001
    """The reminder's message log row, found through the reference on the appointment."""
    logged_at = appointment.get("reminderLoggedAt")
    log_id = appointment.get("reminderLogId")
    if not logged_at or not log_id:
        return None
    day = str(logged_at)[:10]
    item = table.get_item(
        Key={"pk": f"TENANT#{TENANT_ID}#MSG#{day}", "sk": f"{logged_at}#{log_id}"}
    ).get("Item")
    return dict(item) if item else None


def appointment_record(table, appointment_id: str) -> dict[str, object]:  # noqa: ANN001
    item = table.get_item(
        Key={"pk": f"TENANT#{TENANT_ID}#APPT#{appointment_id}", "sk": "APPT"}
    ).get("Item")
    return dict(item or {})


def schedule_exists(scheduler, name: str) -> dict[str, object] | None:  # noqa: ANN001
    try:
        return dict(scheduler.get_schedule(Name=name, GroupName=SCHEDULE_GROUP))
    except scheduler.exceptions.ResourceNotFoundException:
        return None


def wait_until(predicate, *, timeout: float, every: float = 10.0) -> bool:  # noqa: ANN001
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(every)
    return bool(predicate())


def main() -> int:
    idp = boto3.client("cognito-idp", region_name=REGION)
    scheduler = boto3.client("scheduler", region_name=REGION)
    table = boto3.resource("dynamodb", region_name=REGION).Table(f"{PREFIX}-main")
    pool, client = find(idp)
    base = api_base()
    print(f"api  {base}\nrun  {RUN}")

    seed(table)
    admin = sign_in(idp, pool, client, ADMIN_USERNAME, ensure_admin(idp, pool))
    clinician = create_staff(
        base,
        admin,
        {
            "givenName": "Paul",
            "familyName": "Etoa",
            "phoneE164": phone(),
            "clinicId": CLINIC_ID,
            "roles": ["CLINICIAN"],
            "specialty": "Paediatrics",
            "registrationYear": 2012,
            "ordreNumber": f"CM-ONMC-{RUN}",
            "languages": ["fr"],
        },
    )
    receptionist = create_staff(
        base,
        admin,
        {
            "givenName": "Ruth",
            "familyName": "Mba",
            "phoneE164": phone(),
            "clinicId": CLINIC_ID,
            "roles": ["RECEPTIONIST"],
        },
    )
    password = f"Smoke-{secrets.token_urlsafe(12)}!1"
    idp.admin_set_user_password(
        UserPoolId=pool, Username=str(receptionist["signInName"]), Password=password, Permanent=True
    )
    time.sleep(2)
    token = sign_in(idp, pool, client, str(receptionist["signInName"]), password)

    kept_start = on_grid_after(utc_now() + LEAD + AHEAD)
    cancelled_start = kept_start + dt.timedelta(hours=1)
    booked: dict[str, str] = {}
    for label, start in (("kept", kept_start), ("cancelled", cancelled_start)):
        status, raw = call(
            f"{base}/appointments",
            token,
            method="POST",
            body={
                "patientProfileId": PATIENT_PROFILE_ID,
                "appointmentTypeId": APPOINTMENT_TYPE_ID,
                "clinicianProfileId": clinician["staffId"],
                "startAt": stamp(start),
                "channel": "PHONE",
            },
        )
        if status != 201:
            raise SystemExit(f"booking the {label} appointment failed: {status} {raw}")
        booked[label] = str(json.loads(raw)["appointmentId"])
    fire_at = kept_start - LEAD
    print(f"\nbooked; the kept appointment starts {stamp(kept_start)}")
    minutes = int((fire_at - utc_now()).total_seconds() // 60)
    print(f"its reminder is due {stamp(fire_at)}, in about {minutes} min")

    kept_name = f"reminder-{booked['kept']}"
    cancelled_name = f"reminder-{booked['cancelled']}"
    scheduled = wait_until(
        lambda: (
            bool(appointment_record(table, booked["kept"]).get("reminderSchedule"))
            and bool(appointment_record(table, booked["cancelled"]).get("reminderSchedule"))
        ),
        timeout=120,
    )
    kept_schedule = schedule_exists(scheduler, kept_name)
    print(f"\nboth schedules created: {scheduled}")
    print(f"  {kept_name}: {kept_schedule and kept_schedule.get('ScheduleExpression')}")

    status, raw = call(
        f"{base}/appointments/{booked['cancelled']}",
        token,
        method="DELETE",
        body={"cancelledBy": "PATIENT"},
    )
    if status != 200:
        raise SystemExit(f"cancelling failed: {status} {raw}")
    removed = wait_until(lambda: schedule_exists(scheduler, cancelled_name) is None, timeout=120)
    cancelled_row = reminder_row(table, appointment_record(table, booked["cancelled"]))
    print(f"\ncancelled; its schedule removed: {removed}")
    print(f"  its reminder row: {cancelled_row and cancelled_row.get('deliveryState')}")

    wait = max(0.0, (fire_at + WITHIN + dt.timedelta(seconds=30) - utc_now()).total_seconds())
    print(f"\nwaiting {int(wait)}s for the kept reminder to fire")
    settled = wait_until(
        lambda: (
            (reminder_row(table, appointment_record(table, booked["kept"])) or {}).get(
                "deliveryState"
            )
            not in (None, "SCHEDULED")
        ),
        timeout=wait + 180,
        every=15,
    )
    kept_row = reminder_row(table, appointment_record(table, booked["kept"])) or {}
    state = str(kept_row.get("deliveryState"))
    settled_at = parse(kept_row["settledAt"]) if kept_row.get("settledAt") else None
    lag = (settled_at - fire_at) if settled_at else None
    reason = str(kept_row.get("failureReason") or "")
    print(f"  settled: {settled}  state: {state}  lag: {lag}")
    if reason:
        print(f"  provider said: {reason}")

    results: dict[str, str] = {
        "the booking created a one-time schedule": "ok" if kept_schedule else "FAIL",
        "the schedule is due a lead time before the start": "ok"
        if kept_schedule
        and str(kept_schedule.get("ScheduleExpression"))
        == f"at({fire_at.strftime('%Y-%m-%dT%H:%M:%S')})"
        else "FAIL",
        "the reference is stored on the appointment": "ok"
        if appointment_record(table, booked["kept"]).get("reminderSchedule") == kept_name
        else "FAIL",
        "cancelling removed the other schedule": "ok" if removed else "FAIL",
        "the cancelled reminder is logged as CANCELLED": "ok"
        if cancelled_row and cancelled_row.get("deliveryState") == "CANCELLED"
        else "FAIL",
        "the reminder fired within 2 minutes of its time": "ok"
        if lag is not None and dt.timedelta(0) <= lag <= WITHIN
        else "FAIL",
        "it fired before the appointment": "ok"
        if settled_at and settled_at < kept_start
        else "FAIL",
        "it went to the patient's current number": "ok"
        if kept_row.get("recipient") == FICTIONAL_NUMBER
        else "FAIL",
        "SNS accepted the SMS for publishing": "ok" if state == "SENT" else "FAIL",
    }

    print()
    for name, outcome in results.items():
        print(f"  {outcome:<7} {name}")
    print()
    if set(results.values()) == {"ok"}:
        print(
            "BR-08 holds: the reminder was published on time and the cancelled one was not. "
            "Published means accepted by SNS; delivery is not reported until Phase 2."
        )
        return 0
    print("BR-08 does not hold: see the failed checks above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
