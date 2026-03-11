<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# scripts

## Purpose
Project-wide DevOps, CI, migration, and evaluation scripts. These scripts orchestrate the build pipeline, enforce quality gates, manage database schema evolution, and benchmark AI subsystems. They are invoked by npm run scripts, CI pipelines, and git hooks.

## Key Files
| File | Description |
|------|-------------|
| `ci-test.sh` | CI gate script: runs Bun test suite, TypeScript build, bundle size guard, and ESLint in sequence. Mirrors the GitHub Actions CI pipeline. |
| `check-schema-drift.sh` | Detects drift between the canonical schema (`services/database/init/002-schema.sql`) and the live database, failing the build if diverged. |
| `deploy-frontend.sh` | Syncs compiled frontend assets from `frontend/web/public/` into `backend/api/dist/public/` after a backend build. |
| `install-hooks.sh` | Installs git hook templates from `hooks/` into `.git/hooks/`, enabling pre-commit and pre-push quality checks. |
| `run-migrations.ts` | TypeScript DB migration runner. Applies incremental SQL files from `services/database/migrations/` in order, tracking applied versions. |
| `eval-rag.ts` | RAG benchmark script. Runs a query set against the RAG pipeline and reports retrieval precision/recall metrics. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `hooks/` | Git hook templates installed by `install-hooks.sh` |

## For AI Agents
### Working In This Directory
- Shell scripts use `set -euo pipefail` — all commands must succeed or the script aborts.
- TypeScript scripts (`*.ts`) are run via `ts-node` or `bun` — check `package.json` for the exact invocation.
- Do not modify `ci-test.sh` to suppress failures; fix the underlying issue instead.
- Schema drift checks are authoritative — if `check-schema-drift.sh` fails, update the schema or migration files, not the script.

### Testing Requirements
- Run `bash scripts/ci-test.sh` to validate the full CI gate locally before committing.
- Migration scripts should be tested against a local PostgreSQL instance with `DATABASE_URL` set.

### Common Patterns
- Scripts reference project root via `$(dirname "$0")/..` — always run from project root.
- Environment variables are loaded from `.env` at project root; scripts do not source `.env` themselves.

## Dependencies
### Internal
- `services/database/` — migration SQL files consumed by `run-migrations.ts`
- `backend/api/` — TypeScript source compiled and size-checked by `ci-test.sh`
- `frontend/web/` — assets synced by `deploy-frontend.sh`

### External
- `bun` — test runner
- `ts-node` — TypeScript script execution
- `eslint` — linting gate in `ci-test.sh`

<!-- MANUAL: -->
