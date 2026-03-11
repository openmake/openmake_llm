<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# .github/workflows

## Purpose
GitHub Actions CI/CD pipelines for the OpenMake LLM platform. Workflows run automatically on push and pull request events to the `main` and `develop` branches, enforcing the same quality gates as the local `scripts/ci-test.sh` script.

## Key Files
| File | Description |
|------|-------------|
| `ci.yml` | Single CI pipeline triggered on push/PR to `main` and `develop`. Runs with a 15-minute timeout. Mirrors the steps in `scripts/ci-test.sh`: Bun tests, TypeScript build, bundle size guard, ESLint. |

## For AI Agents
### Working In This Directory
- `ci.yml` mirrors `scripts/ci-test.sh` — keep them in sync when adding new quality gates.
- The 15-minute timeout is intentional; do not increase it without justification.
- Secrets (API keys, tokens) are stored in GitHub repository secrets, not in workflow files.
- Do not add `continue-on-error: true` to quality gate steps — failures must be visible.

### Testing Requirements
- Validate workflow YAML syntax with `act` (local GitHub Actions runner) or GitHub's workflow linter before merging.
- Test workflow changes on a feature branch before merging to `main` or `develop`.

### Common Patterns
- Jobs use `ubuntu-latest` runner.
- Node.js and Bun versions are pinned via `actions/setup-node` and `oven-sh/setup-bun`.
- Caching uses `actions/cache` for `node_modules` and Bun's cache directory.

## Dependencies
### Internal
- `scripts/ci-test.sh` — local equivalent of the CI pipeline steps
- `package.json` — npm scripts invoked by the workflow

### External
- GitHub Actions runtime
- `oven-sh/setup-bun` action for Bun installation

<!-- MANUAL: -->
