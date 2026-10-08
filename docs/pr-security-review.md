# PR Security Review Architecture

## Purpose

The PR security reviewer applies `AUDIT.md` to pull requests. The reviewer produces findings and machine-readable verdicts.

## Pins

- `AUDIT.md`: commit `f59866d6e3ff71affa8404117877b58b8d79eea2`, through `audit_ref`.
- `security-review.yml`: the same commit, through the `uses:` pin.

## Wiring

- `.github/workflows/security-review-pr.yml` runs the caller workflow.
- The workflow triggers on completion of `ci`.
- `ci/build_pr_case.py`, `ci/run_model_command.py`, and `ci/call_model.py` supply the review adapter.
- `ci/model_providers.json` configures the active provider profile.
- `scripts/check_pr_review_response.py` validates model output format.
- The caller maps repository secret `OLLAMA_API_KEY` to `MODEL_API_KEY`.
- Fork pull requests receive a skipped result and no secret.

## Trust Boundary

The workflow-run caller runs default-branch code. Pull request files remain review data. The workflow never executes pull request code. Every checkout sets `persist-credentials: false`.
