#!/usr/bin/env python3
"""
SQLite to PostgreSQL Data Migration Script

Migrates all data from SQLite database to PostgreSQL, handling:
- Data type conversions (INTEGER/BOOLEAN, DATETIME/TIMESTAMPTZ, JSON/JSONB)
- Foreign key ordering (parent tables first)
- Batch inserts with ON CONFLICT DO NOTHING for idempotency
- Sequence resets for SERIAL columns
- Error handling and progress reporting
"""

import sqlite3
import psycopg2
import psycopg2.extras
import argparse
import json
import os
import sys
from datetime import datetime
from typing import Dict, List, Tuple, Any, Optional

# Table migration order (respecting foreign key dependencies)
MIGRATION_ORDER = [
    "users",
    "conversation_sessions",
    "custom_agents",
    "conversation_messages",
    "agent_usage_logs",
    "agent_feedback",
    "audit_logs",
    "alert_history",
    "user_memories",
    "memory_tags",
    "research_sessions",
    "research_steps",
    "agent_marketplace",
    "agent_reviews",
    "agent_installations",
    "canvas_documents",
    "canvas_versions",
    "external_connections",
    "external_files",
    "api_usage",
]

# Column type mappings for data conversion
BOOLEAN_COLUMNS = {
    "users": ["is_active"],
    "custom_agents": ["enabled"],
    "agent_marketplace": ["is_free", "is_featured", "is_verified"],
    "alert_history": ["acknowledged"],
    "agent_usage_logs": ["success"],
    "canvas_documents": ["is_shared"],
    "external_connections": ["is_active"],
}

JSON_COLUMNS = {
    "conversation_sessions": ["metadata"],
    "api_usage": ["models"],
    "agent_feedback": ["tags"],
    "custom_agents": ["keywords"],
    "audit_logs": ["details"],
    "alert_history": ["data"],
    "agent_marketplace": ["tags"],
    "research_sessions": ["key_findings", "sources"],
    "research_steps": ["sources"],
    "external_connections": ["metadata"],
}

DATETIME_COLUMNS = {
    "users": ["created_at", "updated_at", "last_login"],
    "conversation_sessions": ["created_at", "updated_at"],
    "conversation_messages": ["created_at"],
    "api_usage": ["created_at", "updated_at"],
    "agent_usage_logs": ["timestamp"],
    "agent_feedback": ["created_at"],
    "custom_agents": ["created_at", "updated_at"],
    "audit_logs": ["timestamp"],
    "alert_history": ["created_at", "acknowledged_at"],
    "user_memories": ["last_accessed", "created_at", "updated_at", "expires_at"],
    "memory_tags": [],
    "research_sessions": ["created_at", "updated_at", "completed_at"],
    "research_steps": ["created_at"],
    "agent_marketplace": ["created_at", "updated_at", "published_at"],
    "agent_reviews": ["created_at"],
    "agent_installations": ["installed_at"],
    "canvas_documents": ["created_at", "updated_at"],
    "canvas_versions": ["created_at"],
    "external_connections": ["token_expires_at", "created_at", "updated_at"],
    "external_files": ["last_synced", "created_at"],
}

# SERIAL columns (INTEGER PRIMARY KEY AUTOINCREMENT in SQLite)
SERIAL_COLUMNS = {
    "conversation_messages": "id",
    "api_usage": "id",
    "agent_usage_logs": "id",
    "audit_logs": "id",
    "alert_history": "id",
    "memory_tags": "id",
    "research_steps": "id",
    "agent_installations": "id",
    "canvas_versions": "id",
}


class MigrationStats:
    """Track migration statistics"""

    def __init__(self):
        self.tables_migrated = 0
        self.total_rows = 0
        self.errors = []
        self.skipped_rows = {}

    def add_error(self, table: str, row_num: int, error: str):
        self.errors.append(f"  {table} row {row_num}: {error}")
        if table not in self.skipped_rows:
            self.skipped_rows[table] = 0
        self.skipped_rows[table] += 1

    def print_summary(self):
        print("\n" + "=" * 60)
        print("MIGRATION SUMMARY")
        print("=" * 60)
        print(f"Tables migrated: {self.tables_migrated}")
        print(f"Total rows migrated: {self.total_rows}")
        if self.errors:
            print(f"Errors encountered: {len(self.errors)}")
            print("\nError details:")
            for error in self.errors[:20]:  # Show first 20 errors
                print(error)
            if len(self.errors) > 20:
                print(f"  ... and {len(self.errors) - 20} more errors")
        if self.skipped_rows:
            print("\nSkipped rows by table:")
            for table, count in self.skipped_rows.items():
                print(f"  {table}: {count}")
        print("=" * 60)


