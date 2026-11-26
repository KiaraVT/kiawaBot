"""Tests verifying GitHub Actions workflow structural contracts."""

from pathlib import Path
import re
import unittest


PERSONAS_REF = "1649e5c9710fd85d6cca12006e344af27a5404a6"
PERSONA_WORKFLOW = "persona-review.yml"
RETIRED_WORKFLOWS = ("quality-review-pr.yml", "security-review-pr.yml")
RETIRED_UPSTREAMS = ("abuzucom/euler", "abuzucom/foucault")
RETIRED_ADAPTER_FILES = (
    "ci/build_pr_case.py",
    "ci/call_model.py",
    "ci/run_model_command.py",
    "ci/model_providers.json",
    "scripts/check_pr_review_response.py",
)


def extract_workflow_jobs(content: str) -> dict[str, str]:
    """Extract workflow job text blocks from a YAML workflow file."""
    jobs: dict[str, str] = {}
    current_job: str | None = None
    lines: list[str] = []
    in_jobs_section = False
    for line in content.splitlines():
        if line.startswith("jobs:"):
            in_jobs_section = True
            continue
        if not in_jobs_section:
            continue
        if line and not line.startswith(" ") and not line.startswith("#"):
            break
        if line.startswith("  ") and not line.startswith("   ") and ":" in line:
            key = line.strip().split(":")[0].strip()
            if current_job:
                jobs[current_job] = "\n".join(lines)
                lines = []
            current_job = key
        elif current_job:
            lines.append(line)
    if current_job:
        jobs[current_job] = "\n".join(lines)
    return jobs


