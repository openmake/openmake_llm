<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# migrations — Schema Version Management

## Purpose
Manages PostgreSQL schema migrations using a sequential versioning system. `runner.ts` is invoked during application bootstrap to apply any pending migrations in order. `cli.ts` provides a command-line interface for manual migration control (run, rollback, status). Migration files are numbered SQL scripts stored alongside the runner. Migrations run inside transactions so a failed migration never leaves the schema in a partial state.

## Key Files
| File | Description |
|------|-------------|
| `runner.ts` | Migration runner: reads applied versions from DB, applies pending migrations in sequence |
| `cli.ts` | CLI interface for `migrate up`, `migrate down`, `migrate status` commands |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Migration files are **append-only** — never modify an already-applied migration; create a new one instead
- Each migration runs in a transaction; the runner commits on success and rolls back on failure
- Migration version numbers must be strictly increasing integers or timestamps
- Schema changes that enable extensions (e.g., `pgvector`) must be in their own migration and run first

### Testing Requirements
- Test the runner against a real test DB; mock is insufficient for migration correctness
- Verify both up and down (rollback) paths for each migration
- Run `npm run test:bun` for integration tests

### Common Patterns
- Migration file naming: `{version}_{description}.sql` (e.g., `001_create_users.sql`)
- Always include both `-- Up` and `-- Down` sections in migration SQL files
- Check `migrations` table in DB to see which versions have been applied

## Dependencies
### Internal
- `data/models/unified-database.ts` — DB pool for executing migration SQL
- `config/env.ts` — `DATABASE_URL`

### External
- `pg` — SQL execution
- `fs` (Node built-in) — Reading migration SQL files

<!-- MANUAL: -->
