<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# services/database

## Purpose
PostgreSQL schema definitions and incremental migrations for the OpenMake LLM platform. The `init/` directory contains the canonical schema applied on fresh installs; the `migrations/` directory contains numbered incremental SQL files applied in order to upgrade existing deployments. The `002-schema.sql` file is the single source of truth for the database structure.

## Key Files
| File | Description |
|------|-------------|
| `init/001-extensions.sql` | Installs PostgreSQL extensions required by the platform, including `pgvector` for embedding storage and similarity search. |
| `init/002-schema.sql` | Canonical schema source of truth. Defines all tables, indexes, and constraints for a fresh install. |
| `init/003-seed.sql` | Default seed data including the initial admin user account. |
| `migrations/000_migration_versions.sql` | Creates the `migration_versions` tracking table used by the migration runner. |
| `migrations/001_baseline.sql` | Baseline migration capturing the initial schema state for deployments upgrading from pre-migration versions. |
| `migrations/002_vector_type_migration.sql` | Migrates vector columns to use the `pgvector` `vector` type with correct dimensions. |
| `migrations/003_hybrid_search_fts.sql` | Adds full-text search (FTS) columns and indexes to support hybrid semantic + keyword retrieval. |
| `migrations/004_hnsw_index.sql` | Adds HNSW approximate nearest-neighbor indexes on embedding columns for faster vector search. |
| `migrations/005_kb_nm_schema.sql` | Knowledge base and network memory schema additions. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `init/` | Fresh install schemas applied in numbered order on first launch |
| `migrations/` | Incremental upgrade scripts applied in numbered order by `scripts/run-migrations.ts` |

## For AI Agents
### Working In This Directory
- `init/002-schema.sql` is the **single source of truth** — any structural change must be reflected here AND in a new numbered migration file.
- Migration files are append-only. Never modify an existing migration that has already been applied to production.
- New migrations must be numbered sequentially (e.g., `006_description.sql`) and registered in `scripts/run-migrations.ts`.
- Run `bash scripts/check-schema-drift.sh` after any schema change to confirm init and migration files are consistent.

### Testing Requirements
- Test migrations against a local PostgreSQL instance: `DATABASE_URL=postgres://... bun run scripts/run-migrations.ts`
- Verify idempotency where possible — use `IF NOT EXISTS` and `IF EXISTS` guards.

### Common Patterns
- Extensions are isolated in `001-extensions.sql` so they can be skipped on managed databases where extensions are pre-installed.
- All vector columns use `vector(N)` type from pgvector with explicit dimension counts.
- FTS columns use `tsvector` with `GIN` indexes; HNSW indexes use `vector_cosine_ops` or `vector_l2_ops`.

## Dependencies
### Internal
- `scripts/run-migrations.ts` — migration runner that reads and applies files from `migrations/`
- `backend/api/src/data/` — application code that connects to the schema defined here

### External
- PostgreSQL 15+ with `pgvector` extension
- `pg` npm package (used by migration runner and application)

<!-- MANUAL: -->