class WorkflowContractsTestCase(unittest.TestCase):
    """Verify structural validity and API contracts for PR review workflows."""

    def setUp(self) -> None:
        """Locate repository workflow directory."""
        self.repo_root = Path(__file__).resolve().parent.parent
        self.workflows_dir = self.repo_root / ".github" / "workflows"
        self.persona_workflow = self.workflows_dir / PERSONA_WORKFLOW
        self.persona_content = self.persona_workflow.read_text(encoding="utf-8")
        self.persona_jobs = extract_workflow_jobs(self.persona_content)

    def test_retired_review_workflows_are_removed(self) -> None:
        """The superseded euler and foucault caller files must be gone."""
        for retired in RETIRED_WORKFLOWS:
            self.assertFalse(
                (self.workflows_dir / retired).exists(),
                f"{retired} must not exist after the agents-personas migration.",
            )
        self.assertTrue(
            self.persona_workflow.exists(),
            f"{PERSONA_WORKFLOW} must exist as the persona review caller.",
        )

    def test_retired_upstream_repositories_are_not_referenced(self) -> None:
        """No workflow may call the superseded upstream repositories."""
        for workflow_file in sorted(self.workflows_dir.glob("*.yml")):
            content = workflow_file.read_text(encoding="utf-8")
            for retired in RETIRED_UPSTREAMS:
                self.assertNotIn(
                    retired,
                    content,
                    f"{workflow_file.name} must not reference {retired}.",
                )

    def test_persona_jobs_use_the_agents_personas_pin(self) -> None:
        """Both persona jobs must call the agents-personas persona wrappers."""
        expected = {
            "foucault": "foucault-security-review.yml",
            "euler": "euler-quality-review.yml",
        }
        for job_name, wrapper in expected.items():
            self.assertIn(job_name, self.persona_jobs)
            job_body = self.persona_jobs[job_name]
            self.assertIn(
                f"uses: abuzucom/agents-personas/.github/workflows/{wrapper}@{PERSONAS_REF}",
                job_body,
                f"Job '{job_name}' must pin the {wrapper} wrapper at the release commit.",
            )

    def test_persona_jobs_pass_the_same_commit_sha_to_personas_ref(self) -> None:
        """The personas_ref input must match the uses pin exactly."""
        for job_name in ("foucault", "euler"):
            job_body = self.persona_jobs[job_name]
            match = re.search(r'personas_ref:\s*"([0-9a-f]{40})"', job_body)
            self.assertIsNotNone(
                match,
                f"Job '{job_name}' must pass a full commit SHA through personas_ref.",
            )
            self.assertEqual(match.group(1), PERSONAS_REF)
            uses_pin = re.search(r"@([0-9a-f]{40})\s*$", job_body, re.MULTILINE)
            self.assertIsNotNone(uses_pin)
            self.assertEqual(uses_pin.group(1), match.group(1))

    def test_persona_jobs_do_not_declare_environment(self) -> None:
        """Reusable workflow caller jobs must not define environment key."""
        for job_name, job_body in self.persona_jobs.items():
            has_uses = bool(re.search(r"^\s+uses:", job_body, re.MULTILINE))
            if has_uses:
                has_environment = bool(
                    re.search(r"^\s+environment:", job_body, re.MULTILINE)
                )
                self.assertFalse(
                    has_environment,
                    (
                        f"Job '{job_name}' defines 'environment' while invoking a "
                        "reusable workflow. GitHub Actions rejects 'environment' "
                        "on caller jobs with 'uses'."
                    ),
                )

    def test_review_jobs_support_ollama_and_model_api_keys(self) -> None:
        """Both persona jobs must support OLLAMA_API_KEY."""
        for job_name in ("foucault", "euler"):
            self.assertIn(job_name, self.persona_jobs)
            job_body = self.persona_jobs[job_name]
            self.assertIn(
                "secrets.OLLAMA_API_KEY",
                job_body,
                (
                    f"Job '{job_name}' must reference secrets.OLLAMA_API_KEY so "
                    "environments using OLLAMA_API_KEY are supported."
                ),
            )
            self.assertIn("secrets.MODEL_API_KEY", job_body)

    def test_review_jobs_run_for_all_pull_request_ci_outcomes(self) -> None:
        """Review jobs must not let a pull request author suppress reviews."""
        for job_name in ("foucault", "euler"):
            job_body = self.persona_jobs[job_name]
            self.assertIn("github.event.workflow_run.event == 'pull_request'", job_body)
            self.assertNotIn("github.event.workflow_run.conclusion", job_body)

    def test_persona_jobs_route_reviews_through_the_fork_review_environment(self) -> None:
        """Both persona jobs must opt into the protected fork-review path."""
        for job_name in ("foucault", "euler"):
            job_body = self.persona_jobs[job_name]
            self.assertIn(
                "fork_review: true",
                job_body,
                f"Job '{job_name}' must set fork_review so every review waits "
                "for environment approval.",
            )

    def test_persona_jobs_declare_the_expected_path_filters(self) -> None:
        """Both persona jobs must skip documentation-only pull requests."""
        for job_name in ("foucault", "euler"):
            job_body = self.persona_jobs[job_name]
            for pattern in ("!CHANGELOG.md", "!README.md", "!docs/**"):
                self.assertIn(pattern, job_body)
        self.assertIn('exclude_paths: "tests/**"', self.persona_jobs["euler"])

    def test_check_run_names_use_the_persona_layout(self) -> None:
        """The engine publishes persona-scoped check names."""
        self.assertIn("euler / quality", self.persona_content)
        self.assertIn("foucault / security", self.persona_content)
        self.assertNotIn("name: quality-review", self.persona_content)
        self.assertNotIn("name: security-review", self.persona_content)

    def test_annotate_job_keeps_a_status_function(self) -> None:
        """The annotate job must survive a skipped persona job."""
        job_body = self.persona_jobs["annotate"]
        self.assertIn("!cancelled()", job_body)
        self.assertIn("needs: [foucault, euler]", job_body)

    def test_annotate_job_resolves_the_pull_request_number(self) -> None:
        """The annotate job must resolve the number from the workflow run head."""
        job_body = self.persona_jobs["annotate"]
        self.assertIn("github.rest.pulls.list", job_body)
        self.assertIn("github.event.workflow_run.head_sha", job_body)

    def test_annotate_job_uses_the_engine_comment_markers(self) -> None:
        """The annotation must match the comment markers the engine writes."""
        job_body = self.persona_jobs["annotate"]
        self.assertIn("persona-review: euler / quality", job_body)
        self.assertIn("persona-review: foucault / security", job_body)
        self.assertIn("docs/pr-quality-review.md", job_body)
        self.assertIn("docs/pr-security-review.md", job_body)

    def test_workflow_checkouts_disable_persisted_credentials(self) -> None:
        """Every checkout in the review workflows must drop its credentials."""
        for workflow_file in sorted(self.workflows_dir.glob("*.yml")):
            content = workflow_file.read_text(encoding="utf-8")
            blocks = re.findall(
                r"uses: actions/checkout@[^\n]*\n(?:.*\n)*?(?=\n\s*- name:|\Z)",
                content,
            )
            for block in blocks:
                self.assertIn(
                    "persist-credentials: false",
                    block,
                    f"{workflow_file.name} has a checkout that persists credentials.",
                )

    def test_retired_adapter_files_are_removed(self) -> None:
        """The engine supplies the adapter stack, so the local copies are gone."""
        for retired in RETIRED_ADAPTER_FILES:
            self.assertFalse(
                (self.repo_root / retired).exists(),
                f"{retired} must not exist after the agents-personas migration.",
            )

    def test_ci_pins_node_version_and_bounds_node_tests(self) -> None:
        """CI must use the production Node version and bound the test step."""
        workflow_file = self.workflows_dir / "ci.yml"
        content = workflow_file.read_text(encoding="utf-8")

        self.assertIn('node-version: "26.13.1"', content)
        self.assertIn(
            "- name: Run Node.js unit tests\n        timeout-minutes: 2\n        run: npm test",
            content,
        )


if __name__ == "__main__":
    unittest.main()
