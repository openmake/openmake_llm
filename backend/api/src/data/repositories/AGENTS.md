<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# repositories — Typed Domain Repositories

## Purpose
Provides 13 typed repository classes, each responsible for all SQL operations on a single domain table or closely related table group. Repositories encapsulate parameterized queries, map raw `pg.QueryResult` rows to typed domain objects, and expose a clean interface to service and controller layers. No business logic lives here — only data access.

## Key Files
| File | Description |
|------|-------------|
| `api-key.repository.ts` | API key storage: create, validate hash, list, revoke |
| `audit.repository.ts` | Audit log write and paginated read |
| `conversation.repository.ts` | Conversation and message CRUD |
| `feedback.repository.ts` | User feedback on responses |
| `kb.repository.ts` | Knowledge base document metadata |
| `memory.repository.ts` | Long-term memory entries per user |
| `research.repository.ts` | Deep research session storage |
| `skill.repository.ts` | Agent skill definitions and assignments |
| `user.repository.ts` | User profile CRUD |
| `vector.repository.ts` | Vector embedding storage and cosine similarity queries |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Each repository receives the `pg.Pool` instance via constructor injection — never import the pool directly
- All public methods must be `async` and return typed results, never raw `QueryResult`
- Use parameterized queries exclusively: `pool.query(sql, [param1, param2])`
- Vector repository uses PostgreSQL `pgvector` extension for cosine similarity; ensure the extension is enabled in migrations

### Testing Requirements
- Unit tests mock `pg.Pool` to avoid real DB calls
- Integration tests run against the test database with isolated transactions (rolled back after each test)
- Run `npm run test:bun`

### Common Patterns
- Repository constructor: `constructor(private pool: Pool) {}`
- Row mapping: private `mapRow(row: any): DomainType` method for type safety
- Not-found returns `null`, not an empty array (for single-item lookups)

## Dependencies
### Internal
- `data/models/unified-database.ts` — Pool instance passed at construction time
- `types/api.ts` — Shared domain type definitions

### External
- `pg` — `Pool`, `QueryResult` types

<!-- MANUAL: -->
