#!/usr/bin/env bash
# ============================================================
# 테스트 전용 DB 부트스트랩
# ============================================================
#
# jest 는 기본적으로 DATABASE_URL 을 제거해 DB 의존 테스트를 스킵한다(apps/api/jest.setup.ts).
# DB 통합 테스트(*.db.test.ts)는 전용 DB 에서만 돈다. 이 스크립트가 그 DB 를 준비한다:
#   baseline 스키마(002-schema) → 코어 마이그레이션(db/migrations) → 내장 add-on 마이그레이션(addon:<id>:NNN)
#
# 두 가지 방식:
#   1) TEST_DATABASE_URL 이 있으면 그 DB 에 바로 적용한다(CI 의 PostgreSQL 서비스·로컬 일회용 컨테이너).
#      DB 는 이미 있어야 하고 psql·docker·.env 가 필요 없다(baseline 은 마이그레이션 CLI 의 스키마 준비가 만든다).
#        TEST_DATABASE_URL="postgresql://openmake:openmake_test@localhost:5433/openmake_llm_test" ./scripts/setup-test-db.sh
#   2) 없으면 로컬 docker 컨테이너(PG_CONTAINER)에 TEST_DB_NAME 을 만들고, 접속 정보는 .env 의 DATABASE_URL 에서 빌린다.
#        ./scripts/setup-test-db.sh                 # openmake_llm_test 생성/초기화
#        TEST_DB_NAME=my_test ./scripts/setup-test-db.sh
# 어느 쪽이든 DB 이름은 _test 로 끝나야 한다(운영 DB 오적용 방지).
#
# 이후:
#   TEST_DATABASE_URL="<위 URL>" npm run test:db     # *.db.test.ts 만, 끝에 "db tests ran: N"
#
# ⚠️ TEST_DATABASE_URL 에 운영 DB 를 넣지 말 것 — 스키마 초기화가 그대로 적용된다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SCRIPT_DIR/scripts/lib/colima.sh"
openmake_select_docker

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
    MODE="url"
    TEST_URL="$TEST_DATABASE_URL"
    TEST_DB_NAME="$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$TEST_URL")"
else
    MODE="docker"
    TEST_DB_NAME="${TEST_DB_NAME:-openmake_llm_test}"
    PG_CONTAINER="${PG_CONTAINER:-openmake-postgres}"
    PG_USER="${PG_USER:-openmake}"
fi

case "$TEST_DB_NAME" in
    *_test) ;;
    *) echo "❌ 테스트 DB 이름은 _test 로 끝나야 합니다: $TEST_DB_NAME" >&2; exit 1 ;;
esac

echo "▶ 대상: $TEST_DB_NAME ($MODE)"

if [[ "$MODE" == "docker" ]]; then
    if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
        echo "❌ .env 없음: $SCRIPT_DIR/.env (TEST_DATABASE_URL 을 주면 .env 없이 돈다)" >&2
        exit 1
    fi

    # 운영 DATABASE_URL 에서 접속 정보만 빌리고 DB 이름만 교체한다.
    TEST_URL="$(cd "$SCRIPT_DIR" && TEST_DB_NAME="$TEST_DB_NAME" node -e "
const u = new URL(require('dotenv').config({ quiet: true }).parsed.DATABASE_URL);
u.pathname = '/' + process.env.TEST_DB_NAME;
console.log(u.toString());
")"

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
fi

# 3) 코어 마이그레이션 — url 방식은 CLI 의 스키마 준비(ensureReady → 002-schema)가 baseline 을 함께 만든다
( cd "$SCRIPT_DIR/apps/api" && DATABASE_URL="$TEST_URL" npx ts-node src/data/migrations/cli.ts migrate )
echo "  코어 마이그레이션 적용 완료"

# 4) 내장 add-on 마이그레이션(addon:<id>:NNN) — *.db.test.ts 가 add-on 테이블(knowledge_*)을 전제한다
( cd "$SCRIPT_DIR/apps/api" && DATABASE_URL="$TEST_URL" npx ts-node src/data/migrations/cli.ts migrate:addons )
echo "  add-on 마이그레이션 적용 완료"

echo ""
echo "✅ 준비 완료. 아래처럼 실행하세요:"
echo "   TEST_DATABASE_URL=\"$TEST_URL\" npm run test:db"
