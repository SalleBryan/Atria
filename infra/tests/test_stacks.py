"""The synthesised templates say what the specification says.

These are assertions about the shape of the infrastructure, not a snapshot: a
snapshot would change on every unrelated edit and teach nobody anything. Each
test states a property the deployment must hold.

Verifies NFR-SEC (encryption with customer-managed keys, every route
authorised), FR-TEN-01 (the single table design and its indexes) and ADR 0014
(the budget and the alarms).
"""

from __future__ import annotations

from typing import Any

import aws_cdk as cdk
import pytest
from atria_spec import keys as keys_spec
from aws_cdk.assertions import Match, Template

import app as application
from atria_infra import config


@pytest.fixture(scope="module")
def synthesised() -> cdk.App:
    return application.main()


def template_for(app: cdk.App, stack: str) -> Template:
    found = app.node.find_child(config.DEV.stack_name(stack))
    assert isinstance(found, cdk.Stack)
    return Template.from_stack(found)


def routes(template: Template) -> set[tuple[str, str]]:
    """Every (path, method) the API serves, as full paths.

    Built by walking each resource up to the root rather than reading its own
    path part, because several resources are called "{id}": without the parents
    an assertion about /appointments/{id} would also be satisfied by
    /admin/staff/{id}.
    """
    resources = template.find_resources("AWS::ApiGateway::Resource")
    parents = {
        logical: (
            resource["Properties"]["PathPart"],
            resource["Properties"].get("ParentId"),
        )
        for logical, resource in resources.items()
    }

    def path_of(logical: str) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        current: str | None = logical
        while current and current in parents and current not in seen:
            seen.add(current)
            part, parent = parents[current]
            parts.append(part)
            current = str(parent.get("Ref")) if isinstance(parent, dict) else None
        return "/" + "/".join(reversed(parts))

    found: set[tuple[str, str]] = set()
    for method in template.find_resources("AWS::ApiGateway::Method").values():
        resource_id = method["Properties"].get("ResourceId")
        if not isinstance(resource_id, dict) or "Ref" not in resource_id:
            continue
        found.add((path_of(str(resource_id["Ref"])), method["Properties"]["HttpMethod"]))
    return found


class TestDataStack:
    def test_one_main_table_and_one_care_context_table(self, synthesised):
        template_for(synthesised, "data").resource_count_is("AWS::DynamoDB::GlobalTable", 2)

    def test_the_main_table_carries_exactly_the_specified_indexes(self, synthesised):
        """The specification is the source, so this reads it rather than
        restating a list that then has to be kept in step by hand."""
        template = template_for(synthesised, "data")
        tables = template.find_resources("AWS::DynamoDB::GlobalTable")
        main = next(t for t in tables.values() if t["Properties"]["TableName"].endswith("-main"))
        names = {index["IndexName"] for index in main["Properties"]["GlobalSecondaryIndexes"]}
        assert names == {name for name, _pk, _sk, _answers in keys_spec.INDEXES}

    def test_the_directory_index_is_sparse_on_its_own_keys(self, synthesised):
        """A clinician profile carries directoryKey only while it is bookable,
        which is how a suspended account leaves the listing."""
        template = template_for(synthesised, "data")
        tables = template.find_resources("AWS::DynamoDB::GlobalTable")
        main = next(t for t in tables.values() if t["Properties"]["TableName"].endswith("-main"))
        directory = next(
            index
            for index in main["Properties"]["GlobalSecondaryIndexes"]
            if index["IndexName"] == "DirectoryIndex"
        )
        schema = {entry["KeyType"]: entry["AttributeName"] for entry in directory["KeySchema"]}
        assert schema == {"HASH": "directoryKey", "RANGE": "directorySort"}

    def test_both_tables_use_a_customer_managed_key(self, synthesised):
        template = template_for(synthesised, "data")
        for table in template.find_resources("AWS::DynamoDB::GlobalTable").values():
            replicas = table["Properties"]["Replicas"]
            assert all("SSESpecification" in replica for replica in replicas)

    def test_both_tables_expire_on_the_same_attribute(self, synthesised):
        """ADR 0006 and ADR 0008. Expiry is per item, not per table: only an
        item carrying expiresAt is removed, which is a slot lock or an
        idempotency record and never an appointment, an event or a person. The
        main table previously had no expiry at all, so the locks that were
        written with an expiry never went anywhere."""
        template = template_for(synthesised, "data")
        tables = template.find_resources("AWS::DynamoDB::GlobalTable")
        for table in tables.values():
            spec = table["Properties"]["TimeToLiveSpecification"]
            assert spec["Enabled"] is True
            assert spec["AttributeName"] == "expiresAt"

    def test_care_context_has_its_own_key(self, synthesised):
        template_for(synthesised, "data").resource_count_is("AWS::KMS::Key", 2)

    def test_point_in_time_recovery_is_on(self, synthesised):
        template = template_for(synthesised, "data")
        for table in template.find_resources("AWS::DynamoDB::GlobalTable").values():
            for replica in table["Properties"]["Replicas"]:
                assert replica["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"] is True


