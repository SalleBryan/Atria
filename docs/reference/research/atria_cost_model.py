"""Atria monthly running cost for one district hospital, from the services in the CDK stacks.

Every input is an explicit assumption unless marked VERIFIED (read from the vendor page today).
Run: python atria_cost_model.py   (prints the tables and writes cost_model.json beside it)
"""

import json

USD_XAF = 600  # ASSUMPTION: the EUR peg is 655.957 XAF; USD floats, 600 is round and mid-range
EUR_XAF = 655.957  # fixed peg

# ---------------------------------------------------------------- workload (ASSUMPTIONS, one hospital)
VISITS_PER_DAY = 200
DAYS = 26
VISITS = VISITS_PER_DAY * DAYS  # 5,200 a month
PATIENT_MAU = 3500
STAFF = 60
STAFF_ACTIVE_AT_DESK = 12
QUEUE_SHARE = 0.6  # share of visits that are general queue places
LIVE_TICKET_WEB_SHARE = 0.45  # queue patients who watch the ticket on the web
LIVE_TICKET_POLLS = 90  # 30 second poll over a 45 minute wait
PATIENT_REQUESTS_PER_VISIT = 25
STAFF_REQ_PER_MIN = 3
STAFF_MINUTES = 480
EMAIL_SHARE = 0.35
EMAILS_PER_VISIT = 2

api_requests = (
    VISITS * PATIENT_REQUESTS_PER_VISIT
    + VISITS * QUEUE_SHARE * LIVE_TICKET_WEB_SHARE * LIVE_TICKET_POLLS
    + STAFF_ACTIVE_AT_DESK * STAFF_MINUTES * DAYS * STAFF_REQ_PER_MIN
)
background_invocations = VISITS * 4  # schedule, reminder, sender, queue moves
lambda_invocations = api_requests + background_invocations
LAMBDA_SECONDS = 0.25
LAMBDA_GB = 1.0  # service_function default is 1024 MB
gb_seconds = lambda_invocations * LAMBDA_SECONDS * LAMBDA_GB

WRU_PER_VISIT = 15
write_units = VISITS * WRU_PER_VISIT
read_units = api_requests * 1.0
storage_gb = 2.0  # a year of one hospital, incl. message log; two tables with point in time recovery

# ---------------------------------------------------------------- list prices, US East (N. Virginia)
P = {
    "apigw_per_million": 3.50,  # VERIFIED
    "lambda_per_million": 0.20,  # VERIFIED
    "lambda_per_gbs": 0.0000166667,  # VERIFIED
    "ddb_per_million_wru": 0.625,  # VERIFIED (worked example, on-demand)
    "ddb_per_million_rru": 0.125,  # VERIFIED (worked example, on-demand)
    "ddb_storage_gb": 0.25,  # VERIFIED
    "ddb_pitr_gb": 0.20,  # VERIFIED
    "cognito_essentials_mau": 0.015,  # VERIFIED, first 10,000 MAU free per account
    "cognito_lite_mau": 0.0055,  # VERIFIED, first 10,000 MAU free per account
    "cognito_free_mau": 10_000,
    "cw_logs_ingest_gb": 0.50,  # VERIFIED
    "cw_alarm": 0.10,  # VERIFIED
    "cw_dashboard": 3.00,  # NOT re-verified today (list price from memory)
    "amplify_gb_served": 0.15,  # VERIFIED
    "amplify_build_min": 0.01,  # VERIFIED
    "sqs_per_million": 0.40,  # NOT re-verified today
    "ses_per_thousand": 0.10,  # NOT re-verified today
    "scheduler_per_million": 1.00,  # NOT re-verified today
    "kms_key": 1.00,  # NOT re-verified today
    "secret": 0.40,  # NOT re-verified today
}

LOG_GB = 8.0
ALARMS = 40
DASHBOARDS = 1
KMS_KEYS = 2
SECRETS = 1
AMPLIFY_GB = PATIENT_MAU * 8 * 2 / 1024  # 8 visits a month x 2 MB
DEPLOYS = 20
BUILD_MIN = 6
SQS_REQUESTS = VISITS * 6
SCHEDULER_CALLS = VISITS * 2
EMAILS = VISITS * EMAIL_SHARE * EMAILS_PER_VISIT


