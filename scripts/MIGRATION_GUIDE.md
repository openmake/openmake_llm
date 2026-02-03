# SQLite to PostgreSQL Migration Guide

## Overview

The `migrate-sqlite-to-pg.py` script migrates all data from the SQLite database (`data/unified.db`) to PostgreSQL, handling data type conversions, foreign key ordering, and idempotent inserts.

## Features

✅ **Complete Data Migration**
- Migrates all 20 tables with proper foreign key ordering
- Parent tables migrated first (users → sessions → messages)
- Marketplace tables after custom_agents
- Canvas tables after conversation_sessions
- External tables after users

✅ **Data Type Conversions**
- SQLite INTEGER (0/1) → PostgreSQL BOOLEAN (TRUE/FALSE)
- SQLite DATETIME strings → PostgreSQL TIMESTAMPTZ
- SQLite JSON strings → PostgreSQL JSONB (parsed and re-serialized)
- SQLite TEXT PRIMARY KEY → PostgreSQL TEXT PRIMARY KEY
- SQLite INTEGER PRIMARY KEY AUTOINCREMENT → PostgreSQL SERIAL

✅ **Robust Error Handling**
- Batch inserts with `ON CONFLICT DO NOTHING` for idempotency
- Graceful handling of missing tables (older DBs may not have all tables)
- Per-row error tracking and reporting
- Sequence reset after migration

✅ **Progress Reporting**
- Real-time migration status for each table
- Summary statistics at end
- Error details with row numbers

## Prerequisites

### Python Packages
```bash
pip install psycopg2-binary
```

### Database Requirements
- **Source**: SQLite database at `/Volumes/MAC_APP/openmake_llm/data/unified.db`
- **Target**: PostgreSQL database with schema already created

## Usage

### Basic Usage (with environment variable)
```bash
export DATABASE_URL="postgresql://openmake:your_password_here@localhost:5432/openmake"
python3 scripts/migrate-sqlite-to-pg.py
```

### With CLI Arguments
```bash
python3 scripts/migrate-sqlite-to-pg.py \
  --sqlite data/unified.db \
  --pg "postgresql://openmake:your_password_here@localhost:5432/openmake"
```

### Custom SQLite Path
```bash
python3 scripts/migrate-sqlite-to-pg.py \
  --sqlite /path/to/custom.db \
  --pg "postgresql://user:pass@host:5432/dbname"
```

## Tables Migrated

The script migrates data from these 20 tables in dependency order:

1. **users** - User accounts and authentication
2. **conversation_sessions** - Chat session metadata
3. **custom_agents** - Custom AI agent definitions
4. **conversation_messages** - Chat messages (depends on sessions)
5. **agent_usage_logs** - Agent usage tracking
6. **agent_feedback** - User feedback on agents
7. **audit_logs** - System audit trail
8. **alert_history** - Alert records
9. **user_memories** - User memory/context storage
10. **memory_tags** - Tags for memories
11. **research_sessions** - Research session metadata
12. **research_steps** - Individual research steps
13. **agent_marketplace** - Marketplace listings
14. **agent_reviews** - Marketplace reviews
15. **agent_installations** - User agent installations
16. **canvas_documents** - Canvas document metadata
17. **canvas_versions** - Canvas version history
18. **external_connections** - External service connections
19. **external_files** - External file references
20. **api_usage** - API usage statistics

## Data Type Conversions

### Boolean Columns
Converted from SQLite INTEGER (0/1) to PostgreSQL BOOLEAN:
- `users.is_active`
- `custom_agents.enabled`
- `agent_marketplace.is_free`, `is_featured`, `is_verified`
- `alert_history.acknowledged`
- `agent_usage_logs.success`
- `canvas_documents.is_shared`
- `external_connections.is_active`

### JSON Columns
Converted from SQLite TEXT to PostgreSQL JSONB:
- `conversation_sessions.metadata`
- `api_usage.models`
- `agent_feedback.tags`
- `custom_agents.keywords`
- `audit_logs.details`
- `alert_history.data`
- `agent_marketplace.tags`
- `research_sessions.key_findings`, `sources`
- `research_steps.sources`
- `external_connections.metadata`

### DateTime Columns
Converted from SQLite DATETIME strings to PostgreSQL TIMESTAMPTZ:
- All `created_at`, `updated_at`, `timestamp` columns
- `users.last_login`
- `alert_history.acknowledged_at`
- `user_memories.last_accessed`, `expires_at`
- `research_sessions.completed_at`
- `agent_marketplace.published_at`
- `external_connections.token_expires_at`
- `external_files.last_synced`
- `canvas_documents.created_at`, `updated_at`