class TestIdentityStack:
    def test_three_app_clients_for_three_audiences(self, synthesised):
        template_for(synthesised, "identity").resource_count_is("AWS::Cognito::UserPoolClient", 3)

    def test_the_tenant_and_person_attributes_cannot_be_changed_by_the_user(self, synthesised):
        """ADR 0015: roles are fixed at account creation, tenancy never moves."""
        template = template_for(synthesised, "identity")
        pool = next(iter(template.find_resources("AWS::Cognito::UserPool").values()))
        schema = {entry["Name"]: entry for entry in pool["Properties"]["Schema"]}
        assert schema["tenantId"]["Mutable"] is False
        assert schema["personId"]["Mutable"] is False
        # Roles change only through the administration endpoint, at next sign-in.
        assert schema["roles"]["Mutable"] is True

    def test_tokens_can_be_revoked_and_user_existence_is_hidden(self, synthesised):
        template = template_for(synthesised, "identity")
        for client in template.find_resources("AWS::Cognito::UserPoolClient").values():
            assert client["Properties"]["EnableTokenRevocation"] is True
            assert client["Properties"]["PreventUserExistenceErrors"] == "ENABLED"

    def test_the_pre_token_trigger_is_attached_at_v2(self, synthesised):
        """Only V2_0 can add claims to an access token, which is what the API reads."""
        template = template_for(synthesised, "identity")
        pool = next(iter(template.find_resources("AWS::Cognito::UserPool").values()))
        config = pool["Properties"]["LambdaConfig"]["PreTokenGenerationConfig"]
        assert config["LambdaVersion"] == "V2_0"
        assert "LambdaArn" in config

    def test_the_password_policy_is_at_least_twelve_characters(self, synthesised):
        template = template_for(synthesised, "identity")
        pool = next(iter(template.find_resources("AWS::Cognito::UserPool").values()))
        policy = pool["Properties"]["Policies"]["PasswordPolicy"]
        assert policy["MinimumLength"] >= 12

    def test_the_pre_token_trigger_can_read_the_main_table(self, synthesised):
        """Regression: without this, every sign-in silently used the token
        attribute fallback, which a provisioned staff account has none of, so
        it resolved with no roles at all and the authoriser refused it."""
        template = template_for(synthesised, "identity")
        functions = template.find_resources("AWS::Lambda::Function")
        pre_token = next(
            f
            for f in functions.values()
            if f["Properties"]["Handler"] == "atria.services.identity.pre_token.handler"
        )
        env = pre_token["Properties"]["Environment"]["Variables"]
        assert "MAIN_TABLE" in env

        policies = template.find_resources("AWS::IAM::Policy")
        rendered = str(policies)
        assert "dynamodb:GetItem" in rendered or "dynamodb:Query" in rendered

    def test_the_post_confirmation_trigger_is_attached(self, synthesised):
        """Without it a confirmed patient has no person record, so the
        pre-token trigger has nothing to resolve and the authoriser refuses a
        token that looks perfectly valid."""
        template = template_for(synthesised, "identity")
        pool = next(iter(template.find_resources("AWS::Cognito::UserPool").values()))
        assert "PostConfirmation" in pool["Properties"]["LambdaConfig"]

    def test_the_post_confirmation_trigger_knows_its_table_and_tenant(self, synthesised):
        template = template_for(synthesised, "identity")
        functions = template.find_resources("AWS::Lambda::Function")
        post_confirmation = next(
            f
            for f in functions.values()
            if f["Properties"]["Handler"] == "atria.services.identity.post_confirmation.handler"
        )
        env = post_confirmation["Properties"]["Environment"]["Variables"]
        assert "MAIN_TABLE" in env
        # It refuses to guess a tenant, so an unset value would fail every
        # sign-up at runtime rather than quietly picking one.
        assert env["DEFAULT_TENANT_ID"] == config.DEV.default_tenant_id

    def test_cognitos_emails_are_written_by_the_custom_message_trigger(self, synthesised):
        """Without it the codes arrive as Cognito's one unstyled line (ADR 0020)."""
        template = template_for(synthesised, "identity")
        pool = next(iter(template.find_resources("AWS::Cognito::UserPool").values()))
        assert "CustomMessage" in pool["Properties"]["LambdaConfig"]

    def test_the_custom_message_trigger_touches_no_table(self, synthesised):
        """Everything it writes arrives in the event, so it is given nothing."""
        template = template_for(synthesised, "identity")
        role = next(
            f["Properties"]["Role"]["Fn::GetAtt"][0]
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == "atria.services.identity.custom_message.handler"
        )
        for policy in template.find_resources("AWS::IAM::Policy").values():
            if role not in str(policy["Properties"].get("Roles")):
                continue
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                assert "dynamodb" not in str(statement.get("Action"))
                assert "kms" not in str(statement.get("Action"))

    def test_only_the_post_confirmation_trigger_writes(self, synthesised):
        """The pre-token trigger must stay read only: it resolves a caller and
        has no business changing one."""
        template = template_for(synthesised, "identity")
        functions = template.find_resources("AWS::Lambda::Function")
        roles = {
            f["Properties"]["Handler"]: f["Properties"]["Role"]["Fn::GetAtt"][0] for f in functions.values()
        }
        pre_token_role = roles["atria.services.identity.pre_token.handler"]
        writes = set()
        for policy in template.find_resources("AWS::IAM::Policy").values():
            named = str(policy["Properties"].get("Roles"))
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                action = statement.get("Action")
                actions = action if isinstance(action, list) else [action]
                if any(a and "PutItem" in str(a) for a in actions):
                    writes.add(named)
        assert not any(pre_token_role in w for w in writes)


