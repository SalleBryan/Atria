"""The synthesised templates say what the specification says.

These are assertions about the shape of the infrastructure, not a snapshot: a
snapshot would change on every unrelated edit and teach nobody anything. Each
test states a property the deployment must hold.

Verifies NFR-SEC (encryption with customer-managed keys, every route
authorised), FR-TEN-01 (the single table design and its indexes) and ADR 0014
(the budget and the alarms).
"""

from __future__ import annotations

import aws_cdk as cdk
import pytest
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


class TestDataStack:
    def test_one_main_table_and_one_care_context_table(self, synthesised):
        template_for(synthesised, "data").resource_count_is("AWS::DynamoDB::GlobalTable", 2)

    def test_the_main_table_carries_the_five_specified_indexes(self, synthesised):
        template = template_for(synthesised, "data")
        tables = template.find_resources("AWS::DynamoDB::GlobalTable")
        main = next(t for t in tables.values() if t["Properties"]["TableName"].endswith("-main"))
        names = {index["IndexName"] for index in main["Properties"]["GlobalSecondaryIndexes"]}
        assert names == {
            "PatientIndex",
            "ClinicianIndex",
            "ClinicDayIndex",
            "PersonIndex",
            "OutboxIndex",
        }

    def test_both_tables_use_a_customer_managed_key(self, synthesised):
        template = template_for(synthesised, "data")
        for table in template.find_resources("AWS::DynamoDB::GlobalTable").values():
            replicas = table["Properties"]["Replicas"]
            assert all("SSESpecification" in replica for replica in replicas)

    def test_care_context_expires_and_bookings_do_not(self, synthesised):
        """ADR 0006: care context is purged sooner than booking history."""
        template = template_for(synthesised, "data")
        tables = template.find_resources("AWS::DynamoDB::GlobalTable")
        care = next(t for t in tables.values() if t["Properties"]["TableName"].endswith("-care-context"))
        main = next(t for t in tables.values() if t["Properties"]["TableName"].endswith("-main"))
        assert care["Properties"]["TimeToLiveSpecification"]["Enabled"] is True
        assert "TimeToLiveSpecification" not in main["Properties"]

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
