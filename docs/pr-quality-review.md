# PR Quality Review Architecture

## Purpose

The PR quality reviewer applies `QUALITY.md` to pull requests. The reviewer produces findings and machine-readable verdicts.

## Pins

- `QUALITY.md`: commit `fcda240de46de3bd85e17cd49bdfa8a7f7cdbf08`, through `quality_ref`.
- `quality-review.yml`: the same commit, through the `uses:` pin.

## Wiring

- `.github/workflows/quality-review-pr.yml` runs the caller workflow.
- The workflow triggers on completion of `ci`.
- The caller maps repository secret `OLLAMA_API_KEY` to `MODEL_API_KEY`.
- Fork pull requests receive a skipped check run and no secret.

## Trust Boundary

The workflow-run caller runs default-branch code. Pull request files remain review data. The workflow never executes pull request code. Every checkout sets `persist-credentials: false`.
