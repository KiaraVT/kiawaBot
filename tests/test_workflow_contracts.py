"""Tests verifying GitHub Actions workflow structural contracts."""

from pathlib import Path
import re
import unittest


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

    def test_reusable_workflow_callers_do_not_declare_environment(self) -> None:
        """Reusable workflow caller jobs must not define environment key."""
        workflow_files = [
            self.workflows_dir / "quality-review-pr.yml",
            self.workflows_dir / "security-review-pr.yml",
        ]
        for workflow_file in workflow_files:
            content = workflow_file.read_text(encoding="utf-8")
            jobs = extract_workflow_jobs(content)
            for job_name, job_body in jobs.items():
                has_uses = bool(re.search(r"^\s+uses:", job_body, re.MULTILINE))
                if has_uses:
                    has_environment = bool(
                        re.search(r"^\s+environment:", job_body, re.MULTILINE)
                    )
                    self.assertFalse(
                        has_environment,
                        (
                            f"Job '{job_name}' in {workflow_file.name} defines "
                            "'environment' while invoking a reusable workflow. "
                            "GitHub Actions rejects 'environment' on caller "
                            "jobs with 'uses'."
                        ),
                    )

    def test_security_review_uses_pulls_list_for_fork_resolution(self) -> None:
        """Security review must use pulls.list instead of commit association."""
        workflow_file = self.workflows_dir / "security-review-pr.yml"
        content = workflow_file.read_text(encoding="utf-8")
        self.assertNotIn(
            "listPullRequestsAssociatedWithCommit",
            content,
            "security-review-pr.yml must not use "
            "listPullRequestsAssociatedWithCommit because external fork "
            "commits return empty candidate lists in the GitHub REST API.",
        )
        self.assertIn(
            "github.rest.pulls.list",
            content,
            "security-review-pr.yml must paginate github.rest.pulls.list to "
            "resolve fork pull requests reliably.",
        )

    def test_quality_review_grants_actions_read_permission(self) -> None:
        """Quality review must grant actions: read to allow artifact downloads."""
        workflow_file = self.workflows_dir / "quality-review-pr.yml"
        content = workflow_file.read_text(encoding="utf-8")
        jobs = extract_workflow_jobs(content)
        for job_name in ("review", "review-fork"):
            self.assertIn(
                job_name,
                jobs,
                f"quality-review-pr.yml missing job '{job_name}'",
            )
            self.assertIn(
                "actions: read",
                jobs[job_name],
                (
                    f"Job '{job_name}' in quality-review-pr.yml must grant "
                    "'actions: read' so downstream artifact download succeeds."
                ),
            )

    def test_security_review_guards_base_sha_for_adopter_scripts(self) -> None:
        """Security review must verify adopter scripts exist on base_sha."""
        workflow_file = self.workflows_dir / "security-review-pr.yml"
        content = workflow_file.read_text(encoding="utf-8")
        required_scripts = [
            "ci/build_pr_case.py",
            "ci/run_model_command.py",
            "scripts/check_pr_review_response.py",
        ]
        for script in required_scripts:
            self.assertIn(
                script,
                content,
                f"security-review-pr.yml must check {script} existence on "
                "base_sha before invoking foucault.",
            )
        self.assertIn(
            "status === 404",
            content,
            "security-review-pr.yml must narrow fallback to 404 missing status.",
        )
        self.assertIn(
            "baseSha = context.sha",
            content,
            "security-review-pr.yml must fallback baseSha to context.sha.",
        )

    def test_review_jobs_support_ollama_and_model_api_keys(self) -> None:
        """Both same-repo and fork review jobs must support OLLAMA_API_KEY."""
        workflow_files = [
            self.workflows_dir / "quality-review-pr.yml",
            self.workflows_dir / "security-review-pr.yml",
        ]
        for workflow_file in workflow_files:
            content = workflow_file.read_text(encoding="utf-8")
            jobs = extract_workflow_jobs(content)
            for job_name in ("review", "review-fork"):
                self.assertIn(
                    job_name,
                    jobs,
                    f"{workflow_file.name} missing job '{job_name}'",
                )
                job_body = jobs[job_name]
                self.assertIn(
                    "secrets.OLLAMA_API_KEY",
                    job_body,
                    (
                        f"Job '{job_name}' in {workflow_file.name} must reference "
                        "secrets.OLLAMA_API_KEY so environments using OLLAMA_API_KEY "
                        "are supported."
                    ),
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

    def test_review_resolvers_run_for_all_pull_request_ci_outcomes(self) -> None:
        """Review jobs must not let a pull request author suppress reviews."""
        workflow_files = [
            self.workflows_dir / "quality-review-pr.yml",
            self.workflows_dir / "security-review-pr.yml",
        ]
        for workflow_file in workflow_files:
            content = workflow_file.read_text(encoding="utf-8")
            self.assertIn(
                "github.event.workflow_run.event == 'pull_request'",
                content,
            )
            self.assertNotIn(
                "github.event.workflow_run.conclusion == 'success'",
                content,
            )

    def test_review_concurrency_groups_use_resolved_pull_request_number(self) -> None:
        """Review concurrency must cancel obsolete and label-revoked runs."""
        workflow_files = [
            self.workflows_dir / "quality-review-pr.yml",
            self.workflows_dir / "security-review-pr.yml",
        ]
        expected_output = {
            "quality-review-pr.yml": "needs.resolve.outputs.number",
            "security-review-pr.yml": "needs.resolve-pr.outputs.pr_number",
        }
        expected_skip_job = {
            "quality-review-pr.yml": "fork-skip",
            "security-review-pr.yml": "fork-review-skipped",
        }
        for workflow_file in workflow_files:
            content = workflow_file.read_text(encoding="utf-8")
            jobs = extract_workflow_jobs(content)
            for job_name in ("review", "review-fork", expected_skip_job[workflow_file.name]):
                self.assertIn(
                    expected_output[workflow_file.name],
                    jobs[job_name],
                )
                self.assertIn("cancel-in-progress: true", jobs[job_name])
            self.assertNotIn(
                "github.event.workflow_run.head_repository.full_name",
                content,
            )
            self.assertNotIn(
                "github.event.workflow_run.head_branch",
                content,
            )

    def test_review_resolvers_ignore_older_ci_run_events(self) -> None:
        """Only the latest completed CI event may dispatch a review."""
        workflow_files = [
            self.workflows_dir / "quality-review-pr.yml",
            self.workflows_dir / "security-review-pr.yml",
        ]
        for workflow_file in workflow_files:
            content = workflow_file.read_text(encoding="utf-8")
            self.assertIn("actions.listWorkflowRuns", content)
            self.assertIn("ci.yml", content)
            self.assertIn("latestCiRunId", content)
            self.assertIn("sourceRunId", content)
            self.assertLess(
                content.index("actions.listWorkflowRuns"),
                content.index("github.rest.pulls.list"),
            )

    def test_review_resolvers_distinguish_stale_and_ambiguous_heads(self) -> None:
        """Zero matches must skip, while multiple matches must fail visibly."""
        quality_file = self.workflows_dir / "quality-review-pr.yml"
        quality_content = quality_file.read_text(encoding="utf-8")
        security_file = self.workflows_dir / "security-review-pr.yml"
        security_content = security_file.read_text(encoding="utf-8")

        self.assertIn("if (matches.length === 0)", quality_content)
        self.assertIn("if (matches.length > 1)", quality_content)
        self.assertIn("if (candidates.length === 0)", security_content)
        self.assertIn("if (candidates.length > 1)", security_content)
        for content in (quality_content, security_content):
            self.assertIn(
                "expected one pull request for workflow run head",
                content,
            )

    def test_security_review_sets_all_stale_outputs(self) -> None:
        """The stale security resolver must publish a complete output set."""
        workflow_file = self.workflows_dir / "security-review-pr.yml"
        content = workflow_file.read_text(encoding="utf-8")

        self.assertIn(
            'core.setOutput("already_reviewed", "false");',
            content,
        )


if __name__ == "__main__":
    unittest.main()

