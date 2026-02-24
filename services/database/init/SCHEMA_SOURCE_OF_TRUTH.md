# Database Schema Source-of-Truth Policy

- Canonical schema: `services/database/init/002-schema.sql`
- Fallback schema: `backend/api/src/data/models/unified-database.ts` (`LEGACY_SCHEMA`)

## Rules

1. All schema evolution starts in `002-schema.sql`.
2. `LEGACY_SCHEMA` must stay aligned with core `CREATE TABLE IF NOT EXISTS` definitions and essential lookup indexes.
3. `LEGACY_SCHEMA` is fallback-only and must not include migration-only `DO $$` blocks.
4. `LEGACY_SCHEMA` may omit optional extension/performance blocks (for example pgvector ivfflat, pg_trgm, and Phase 2-DBA optimization indexes).
5. If a table is tagged as `[P3 LEGACY]` or `[P3 UNUSED]` in SQL comments, the same tag must be mirrored in `LEGACY_SCHEMA` comments.

## Drift Prevention Checklist

- After changing `002-schema.sql`, compare table definitions and essential indexes in `LEGACY_SCHEMA`.
- Keep `getSchemaSQL()` behavior unchanged: read SQL file first, fallback to `LEGACY_SCHEMA`.
- Run `cd backend/api && npx tsc --noEmit` and `npm test` from repo root.
- Run `npm run check:schema-drift` to detect table/index drift automatically.

## Automated Drift Detection

```bash
# Run from project root
npm run check:schema-drift
# Or directly
bash scripts/check-schema-drift.sh
```

The script compares CREATE TABLE and core INDEX definitions between `002-schema.sql` and `LEGACY_SCHEMA`.
- `vector_embeddings`: Created dynamically in `DO $$` block (pgvector presence check) — expected to appear as "extra" in LEGACY_SCHEMA.
- Performance/optimization indexes (Phase 2-DBA): Intentionally omitted from LEGACY_SCHEMA per Rule 4.

## Table Status Tags

| Tag | Meaning |
|-----|---------|
| `[P3 LEGACY]` | Superseded table kept for backward compatibility. Will be removed in future. |
| `[P3 UNUSED]` | Table exists in schema but not actively used by code. Future activation planned. |

### Current Tagged Tables

| Table | Tag | Note |
|-------|-----|------|
| `push_subscriptions` | `[P3 LEGACY]` | Replaced by `push_subscriptions_store`. DELETE-only usage for cascade cleanup. |
| `token_daily_stats` | `[P3 UNUSED]` | ApiUsageTracker runs in-memory. DB write-through planned for future. |
