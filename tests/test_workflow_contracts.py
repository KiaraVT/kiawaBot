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


if __name__ == "__main__":
    unittest.main()
