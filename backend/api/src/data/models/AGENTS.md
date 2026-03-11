<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# models — Database Connection and Token Blacklist

## Purpose
Provides the `pg.Pool` singleton (`unified-database.ts`) that all repositories and direct DB callers share, and the token blacklist model (`token-blacklist.ts`) used for JWT revocation. `unified-database.ts` configures pool size, idle timeout, and connection string from `config/env.ts`. The token blacklist provides in-memory and DB-backed storage for revoked JWT IDs.

## Key Files
| File | Description |
|------|-------------|
| `unified-database.ts` | Singleton `pg.Pool` creation with connection config; exports `getPool()` |
| `token-blacklist.ts` | JWT revocation store: add token JTI to blacklist, check if token is revoked |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- `getPool()` must be called after the app bootstrap is complete — never at module load time in tests
- Pool configuration (max connections, idle timeout) is set here; do not override per-query
- `token-blacklist.ts` uses a hybrid approach: in-memory Set for performance, DB for persistence across restarts
- Do not add domain-specific query logic here; this layer is infrastructure only

### Testing Requirements
- Mock `getPool()` in unit tests rather than creating real connections
- Token blacklist tests must verify both add and check operations, and the DB persistence path

### Common Patterns
- `const pool = getPool()` — always call the getter, never import the pool instance directly
- Token blacklist check should happen in `auth/middleware.ts`, not in controllers

## Dependencies
### Internal
- `config/env.ts` — `DATABASE_URL`, pool size settings

### External
- `pg` — `Pool` class

<!-- MANUAL: -->