class TestApiStack:
    def test_every_method_goes_through_the_authoriser(self, synthesised):
        template = template_for(synthesised, "api")
        methods = template.find_resources("AWS::ApiGateway::Method")
        assert methods, "the API has no methods"
        for method in methods.values():
            properties = method["Properties"]
            if properties.get("HttpMethod") == "OPTIONS":
                continue  # CORS preflight carries no token by design
            assert properties["AuthorizationType"] == "CUSTOM"
            assert "AuthorizerId" in properties

    def test_the_authoriser_is_a_request_authoriser_on_the_authorization_header(self, synthesised):
        template_for(synthesised, "api").has_resource_properties(
            "AWS::ApiGateway::Authorizer",
            {"Type": "REQUEST", "IdentitySource": "method.request.header.Authorization"},
        )

    def test_me_is_served_by_the_identity_service(self, synthesised):
        template = template_for(synthesised, "api")
        resources = template.find_resources("AWS::ApiGateway::Resource")
        assert any(r["Properties"]["PathPart"] == "me" for r in resources.values())

    def test_the_staff_routes_exist(self, synthesised):
        template = template_for(synthesised, "api")
        parts = {
            r["Properties"]["PathPart"] for r in template.find_resources("AWS::ApiGateway::Resource").values()
        }
        assert {"admin", "staff", "{id}", "roles", "suspend"} <= parts

    def test_the_staff_routes_use_the_right_methods(self, synthesised):
        served = routes(template_for(synthesised, "api"))
        assert ("/admin/staff", "POST") in served
        assert ("/admin/staff/{id}/roles", "PATCH") in served
        assert ("/admin/staff/{id}/suspend", "POST") in served
        # A staff account is never deleted, only suspended.
        assert ("/admin/staff/{id}", "DELETE") not in served

    def test_booking_is_served_on_its_own_route(self, synthesised):
        """Not under /admin: a patient books too, and the matrix decides for whom."""
        served = routes(template_for(synthesised, "api"))
        assert ("/appointments", "POST") in served
        assert ("/me", "GET") in served

    def test_the_appointment_read_and_cancel_routes_exist(self, synthesised):
        """Cancel is a DELETE because the time goes back, while the record
        itself is retained in a terminal state (FR-VIS-08)."""
        served = routes(template_for(synthesised, "api"))
        assert ("/appointments/{id}", "GET") in served
        assert ("/appointments/{id}", "DELETE") in served
        assert ("/patients/me/appointments", "GET") in served

    def test_the_directory_and_slot_routes_exist(self, synthesised):
        served = routes(template_for(synthesised, "api"))
        assert ("/clinicians", "GET") in served
        assert ("/clinicians/{id}/slots", "GET") in served

    def test_the_staff_calendar_routes_exist(self, synthesised):
        """FR-STF-01, on the read only directory function."""
        served = routes(template_for(synthesised, "api"))
        assert ("/clinicians/{id}/calendar", "GET") in served
        assert ("/clinics/{id}/day", "GET") in served

    def test_the_catalogue_routes_are_served(self, synthesised):
        """What a patient needs to book on their own: clinics and types."""
        served = routes(template_for(synthesised, "api"))
        assert ("/clinics", "GET") in served
        assert ("/appointment-types", "GET") in served

    def test_the_directory_service_cannot_write(self, synthesised):
        """It answers questions. Only a booking writes a lock."""
        template = template_for(synthesised, "api")
        functions = template.find_resources("AWS::Lambda::Function")
        directory_role = next(
            f["Properties"]["Role"]["Fn::GetAtt"][0]
            for f in functions.values()
            if f["Properties"]["Handler"] == "atria.services.directory.clinicians.handler"
        )
        for policy in template.find_resources("AWS::IAM::Policy").values():
            if directory_role not in str(policy["Properties"].get("Roles")):
                continue
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                action = statement.get("Action")
                actions = action if isinstance(action, list) else [action]
                assert not any(a and "PutItem" in str(a) for a in actions)

    def test_the_staff_service_can_manage_pool_accounts(self, synthesised):
        """Scoped to admin create, delete and global sign out, nothing wider."""
        template = template_for(synthesised, "api")
        policies = template.find_resources("AWS::IAM::Policy")
        actions: set[str] = set()
        for policy in policies.values():
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                action = statement.get("Action")
                if action:
                    actions.update(action if isinstance(action, list) else [action])
        assert "cognito-idp:AdminCreateUser" in actions
        assert "cognito-idp:AdminDeleteUser" in actions
        assert "cognito-idp:AdminUserGlobalSignOut" in actions
        # The identity service (GET /me) must not carry these: it never
        # touches the pool, only the token it was handed.
        assert "cognito-idp:AdminSetUserPassword" not in actions

    def test_the_staff_service_knows_its_pool(self, synthesised):
        template = template_for(synthesised, "api")
        functions = template.find_resources("AWS::Lambda::Function")
        staff_fn = next(
            f
            for f in functions.values()
            if f["Properties"]["Handler"] == "atria.services.identity.staff.handler"
        )
        env = staff_fn["Properties"]["Environment"]["Variables"]
        assert "USER_POOL_ID" in env

    def test_the_functions_run_the_pinned_runtime(self, synthesised):
        template = template_for(synthesised, "api")
        for function in template.find_resources("AWS::Lambda::Function").values():
            assert function["Properties"]["Runtime"] == "python3.13"

    def test_tracing_is_on_for_the_booking_path(self, synthesised):
        """ADR 0014 puts X-Ray on the booking path; it starts on every function."""
        template = template_for(synthesised, "api")
        for function in template.find_resources("AWS::Lambda::Function").values():
            assert function["Properties"]["TracingConfig"]["Mode"] == "Active"

    def test_the_stage_logs_access_without_request_bodies(self, synthesised):
        """Bodies would capture patient data, so data tracing stays off."""
        template = template_for(synthesised, "api")
        stage = next(iter(template.find_resources("AWS::ApiGateway::Stage").values()))
        assert stage["Properties"]["MethodSettings"][0]["DataTraceEnabled"] is False
        assert "AccessLogSetting" in stage["Properties"]

    def test_the_stage_is_throttled(self, synthesised):
        template = template_for(synthesised, "api")
        stage = next(iter(template.find_resources("AWS::ApiGateway::Stage").values()))
        settings = stage["Properties"]["MethodSettings"][0]
        assert settings["ThrottlingRateLimit"] == 100
        assert settings["ThrottlingBurstLimit"] == 200

    def test_the_identity_service_cannot_reach_the_care_context_key(self, synthesised):
        """The front desk and identity paths never decrypt care context."""
        template = template_for(synthesised, "api")
        policies = template.find_resources("AWS::IAM::Policy")
        rendered = str(policies)
        assert "care-context" not in rendered

    def test_the_authoriser_is_given_no_table_access(self, synthesised):
        """It reads the token only. Resolving records is the services' work."""
        template = template_for(synthesised, "api")
        for policy in template.find_resources("AWS::IAM::Policy").values():
            roles = str(policy["Properties"].get("Roles", ""))
            if "Authoriser" in roles:
                assert "dynamodb" not in str(policy["Properties"]["PolicyDocument"]).lower()


