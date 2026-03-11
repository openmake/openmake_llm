<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# data — PostgreSQL Data Access Layer

## Purpose
All database access for the application. Uses raw SQL with the `pg` Pool — no ORM. `user-manager.ts` handles user CRUD with bcrypt password hashing. `retry-wrapper.ts` provides transparent retry logic for transient DB errors. Repositories under `repositories/` provide typed access to each domain table (including `conversation-repository.ts` for chat sessions/messages). Schema migrations run automatically on startup via `migrations/runner.ts`.

## Key Files
| File | Description |
|------|-------------|
| `user-manager.ts` | User CRUD with bcrypt hashing; role assignment |
| `retry-wrapper.ts` | Wraps DB calls with exponential-backoff retry for transient connection errors |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `repositories/` | 13 typed repositories: api-key, audit, conversation, feedback, kb, memory, research, skill, user, vector (see `repositories/AGENTS.md`) |
| `models/` | Unified DB connection pool and token blacklist model (see `models/AGENTS.md`) |
| `migrations/` | Migration runner and CLI for schema version management (see `migrations/AGENTS.md`) |

## For AI Agents
### Working In This Directory
- All SQL queries must use parameterized queries (`$1, $2, ...`) — never string interpolation
- Use `retry-wrapper.ts` for all DB operations that may encounter transient errors
- Schema changes must always be accompanied by a new migration file in `migrations/`
- The DB connection pool is initialized once in `models/unified-database.ts`; never create ad-hoc `pg.Pool` instances

### Testing Requirements
- Integration tests use a real test database; unit tests mock the pool
- Run `npm run test:bun` for fast unit tests; full DB integration tests via `npm test`
- Always test both success and DB error paths

### Common Patterns
- Query pattern: `const result = await pool.query('SELECT ... WHERE id = $1', [id])`
- Repository methods return typed objects or `null`, never raw `pg.QueryResult`
- Transaction pattern: `BEGIN` → operations → `COMMIT` / `ROLLBACK` in catch

## Dependencies
### Internal
- `models/unified-database.ts` — `pg.Pool` singleton
- `config/env.ts` — `DATABASE_URL`
- `utils/logger.ts` — Query error logging

### External
- `pg` 8.18.0 — PostgreSQL client
- `bcrypt` — Password hashing in `user-manager.ts`

<!-- MANUAL: -->
