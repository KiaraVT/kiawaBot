"""Tests verifying GitHub Actions workflow structural contracts."""

from pathlib import Path
import unittest
import yaml


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
            with open(workflow_file, "r", encoding="utf-8") as handle:
                parsed = yaml.safe_load(handle)
            jobs = parsed.get("jobs", {})
            for job_name, job_def in jobs.items():
                if "uses" in job_def:
                    self.assertNotIn(
                        "environment",
                        job_def,
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


if __name__ == "__main__":
    unittest.main()
