"""HostingStack: the web client on AWS Amplify Hosting.

The site is a static build (web/dist), uploaded by tools/deploy_web.py as a
manual deployment: the app is not connected to the repository, so Amplify
holds no GitHub token, and what is live is exactly what was built and tested.

The API stays on the page's own origin, at /api, as it is on the development
server: Amplify rewrites /api/* to the API Gateway stage, so the browser
never makes a cross-origin call and the API needs no CORS. Every other path
without a file extension is the single-page app's, answered with index.html.

No WAF in development (user decision, 2026-09-26): a web ACL costs a fixed
monthly fee for a site holding synthetic data. Production puts AWS WAF in
front of the site and the API.
"""

from __future__ import annotations

from typing import Any

from aws_cdk import CfnOutput, Stack
from aws_cdk import aws_amplify as amplify
from constructs import Construct

from atria_infra.config import Environment
from atria_infra.stacks.api import ApiStack

BRANCH = "main"

# Paths with no extension, or one that is not a static file, are the app's.
STATIC = "css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|webmanifest"
SPA_PATHS = f"</^[^.]+$|\\.(?!({STATIC})$)([^.]+$)/>"

SECURITY_HEADERS = """customHeaders:
  - pattern: '**/*'
    headers:
      - key: Strict-Transport-Security
        value: max-age=31536000; includeSubDomains
      - key: X-Content-Type-Options
        value: nosniff
      - key: X-Frame-Options
        value: DENY
      - key: Referrer-Policy
        value: strict-origin-when-cross-origin
"""


class HostingStack(Stack):
    def __init__(
        self, scope: Construct, construct_id: str, settings: Environment, api: ApiStack, **kwargs: Any
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        stage = f"https://{api.api.rest_api_id}.execute-api.{self.region}.amazonaws.com/{settings.name}"

        self.app = amplify.CfnApp(
            self,
            "Web",
            name=f"{settings.prefix}-web",
            description="Atria web client",
            platform="WEB",
            custom_headers=SECURITY_HEADERS,
            custom_rules=[
                amplify.CfnApp.CustomRuleProperty(source="/api/<*>", target=f"{stage}/<*>", status="200"),
                amplify.CfnApp.CustomRuleProperty(source=SPA_PATHS, target="/index.html", status="200"),
            ],
        )
        self.branch = amplify.CfnBranch(
            self,
            "Main",
            app_id=self.app.attr_app_id,
            branch_name=BRANCH,
            stage="DEVELOPMENT",
            enable_auto_build=False,
        )
        self.branch.add_dependency(self.app)

        CfnOutput(self, "AppId", value=self.app.attr_app_id)
        CfnOutput(self, "Url", value=f"https://{BRANCH}.{self.app.attr_default_domain}")
