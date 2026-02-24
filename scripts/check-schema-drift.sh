#!/usr/bin/env bash
# ==============================================================
# Schema Drift Detector
# ==============================================================
# 002-schema.sql (source of truth) ↔ LEGACY_SCHEMA (fallback) 동기화 검사
#
# 사용법:
#   bash scripts/check-schema-drift.sh
#   npm run check:schema-drift  (package.json 등록 시)
#
# 종료 코드:
#   0 — 동기화 상태 양호
#   1 — drift 감지됨 (테이블 누락 등)
# ==============================================================

set -euo pipefail

SCHEMA_FILE="services/database/init/002-schema.sql"
LEGACY_FILE="backend/api/src/data/models/unified-database.ts"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "❌ Schema file not found: $SCHEMA_FILE"
  exit 1
fi

if [[ ! -f "$LEGACY_FILE" ]]; then
  echo "❌ Legacy schema file not found: $LEGACY_FILE"
  exit 1
fi

echo "🔍 Checking schema drift between:"
echo "   Source of Truth : $SCHEMA_FILE"
echo "   Fallback Schema : $LEGACY_FILE (LEGACY_SCHEMA)"
echo ""

# Extract CREATE TABLE names (macOS-compatible: sed + awk instead of grep -P)
extract_tables() {
  grep 'CREATE TABLE IF NOT EXISTS' "$1" \
    | sed 's/.*CREATE TABLE IF NOT EXISTS[[:space:]]*//' \
    | awk '{print $1}' \
    | sed 's/[^a-zA-Z0-9_]//g' \
    | sort -u
}

# Extract index names
extract_indexes() {
  grep 'INDEX IF NOT EXISTS' "$1" 2>/dev/null \
    | sed 's/.*INDEX IF NOT EXISTS[[:space:]]*//' \
    | awk '{print $1}' \
    | sed 's/[^a-zA-Z0-9_]//g' \
    | sort -u
}

SCHEMA_TABLES=$(extract_tables "$SCHEMA_FILE")
LEGACY_TABLES=$(extract_tables "$LEGACY_FILE")

# Compare
MISSING_IN_LEGACY=$(comm -23 <(echo "$SCHEMA_TABLES") <(echo "$LEGACY_TABLES"))
EXTRA_IN_LEGACY=$(comm -13 <(echo "$SCHEMA_TABLES") <(echo "$LEGACY_TABLES"))

DRIFT_FOUND=0

if [[ -n "$MISSING_IN_LEGACY" ]]; then
  echo "⚠️  Tables in 002-schema.sql but MISSING in LEGACY_SCHEMA:"
  echo "$MISSING_IN_LEGACY" | sed 's/^/   - /'
  echo ""
  DRIFT_FOUND=1
fi

if [[ -n "$EXTRA_IN_LEGACY" ]]; then
  echo "⚠️  Tables in LEGACY_SCHEMA but NOT in 002-schema.sql:"
  echo "$EXTRA_IN_LEGACY" | sed 's/^/   - /'
  echo ""
  DRIFT_FOUND=1
fi

# Check essential index coverage (core indexes only)
SCHEMA_INDEXES=$(extract_indexes "$SCHEMA_FILE")
LEGACY_INDEXES=$(extract_indexes "$LEGACY_FILE")

# Core indexes that MUST exist in LEGACY_SCHEMA (essential for query performance)
CORE_INDEXES=(
  "idx_messages_session"
  "idx_messages_created"
  "idx_usage_date"
  "idx_users_username"
  "idx_users_email"
  "idx_sessions_user"
  "idx_sessions_anon"
  "idx_blacklist_expires"
  "idx_chat_rate_limits_user_key"
  "idx_feedback_message"
  "idx_feedback_session"
)

MISSING_CORE_INDEXES=""
for idx in "${CORE_INDEXES[@]}"; do
  if ! echo "$LEGACY_INDEXES" | grep -q "^${idx}$"; then
    MISSING_CORE_INDEXES="${MISSING_CORE_INDEXES}   - ${idx}\n"
  fi
done

if [[ -n "$MISSING_CORE_INDEXES" ]]; then
  echo "⚠️  Core indexes MISSING in LEGACY_SCHEMA:"
  printf "%b" "$MISSING_CORE_INDEXES"
  echo ""
  DRIFT_FOUND=1
fi

# Summary
SCHEMA_COUNT=$(echo "$SCHEMA_TABLES" | wc -l | tr -d ' ')
LEGACY_COUNT=$(echo "$LEGACY_TABLES" | wc -l | tr -d ' ')
SCHEMA_IDX_COUNT=$(echo "$SCHEMA_INDEXES" | wc -l | tr -d ' ')
LEGACY_IDX_COUNT=$(echo "$LEGACY_INDEXES" | wc -l | tr -d ' ')

echo "📊 Summary:"
echo "   002-schema.sql  : ${SCHEMA_COUNT} tables, ${SCHEMA_IDX_COUNT} indexes"
echo "   LEGACY_SCHEMA   : ${LEGACY_COUNT} tables, ${LEGACY_IDX_COUNT} indexes"
echo "   (LEGACY_SCHEMA intentionally omits optional/performance indexes)"
echo ""

if [[ $DRIFT_FOUND -eq 0 ]]; then
  echo "✅ No critical drift detected. LEGACY_SCHEMA is aligned with core tables."
  exit 0
else
  echo "❌ Schema drift detected! Please update LEGACY_SCHEMA in:"
  echo "   $LEGACY_FILE"
  echo ""
  echo "   Reference: services/database/init/SCHEMA_SOURCE_OF_TRUTH.md"
  exit 1
fi
