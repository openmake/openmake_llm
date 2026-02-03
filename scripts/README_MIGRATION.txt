================================================================================
SQLite to PostgreSQL Migration Script
================================================================================

LOCATION: /Volumes/MAC_APP/openmake_llm/scripts/migrate-sqlite-to-pg.py

CREATED: 2026-02-02

================================================================================
QUICK START
================================================================================

1. Install psycopg2:
   pip install psycopg2-binary

2. Run migration:
   python3 scripts/migrate-sqlite-to-pg.py \
     --sqlite data/unified.db \
     --pg "postgresql://openmake:openmake_secret_2026@localhost:5432/openmake"

   OR with environment variable:
   export DATABASE_URL="postgresql://openmake:openmake_secret_2026@localhost:5432/openmake"
   python3 scripts/migrate-sqlite-to-pg.py

================================================================================
FEATURES
================================================================================

✓ Migrates all 20 tables with proper foreign key ordering
✓ Handles data type conversions:
  - SQLite INTEGER (0/1) → PostgreSQL BOOLEAN
  - SQLite DATETIME → PostgreSQL TIMESTAMPTZ
  - SQLite JSON strings → PostgreSQL JSONB
✓ Batch inserts with ON CONFLICT DO NOTHING (idempotent)
✓ Graceful error handling (skips bad rows, continues)
✓ Sequence reset after migration
✓ Progress reporting and summary statistics
✓ Handles missing tables (older DBs)

================================================================================
TABLES MIGRATED (20 total)
================================================================================

1. users                    - User accounts
2. conversation_sessions    - Chat sessions
3. custom_agents            - Custom AI agents
4. conversation_messages    - Chat messages
5. agent_usage_logs         - Agent usage tracking
6. agent_feedback           - User feedback
7. audit_logs               - Audit trail
8. alert_history            - Alert records
9. user_memories            - User memory storage
10. memory_tags             - Memory tags
11. research_sessions       - Research sessions
12. research_steps          - Research steps
13. agent_marketplace       - Marketplace listings
14. agent_reviews           - Marketplace reviews
15. agent_installations     - Agent installations
16. canvas_documents        - Canvas documents
17. canvas_versions         - Canvas versions
18. external_connections    - External connections
19. external_files          - External files
20. api_usage               - API usage stats

================================================================================
DATA TYPE CONVERSIONS
================================================================================

BOOLEAN (SQLite INTEGER → PostgreSQL BOOLEAN):
  - users.is_active
  - custom_agents.enabled
  - agent_marketplace.is_free, is_featured, is_verified
  - alert_history.acknowledged
  - agent_usage_logs.success
  - canvas_documents.is_shared
  - external_connections.is_active

JSON (SQLite TEXT → PostgreSQL JSONB):
  - conversation_sessions.metadata
  - api_usage.models
  - agent_feedback.tags
  - custom_agents.keywords
  - audit_logs.details
  - alert_history.data
  - agent_marketplace.tags
  - research_sessions.key_findings, sources
  - research_steps.sources
  - external_connections.metadata

DATETIME (SQLite TEXT → PostgreSQL TIMESTAMPTZ):
  - All created_at, updated_at, timestamp columns
  - users.last_login
  - alert_history.acknowledged_at
  - user_memories.last_accessed, expires_at
  - research_sessions.completed_at
  - agent_marketplace.published_at
  - external_connections.token_expires_at
  - external_files.last_synced

SERIAL (Auto-increment sequences reset):
  - conversation_messages.id
  - api_usage.id
  - agent_usage_logs.id
  - audit_logs.id
  - alert_history.id
  - memory_tags.id
  - research_steps.id
  - agent_installations.id
  - canvas_versions.id

================================================================================
REQUIREMENTS
================================================================================

Python 3.7+
sqlite3 (stdlib)
psycopg2 (install: pip install psycopg2-binary)

Source Database:
  - SQLite at /Volumes/MAC_APP/openmake_llm/data/unified.db

Target Database:
  - PostgreSQL with schema already created
  - Connection string via --pg argument or DATABASE_URL env var

================================================================================
USAGE EXAMPLES
================================================================================

# With CLI arguments
python3 scripts/migrate-sqlite-to-pg.py \
  --sqlite data/unified.db \
  --pg "postgresql://user:pass@localhost:5432/dbname"

# With environment variable
export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"
python3 scripts/migrate-sqlite-to-pg.py

# Custom SQLite path
python3 scripts/migrate-sqlite-to-pg.py \
  --sqlite /path/to/custom.db \
  --pg "postgresql://user:pass@localhost:5432/dbname"

# Help
python3 scripts/migrate-sqlite-to-pg.py --help

================================================================================
ERROR HANDLING
================================================================================

✓ Missing tables: Skipped with warning, migration continues
✓ Row-level errors: Skipped row, logs error, continues
✓ Connection errors: Clear error message, exits with code 1
✓ Idempotent: ON CONFLICT DO NOTHING prevents duplicates
✓ Safe to re-run: Can be executed multiple times

================================================================================
PERFORMANCE
================================================================================

- Batch inserts using executemany()
- Typical speed: 1000-5000 rows/second
- Memory: Loads all rows into memory (suitable for < 1GB databases)

================================================================================
DOCUMENTATION
================================================================================

See MIGRATION_GUIDE.md for detailed documentation including:
- Complete feature list
- Troubleshooting guide
- Performance tips
- Backup recommendations

================================================================================
