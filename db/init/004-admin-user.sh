#!/bin/bash
# ============================================
# OpenMake.Ai - 초기 관리자 계정 (빈 볼륨 첫 기동 시 1회)
# ============================================
# 고정 비밀번호를 저장소에 두지 않기 위해 SQL 시드에서 분리했다. 해시는
# pgcrypto 의 crypt(pw, gen_salt('bf', 10)) 로 만들며 앱의 bcryptjs.compare
# (user-manager.ts) 와 호환되는 $2a$ 포맷이다.
#
# 필요 환경변수 (infra/docker-compose.yml 이 .env 에서 전달):
#   ADMIN_INITIAL_PASSWORD   미설정 시 계정을 만들지 않고 건너뛴다
#   ADMIN_INITIAL_USERNAME   기본 admin
#   ADMIN_INITIAL_EMAIL      기본 admin@openmake.ai
set -euo pipefail

if [ -z "${ADMIN_INITIAL_PASSWORD:-}" ]; then
  echo "[004-admin-user] ADMIN_INITIAL_PASSWORD 미설정 — 초기 관리자 계정을 만들지 않습니다."
  echo "[004-admin-user] 계정이 필요하면 .env 에 설정 후 빈 볼륨으로 재초기화하세요."
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v username="${ADMIN_INITIAL_USERNAME:-admin}" \
  -v email="${ADMIN_INITIAL_EMAIL:-admin@openmake.ai}" \
  -v password="$ADMIN_INITIAL_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (id, username, password_hash, email, role, is_active)
VALUES (
    'admin-default-001',
    :'username',
    crypt(:'password', gen_salt('bf', 10)),
    :'email',
    'admin',
    TRUE
) ON CONFLICT (username) DO NOTHING;
SQL

echo "[004-admin-user] 초기 관리자 계정 생성 완료: ${ADMIN_INITIAL_USERNAME:-admin}"
