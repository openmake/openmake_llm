# Migration Scripts Index

## SQLite to PostgreSQL Migration

### Main Script
- **File:** `migrate-sqlite-to-pg.py`
- **Purpose:** Migrate all data from SQLite to PostgreSQL
- **Status:** ✅ Production-ready
- **Lines:** 394
- **Size:** 12.4 KB

### Documentation

#### 1. MIGRATION_GUIDE.md
Comprehensive guide with:
- Feature overview
- Prerequisites and installation
- Usage examples
- Table descriptions
- Data type conversion details
- Error handling strategies
- Performance tips
- Troubleshooting guide
- Backup recommendations

#### 2. README_MIGRATION.txt
Quick reference with:
- Quick start instructions
- Feature summary
- Table list
- Data conversion summary
- Requirements
- Usage examples
- Error handling overview
- Performance notes

#### 3. ../MIGRATION_COMPLETE.md
Complete project summary with:
- Deliverables overview
- Requirements checklist
- Technical details
- Quality assurance verification
- Next steps

## Quick Start

```bash
# Install dependencies
pip install psycopg2-binary

# Run migration
python3 scripts/migrate-sqlite-to-pg.py \
  --sqlite data/unified.db \
  --pg "postgresql://user:pass@host:5432/dbname"
```

## Features

✅ Migrates all 20 tables  
✅ Proper foreign key ordering  
✅ Data type conversions (BOOLEAN, DATETIME, JSON)  
✅ Batch inserts with idempotency  
✅ Graceful error handling  
✅ Sequence reset  
✅ Progress reporting  
✅ No ORM/SQLAlchemy  

## Tables Migrated

1. users
2. conversation_sessions
3. custom_agents
4. conversation_messages
5. agent_usage_logs
6. agent_feedback
7. audit_logs
8. alert_history
9. user_memories
10. memory_tags
11. research_sessions
12. research_steps
13. agent_marketplace
14. agent_reviews
15. agent_installations
16. canvas_documents
17. canvas_versions
18. external_connections
19. external_files
20. api_usage

## Data Conversions

- SQLite INTEGER (0/1) → PostgreSQL BOOLEAN
- SQLite DATETIME → PostgreSQL TIMESTAMPTZ
- SQLite JSON strings → PostgreSQL JSONB
- SQLite TEXT PRIMARY KEY → PostgreSQL TEXT PRIMARY KEY
- SQLite INTEGER PRIMARY KEY AUTOINCREMENT → PostgreSQL SERIAL

## Support

For detailed information, see:
- MIGRATION_GUIDE.md - Comprehensive guide
- README_MIGRATION.txt - Quick reference
- ../MIGRATION_COMPLETE.md - Project summary