def convert_boolean(value: Any) -> Optional[bool]:
    """Convert SQLite INTEGER (0/1) to PostgreSQL BOOLEAN"""
    if value is None:
        return None
    return bool(value)


def convert_json(value: Any) -> Optional[str]:
    """Convert SQLite JSON string to PostgreSQL JSONB (as JSON string)"""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            # Parse and re-serialize to ensure valid JSON
            parsed = json.loads(value)
            return json.dumps(parsed)
        except (json.JSONDecodeError, TypeError):
            # If not valid JSON, return as-is or None
            return None
    return json.dumps(value)


def convert_datetime(value: Any) -> Optional[str]:
    """Convert SQLite DATETIME string to PostgreSQL TIMESTAMPTZ"""
    if value is None:
        return None
    if isinstance(value, str):
        # SQLite datetime format: "2024-01-30 15:21:00"
        # PostgreSQL accepts this format directly
        return value
    return str(value)


def convert_value(table: str, column: str, value: Any) -> Any:
    """Convert a single value based on column type"""
    if value is None:
        return None

    # Check if it's a boolean column
    if table in BOOLEAN_COLUMNS and column in BOOLEAN_COLUMNS[table]:
        return convert_boolean(value)

    # Check if it's a JSON column
    if table in JSON_COLUMNS and column in JSON_COLUMNS[table]:
        return convert_json(value)

    # Check if it's a datetime column
    if table in DATETIME_COLUMNS and column in DATETIME_COLUMNS[table]:
        return convert_datetime(value)

    return value


def get_table_columns(sqlite_conn: sqlite3.Connection, table: str) -> List[str]:
    """Get column names for a table from SQLite"""
    cursor = sqlite_conn.cursor()
    cursor.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in cursor.fetchall()]
    cursor.close()
    return columns


def migrate_table(
    sqlite_conn: sqlite3.Connection,
    pg_conn: psycopg2.extensions.connection,
    table: str,
    stats: MigrationStats,
) -> int:
    """Migrate a single table from SQLite to PostgreSQL"""
    try:
        # Get columns
        columns = get_table_columns(sqlite_conn, table)
        if not columns:
            print(f"  ⚠️  Table '{table}' not found in SQLite, skipping")
            return 0

        # Fetch all rows from SQLite
        sqlite_cursor = sqlite_conn.cursor()
        sqlite_cursor.execute(f"SELECT * FROM {table}")
        rows = sqlite_cursor.fetchall()
        sqlite_cursor.close()

        if not rows:
            print(f"  ✓ {table}: 0 rows")
            return 0

        # Convert rows
        converted_rows = []
        for row_num, row in enumerate(rows, 1):
            try:
                converted_row = []
                for col_idx, value in enumerate(row):
                    col_name = columns[col_idx]
                    converted_value = convert_value(table, col_name, value)
                    converted_row.append(converted_value)
                converted_rows.append(tuple(converted_row))
            except Exception as e:
                stats.add_error(table, row_num, str(e))
                continue

        if not converted_rows:
            print(f"  ✓ {table}: 0 rows (all skipped due to errors)")
            return 0

        # Build INSERT statement with ON CONFLICT DO NOTHING
        placeholders = ",".join(["%s"] * len(columns))
        col_list = ",".join(columns)
        insert_sql = f"""
            INSERT INTO {table} ({col_list})
            VALUES ({placeholders})
            ON CONFLICT DO NOTHING
        """

        # Batch insert
        pg_cursor = pg_conn.cursor()
        try:
            pg_cursor.executemany(insert_sql, converted_rows)
            pg_conn.commit()
            rows_inserted = pg_cursor.rowcount
            print(f"  ✓ {table}: {rows_inserted} rows migrated")
            stats.total_rows += rows_inserted
            return rows_inserted
        except Exception as e:
            pg_conn.rollback()
            stats.add_error(table, 0, f"Batch insert failed: {str(e)}")
            print(f"  ✗ {table}: Batch insert failed - {str(e)}")
            return 0
        finally:
            pg_cursor.close()

    except Exception as e:
        stats.add_error(table, 0, f"Table migration failed: {str(e)}")
        print(f"  ✗ {table}: {str(e)}")
        return 0