### SERIAL Columns
Auto-increment columns reset after migration:
- `conversation_messages.id`
- `api_usage.id`
- `agent_usage_logs.id`
- `audit_logs.id`
- `alert_history.id`
- `memory_tags.id`
- `research_steps.id`
- `agent_installations.id`
- `canvas_versions.id`

## Output Example

```
============================================================
SQLite to PostgreSQL Migration
============================================================
Source: /Volumes/MAC_APP/openmake_llm/data/unified.db
Target: postgresql://openmake@localhost:5432/openmake

✓ Connected to SQLite
✓ Connected to PostgreSQL

Migrating tables...
------------------------------------------------------------
  ✓ users: 5 rows migrated
  ✓ conversation_sessions: 12 rows migrated
  ✓ custom_agents: 8 rows migrated
  ✓ conversation_messages: 342 rows migrated
  ✓ agent_usage_logs: 156 rows migrated
  ✓ agent_feedback: 23 rows migrated
  ✓ audit_logs: 89 rows migrated
  ✓ alert_history: 0 rows
  ✓ user_memories: 45 rows migrated
  ✓ memory_tags: 67 rows migrated
  ✓ research_sessions: 3 rows migrated
  ✓ research_steps: 12 rows migrated
  ✓ agent_marketplace: 2 rows migrated
  ✓ agent_reviews: 1 rows migrated
  ✓ agent_installations: 2 rows migrated
  ✓ canvas_documents: 8 rows migrated
  ✓ canvas_versions: 15 rows migrated
  ✓ external_connections: 0 rows
  ✓ external_files: 0 rows
  ✓ api_usage: 30 rows migrated

Resetting sequences...
  ✓ Reset conversation_messages_id_seq to 342
  ✓ Reset api_usage_id_seq to 30
  ✓ Reset agent_usage_logs_id_seq to 156
  ✓ Reset audit_logs_id_seq to 89
  ✓ Reset alert_history_id_seq to 0
  ✓ Reset memory_tags_id_seq to 67
  ✓ Reset research_steps_id_seq to 12
  ✓ Reset agent_installations_id_seq to 2
  ✓ Reset canvas_versions_id_seq to 15

============================================================
MIGRATION SUMMARY
============================================================
Tables migrated: 20
Total rows migrated: 820
Errors encountered: 0
============================================================

✓ Migration completed successfully!
```

## Error Handling

### Missing Tables
If a table doesn't exist in the SQLite database (common in older versions), the script will:
- Skip the table with a warning: `⚠️  Table 'X' not found in SQLite, skipping`
- Continue with the next table
- Not fail the migration

### Row-Level Errors
If individual rows fail to convert or insert:
- The row is skipped
- Error is logged with table name and row number
- Migration continues with remaining rows
- Error summary is printed at the end

### Connection Errors
If database connections fail:
- Clear error message is printed
- Script exits with status code 1
- No partial data is committed

## Idempotency

The script uses `ON CONFLICT DO NOTHING` for all inserts, making it safe to run multiple times:
- Duplicate rows are silently ignored
- Existing data is not overwritten
- Safe to re-run if migration is interrupted

## Troubleshooting

### "ModuleNotFoundError: No module named 'psycopg2'"
Install the required package:
```bash
pip install psycopg2-binary
```

### "Failed to connect to PostgreSQL"
Check:
- PostgreSQL server is running
- Connection string is correct
- Database exists
- User has permissions

### "Failed to connect to SQLite"
Check:
- SQLite file exists at specified path
- File is readable
- Path is correct

### "Batch insert failed"
Check:
- PostgreSQL schema matches expected structure
- All required columns exist
- Column types are compatible

## Performance

- **Batch inserts**: Uses `executemany()` for efficient bulk inserts
- **Typical speed**: ~1000-5000 rows/second depending on row size
- **Memory**: Loads all rows into memory (suitable for databases < 1GB)

## Backup Recommendations

Before running migration:
1. Backup PostgreSQL database
2. Backup SQLite database
3. Test on a staging environment first

## Support

For issues or questions:
1. Check error messages in migration output
2. Verify database connections
3. Ensure PostgreSQL schema is created
4. Check file permissions on SQLite database