def aws(hospitals=1, region_uplift=1.0, cognito="essentials"):
    """Monthly AWS cost: per hospital variable parts scale, platform parts are paid once."""
    n = hospitals
    variable = {
        "API Gateway": n * api_requests / 1e6 * P["apigw_per_million"],
        "Lambda": n * (lambda_invocations / 1e6 * P["lambda_per_million"] + gb_seconds * P["lambda_per_gbs"]),
        "DynamoDB": n
        * (
            write_units / 1e6 * P["ddb_per_million_wru"]
            + read_units / 1e6 * P["ddb_per_million_rru"]
            + storage_gb * (P["ddb_storage_gb"] + P["ddb_pitr_gb"])
        ),
        "SQS and Scheduler": n * (SQS_REQUESTS / 1e6 * P["sqs_per_million"] + SCHEDULER_CALLS / 1e6 * P["scheduler_per_million"]),
        "SES email": n * EMAILS / 1000 * P["ses_per_thousand"],
        "CloudWatch logs": n * LOG_GB * P["cw_logs_ingest_gb"],
        "Amplify transfer": n * AMPLIFY_GB * P["amplify_gb_served"],
    }
    mau = n * (PATIENT_MAU + STAFF)
    rate = P["cognito_essentials_mau"] if cognito == "essentials" else P["cognito_lite_mau"]
    variable["Cognito"] = max(0, mau - P["cognito_free_mau"]) * rate
    fixed = {
        "KMS keys": KMS_KEYS * P["kms_key"],
        "Secrets Manager": SECRETS * P["secret"],
        "CloudWatch alarms and dashboard": ALARMS * P["cw_alarm"] + DASHBOARDS * P["cw_dashboard"],
        "Amplify builds": DEPLOYS * BUILD_MIN * P["amplify_build_min"],
    }
    parts = {**variable, **fixed}
    parts = {k: v * region_uplift for k, v in parts.items()}
    return parts, sum(parts.values())


# ---------------------------------------------------------------- SMS (the unknown that matters)
SMS_PER_VISIT = {"reminder only": 1.0, "confirmation and reminder": 2.0, "plus queue moves and invitations": 2.7}
SMS_RATES_XAF = {
    "A: carrier contract hope, 25 XAF (retail off-net tariff, ART 2023, a proxy not a quote)": 25,
    "B: lowest aggregator list, 0.142 EUR (BudgetSMS, MTN)": round(0.142 * EUR_XAF),
    "C: highest aggregator list, 0.317 USD (Twilio)": round(0.317 * USD_XAF),
}


def xaf(usd):
    return round(usd * USD_XAF)


out = {"assumptions": {}, "aws": {}, "sms": {}, "scale": {}, "payments": {}, "maintenance": {}}
out["assumptions"] = {
    "visits_per_month": VISITS,
    "patient_mau": PATIENT_MAU,
    "api_requests": round(api_requests),
    "lambda_invocations": round(lambda_invocations),
    "gb_seconds": round(gb_seconds),
    "usd_xaf": USD_XAF,
}

parts, total = aws()
out["aws"]["one_hospital_usd"] = {k: round(v, 2) for k, v in parts.items()}
out["aws"]["one_hospital_total_usd"] = round(total, 2)
out["aws"]["one_hospital_total_xaf"] = xaf(total)
_, uplift = aws(region_uplift=1.25)
out["aws"]["one_hospital_with_25pct_region_uplift_usd"] = round(uplift, 2)

for hospitals in (1, 5, 20, 100):
    _, t = aws(hospitals)
    _, t_lite = aws(hospitals, cognito="lite")
    out["scale"][str(hospitals)] = {
        "aws_usd": round(t, 2),
        "aws_usd_per_hospital": round(t / hospitals, 2),
        "aws_usd_lite_cognito": round(t_lite, 2),
        "mau": hospitals * (PATIENT_MAU + STAFF),
    }

for label, per_visit in SMS_PER_VISIT.items():
    msgs = VISITS * per_visit
    out["sms"][label] = {"messages": round(msgs), "xaf": {rate_label: round(msgs * rate) for rate_label, rate in SMS_RATES_XAF.items()}}

# payments: a facility subscription paid by mobile money through an aggregator (Fapshi), fee range unverified
out["payments"] = {
    "fapshi_sandbox_numbers": {"success": "670000000", "failure": "670000001"},
    "fee_range_percent_unverified": [0.5, 3.5],
    "per_100000_xaf_subscription_xaf": {"0.5%": 500, "1.5%": 1500, "3.5%": 3500},
}

# maintenance: AWS plus pass-through SMS plus support time (labelled assumption)
SUPPORT_HOURS = 20
SUPPORT_XAF_PER_HOUR = 5000
support = SUPPORT_HOURS * SUPPORT_XAF_PER_HOUR
out["maintenance"] = {
    "support_hours_per_month": SUPPORT_HOURS,
    "support_xaf_per_hour_assumed": SUPPORT_XAF_PER_HOUR,
    "support_xaf": support,
    "one_hospital_excl_sms_xaf": xaf(total) + support,
    "one_hospital_excl_sms_per_year_xaf": 12 * (xaf(total) + support),
}

json.dump(out, open("cost_model.json", "w"), indent=2)
print(json.dumps(out, indent=2))