def reset_sequences(pg_conn: psycopg2.extensions.connection):
    """Reset PostgreSQL sequences after migration"""
    print("\nResetting sequences...")
    pg_cursor = pg_conn.cursor()

    for table, col in SERIAL_COLUMNS.items():
        try:
            # Get the sequence name (PostgreSQL convention: tablename_columnname_seq)
            seq_name = f"{table}_{col}_seq"
            # Get max value from table
            pg_cursor.execute(f"SELECT MAX({col}) FROM {table}")
            max_val = pg_cursor.fetchone()[0]
            if max_val:
                pg_cursor.execute(f"SELECT setval('{seq_name}', {max_val})")
                pg_conn.commit()
                print(f"  ✓ Reset {seq_name} to {max_val}")
        except Exception as e:
            print(f"  ⚠️  Could not reset {seq_name}: {str(e)}")

    pg_cursor.close()


def main():
    parser = argparse.ArgumentParser(
        description="Migrate data from SQLite to PostgreSQL"
    )
    parser.add_argument(
        "--sqlite",
        default=None,
        help="Path to SQLite database file (default: data/unified.db)",
    )
    parser.add_argument(
        "--pg",
        default=None,
        help="PostgreSQL connection string (default: DATABASE_URL env var)",
    )

    args = parser.parse_args()

    # Determine SQLite path
    sqlite_path = args.sqlite
    if not sqlite_path:
        # Try to find in data directory
        data_dir = "/Volumes/MAC_APP/openmake_llm/data"
        if os.path.exists(os.path.join(data_dir, "unified.db")):
            sqlite_path = os.path.join(data_dir, "unified.db")
        else:
            print("Error: SQLite database not found. Specify with --sqlite")
            sys.exit(1)

    # Determine PostgreSQL connection string
    pg_url = args.pg or os.getenv("DATABASE_URL")
    if not pg_url:
        print("Error: PostgreSQL connection string not provided.")
        print("Use --pg argument or set DATABASE_URL environment variable")
        sys.exit(1)

    # Verify SQLite file exists
    if not os.path.exists(sqlite_path):
        print(f"Error: SQLite database not found at {sqlite_path}")
        sys.exit(1)

    print("=" * 60)
    print("SQLite to PostgreSQL Migration")
    print("=" * 60)
    print(f"Source: {sqlite_path}")
    print(
        f"Target: {pg_url.split('@')[0]}@{pg_url.split('@')[1] if '@' in pg_url else 'unknown'}"
    )
    print()

    # Connect to databases
    try:
        sqlite_conn = sqlite3.connect(sqlite_path)
        sqlite_conn.row_factory = sqlite3.Row
        print("✓ Connected to SQLite")
    except Exception as e:
        print(f"✗ Failed to connect to SQLite: {e}")
        sys.exit(1)

    try:
        pg_conn = psycopg2.connect(pg_url)
        print("✓ Connected to PostgreSQL")
    except Exception as e:
        print(f"✗ Failed to connect to PostgreSQL: {e}")
        sqlite_conn.close()
        sys.exit(1)

    # Migrate tables
    stats = MigrationStats()

    # Disable FK checks during migration to handle inconsistent references
    pg_cursor = pg_conn.cursor()
    pg_cursor.execute("SET session_replication_role = 'replica'")
    pg_conn.commit()
    pg_cursor.close()
    print("✓ FK checks disabled for migration session")

    print("\nMigrating tables...")
    print("-" * 60)

    for table in MIGRATION_ORDER:
        migrate_table(sqlite_conn, pg_conn, table, stats)
        stats.tables_migrated += 1

    # Reset sequences
    reset_sequences(pg_conn)

    # Re-enable FK checks
    pg_cursor = pg_conn.cursor()
    pg_cursor.execute("SET session_replication_role = 'origin'")
    pg_conn.commit()
    pg_cursor.close()
    print("✓ FK checks re-enabled")

    # Cleanup
    sqlite_conn.close()
    pg_conn.close()

    # Print summary
    stats.print_summary()

    if stats.errors:
        sys.exit(1)
    else:
        print("\n✓ Migration completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