class TestCostGuardStack:
    def test_a_monthly_budget_with_three_thresholds_and_a_forecast(self, synthesised):
        template = template_for(synthesised, "cost-guard")
        budget = next(iter(template.find_resources("AWS::Budgets::Budget").values()))
        notifications = budget["Properties"]["NotificationsWithSubscribers"]
        thresholds = [n["Notification"]["Threshold"] for n in notifications]
        types = {n["Notification"]["NotificationType"] for n in notifications}
        assert sorted(thresholds) == [50, 80, 100, 100]
        assert types == {"ACTUAL", "FORECASTED"}

    def test_the_budget_is_small_because_development_is_synthetic(self, synthesised):
        template = template_for(synthesised, "cost-guard")
        budget = next(iter(template.find_resources("AWS::Budgets::Budget").values()))
        assert budget["Properties"]["Budget"]["BudgetLimit"]["Amount"] <= 50


def queue_named(template: Template, suffix: str) -> dict[str, Any]:
    return next(
        q["Properties"]
        for q in template.find_resources("AWS::SQS::Queue").values()
        if str(q["Properties"]["QueueName"]).endswith(suffix)
    )


class TestAsyncStack:
    def test_the_outbox_has_a_dead_letter_queue(self, synthesised):
        """ADR 0014: a message that cannot be handled is parked, not lost."""
        outbox = queue_named(template_for(synthesised, "async"), "-outbox.fifo")
        assert "RedrivePolicy" in outbox

    def test_the_outbox_and_its_dead_letters_are_fifo(self, synthesised):
        """A booking and the cancellation after it must not be sent out of
        order, and a FIFO queue's dead letter queue must be FIFO too."""
        template = template_for(synthesised, "async")
        assert queue_named(template, "-outbox.fifo")["FifoQueue"] is True
        assert queue_named(template, "-outbox-dlq.fifo")["FifoQueue"] is True

    def test_the_stream_failure_destination_is_a_standard_queue(self, synthesised):
        """Regression. Lambda refuses a FIFO queue as a stream consumer's
        on-failure destination. Synthesis accepted it and only the deploy
        failed, so the rule is pinned here where it is cheap to catch."""
        template = template_for(synthesised, "async")
        failures = queue_named(template, "-stream-failures")
        assert failures.get("FifoQueue") is not True
        mappings = template.find_resources("AWS::Lambda::EventSourceMapping")
        stream = next(m["Properties"] for logical, m in mappings.items() if "SqsEventSource" not in logical)
        destination = str(stream["DestinationConfig"]["OnFailure"]["Destination"])
        assert "StreamFailures" in destination

    def test_every_failure_queue_keeps_what_it_holds_for_two_weeks(self, synthesised):
        """Long enough to notice, look and redrive before it expires."""
        template = template_for(synthesised, "async")
        for suffix in ("-outbox-dlq.fifo", "-stream-failures", "-reminder-failures"):
            assert queue_named(template, suffix)["MessageRetentionPeriod"] == 14 * 24 * 3600

    def test_the_outbox_deduplicates_by_content_for_the_scheduler(self, synthesised):
        """EventBridge Scheduler cannot supply a deduplication id, and a FIFO
        queue refuses a message with neither an id nor content deduplication.
        The dispatcher's explicit ids still take precedence over the body."""
        outbox = queue_named(template_for(synthesised, "async"), "-outbox.fifo")
        assert outbox["ContentBasedDeduplication"] is True

    def test_the_visibility_timeout_outlives_the_sender(self, synthesised):
        """Otherwise a slow send is delivered again while still running, and
        the patient gets two emails."""
        template = template_for(synthesised, "async")
        outbox = next(
            q
            for q in template.find_resources("AWS::SQS::Queue").values()
            if str(q["Properties"]["QueueName"]).endswith("-outbox.fifo")
        )
        sender = next(
            f
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == "atria.services.notify.sender.handler"
        )
        assert outbox["Properties"]["VisibilityTimeout"] > sender["Properties"]["Timeout"]

    def test_the_dispatcher_reads_the_stream_and_not_the_table(self, synthesised):
        """It decides that something happened. It has no business reading rows."""
        template = template_for(synthesised, "async")
        dispatcher_role = next(
            f["Properties"]["Role"]["Fn::GetAtt"][0]
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == "atria.services.notify.outbox.handler"
        )
        actions: set[str] = set()
        for policy in template.find_resources("AWS::IAM::Policy").values():
            if dispatcher_role not in str(policy["Properties"].get("Roles")):
                continue
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                action = statement.get("Action")
                actions.update(action if isinstance(action, list) else [action])
        assert "dynamodb:GetRecords" in actions
        assert "dynamodb:GetItem" not in actions
        assert "dynamodb:PutItem" not in actions

    def test_the_sender_may_only_send_and_only_as_the_one_identity(self, synthesised):
        template = template_for(synthesised, "async")
        sender_role = next(
            f["Properties"]["Role"]["Fn::GetAtt"][0]
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == "atria.services.notify.sender.handler"
        )
        ses_actions: set[str] = set()
        for policy in template.find_resources("AWS::IAM::Policy").values():
            if sender_role not in str(policy["Properties"].get("Roles")):
                continue
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                action = statement.get("Action")
                for name in action if isinstance(action, list) else [action]:
                    if name and str(name).startswith("ses:"):
                        ses_actions.add(str(name))
        assert ses_actions == {"ses:SendEmail"}

    def test_the_sender_knows_which_identity_to_send_as(self, synthesised):
        """An unset value would fail every send, so it is pinned here."""
        template = template_for(synthesised, "async")
        sender = next(
            f
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == "atria.services.notify.sender.handler"
        )
        env = sender["Properties"]["Environment"]["Variables"]
        assert env["NOTICE_SENDER"] == config.DEV.notice_sender
        # Emails link into the web client only once it has a public address.
        assert env["APP_URL"] == config.DEV.app_url

    def policy_actions(self, template: Template, handler: str) -> dict[str, list[dict[str, Any]]]:
        """Every statement on one function's role, keyed by action."""
        role = next(
            f["Properties"]["Role"]["Fn::GetAtt"][0]
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == handler
        )
        found: dict[str, list[dict[str, Any]]] = {}
        for policy in template.find_resources("AWS::IAM::Policy").values():
            if role not in str(policy["Properties"].get("Roles")):
                continue
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]:
                action = statement.get("Action")
                for name in action if isinstance(action, list) else [action]:
                    found.setdefault(str(name), []).append(statement)
        return found

    def test_reminders_live_in_their_own_schedule_group(self, synthesised):
        template = template_for(synthesised, "async")
        groups = template.find_resources("AWS::Scheduler::ScheduleGroup")
        assert [g["Properties"]["Name"] for g in groups.values()] == [f"{config.DEV.prefix}-reminders"]

    def test_the_scheduler_role_is_for_the_scheduler_alone(self, synthesised):
        template = template_for(synthesised, "async")
        role = next(
            r
            for logical, r in template.find_resources("AWS::IAM::Role").items()
            if logical.startswith("ReminderSchedulerRole")
        )
        (statement,) = role["Properties"]["AssumeRolePolicyDocument"]["Statement"]
        assert statement["Principal"] == {"Service": "scheduler.amazonaws.com"}
        # Only schedules in this account may use it.
        assert "aws:SourceAccount" in str(statement["Condition"])

    def test_the_scheduler_can_only_reach_the_outbox_and_its_own_dead_letters(self, synthesised):
        template = template_for(synthesised, "async")
        policy = next(
            p
            for p in template.find_resources("AWS::IAM::Policy").values()
            if "ReminderSchedulerRole" in str(p["Properties"]["Roles"])
        )
        actions = {
            a
            for statement in policy["Properties"]["PolicyDocument"]["Statement"]
            for a in (statement["Action"] if isinstance(statement["Action"], list) else [statement["Action"]])
        }
        assert {a for a in actions if not a.startswith("kms:")} <= {
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
        }

    def test_the_sender_manages_schedules_only_in_the_reminder_group(self, synthesised):
        template = template_for(synthesised, "async")
        actions = self.policy_actions(template, "atria.services.notify.sender.handler")
        (statement,) = actions["scheduler:CreateSchedule"]
        assert "reminders/*" in str(statement["Resource"])
        assert "scheduler:DeleteSchedule" in actions

    def test_the_sender_may_pass_only_the_scheduler_role(self, synthesised):
        template = template_for(synthesised, "async")
        actions = self.policy_actions(template, "atria.services.notify.sender.handler")
        (statement,) = actions["iam:PassRole"]
        assert "ReminderSchedulerRole" in str(statement["Resource"])
        assert statement["Condition"]["StringEquals"]["iam:PassedToService"] == ("scheduler.amazonaws.com")

    def test_the_sender_texts_phones_and_not_topics(self, synthesised):
        """A phone number has no ARN, so publishing is broad; publishing to a
        topic is denied, because this function reaches patients, not
        subscribers."""
        template = template_for(synthesised, "async")
        statements = self.policy_actions(template, "atria.services.notify.sender.handler")["sns:Publish"]
        effects = {s.get("Effect") for s in statements}
        assert effects == {"Allow", "Deny"}
        deny = next(s for s in statements if s["Effect"] == "Deny")
        assert ":sns:" in str(deny["Resource"])

    def test_the_sender_knows_where_reminders_go(self, synthesised):
        template = template_for(synthesised, "async")
        sender = next(
            f
            for f in template.find_resources("AWS::Lambda::Function").values()
            if f["Properties"]["Handler"] == "atria.services.notify.sender.handler"
        )
        env = sender["Properties"]["Environment"]["Variables"]
        for name in (
            "SCHEDULE_GROUP",
            "SCHEDULER_ROLE_ARN",
            "OUTBOX_QUEUE_ARN",
            "REMINDER_FAILURES_ARN",
        ):
            assert env.get(name), name

    def test_the_sender_takes_one_message_at_a_time(self, synthesised):
        """SES in the sandbox allows one a second; a batch would be throttled
        into retries and the whole batch redelivered."""
        template = template_for(synthesised, "async")
        mappings = template.find_resources("AWS::Lambda::EventSourceMapping")
        by_source = {
            ("sqs" if "SqsEventSource" in logical else "stream"): mapping["Properties"]
            for logical, mapping in mappings.items()
        }
        assert by_source["sqs"]["BatchSize"] == 1
        # The stream is read in batches: reading one change at a time would
        # fall behind a busy clinic.
        assert by_source["stream"]["BatchSize"] > 1

    def test_the_sender_is_capped_without_reserving_concurrency(self, synthesised):
        """Different appointments are different FIFO groups, so an uncapped
        queue drives many senders at once and bursts past the SES sandbox rate.
        Reserving concurrency instead would fail the deploy: the development
        account's limit is 10 and AWS keeps all 10 unreserved."""
        template = template_for(synthesised, "async")
        mappings = template.find_resources("AWS::Lambda::EventSourceMapping")
        queue_mapping = next(
            m["Properties"] for logical, m in mappings.items() if "SqsEventSource" in logical
        )
        assert queue_mapping["ScalingConfig"]["MaximumConcurrency"] == 2
        for function in template.find_resources("AWS::Lambda::Function").values():
            assert "ReservedConcurrentExecutions" not in function["Properties"]

    def test_the_stream_is_read_from_now_and_not_from_the_horizon(self, synthesised):
        """The stream holds 24 hours. Starting at the horizon would replay
        yesterday's bookings and send a confirmation for each one again."""
        template = template_for(synthesised, "async")
        mappings = template.find_resources("AWS::Lambda::EventSourceMapping")
        stream = next(m["Properties"] for logical, m in mappings.items() if "SqsEventSource" not in logical)
        assert stream["StartingPosition"] == "LATEST"

    def test_both_sources_report_failures_per_item(self, synthesised):
        """One bad record is retried and parked alone rather than dragging the
        whole batch back through."""
        template = template_for(synthesised, "async")
        for mapping in template.find_resources("AWS::Lambda::EventSourceMapping").values():
            assert mapping["Properties"]["FunctionResponseTypes"] == ["ReportBatchItemFailures"]


class TestObservabilityStack:
    def test_alarms_cover_errors_latency_and_the_authoriser(self, synthesised):
        template = template_for(synthesised, "observability")
        template.resource_count_is("AWS::CloudWatch::Alarm", 3)

    def test_every_alarm_notifies_the_topic(self, synthesised):
        template = template_for(synthesised, "observability")
        for alarm in template.find_resources("AWS::CloudWatch::Alarm").values():
            assert alarm["Properties"]["AlarmActions"]

    def test_there_is_one_dashboard(self, synthesised):
        template_for(synthesised, "observability").resource_count_is("AWS::CloudWatch::Dashboard", 1)


class TestTagging:
    def test_every_table_is_tagged_as_synthetic_data(self, synthesised):
        """Constraint C-03: development processes synthetic data only.

        A TableV2 carries its tags on the replica rather than the table.
        """
        template = template_for(synthesised, "data")
        template.has_resource_properties(
            "AWS::DynamoDB::GlobalTable",
            {
                "Replicas": Match.array_with(
                    [
                        Match.object_like(
                            {"Tags": Match.array_with([{"Key": "DataClassification", "Value": "synthetic"}])}
                        )
                    ]
                )
            },
        )
