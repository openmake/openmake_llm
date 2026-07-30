#!/usr/bin/env bash
# ============================================================
# 테스트 전용 DB 부트스트랩
# ============================================================
#
# jest 는 기본적으로 DATABASE_URL 을 제거해 DB 의존 테스트를 스킵한다(apps/api/jest.setup.ts).
# CI 와 동일한 동작이라 운영 DB 가 오염되지 않지만, 로컬에서 DB 통합 테스트까지 돌리려면
# 전용 DB 가 필요하다. 이 스크립트가 그 DB 를 만든다.
#
#   ./scripts/setup-test-db.sh                 # openmake_llm_test 생성/초기화
#   TEST_DB_NAME=my_test ./scripts/setup-test-db.sh
#
# 이후:
#   TEST_DATABASE_URL="postgresql://.../openmake_llm_test" npm test
#
# ⚠️ TEST_DATABASE_URL 에 운영 DB 를 넣지 말 것 — 스키마 초기화가 그대로 적용된다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DB_NAME="${TEST_DB_NAME:-openmake_llm_test}"
PG_CONTAINER="${PG_CONTAINER:-openmake-postgres}"
PG_USER="${PG_USER:-openmake}"

if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    echo "❌ .env 없음: $SCRIPT_DIR/.env" >&2
    exit 1
fi

# 운영 DATABASE_URL 에서 접속 정보만 빌리고 DB 이름만 교체한다.
TEST_URL="$(cd "$SCRIPT_DIR" && TEST_DB_NAME="$TEST_DB_NAME" node -e "
const u = new URL(require('dotenv').config({ quiet: true }).parsed.DATABASE_URL);
u.pathname = '/' + process.env.TEST_DB_NAME;
console.log(u.toString());
")"

echo "▶ 대상: $TEST_DB_NAME"

# 1) DB 생성 (있으면 그대로 둔다 — 재실행 안전)
if docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$TEST_DB_NAME'" | grep -q 1; then
    echo "  DB 이미 존재 — 재사용"
else
    docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -q -c "CREATE DATABASE $TEST_DB_NAME"
    echo "  DB 생성 완료"
fi

# 2) baseline 스키마 (CREATE TABLE IF NOT EXISTS 라 재실행 안전)
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$TEST_DB_NAME" -q \
    < "$SCRIPT_DIR/db/init/002-schema.sql"
echo "  baseline 스키마 적재 완료"

# 3) 증분 마이그레이션
( cd "$SCRIPT_DIR/apps/api" && DATABASE_URL="$TEST_URL" npx ts-node src/data/migrations/cli.ts migrate )
echo "  마이그레이션 적용 완료"

echo ""
echo "✅ 준비 완료. 아래처럼 실행하세요:"
echo "   TEST_DATABASE_URL=\"$TEST_URL\" npm test"
