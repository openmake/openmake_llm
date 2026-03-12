#!/usr/bin/env bash
# ============================================================
# OpenMake LLM Local Bootstrap / Recovery Script (Pro)
# ============================================================
# 목적:
#   - macOS + Homebrew 기준으로 openmake_llm 로컬 개발 환경을 한 번에 준비
#   - 실제 복구 과정에서 겪은 문제들을 재현 없이 통과하도록 구성
#   - 진행률 / 현재 작업 / 로그 파일 / 실패 요약 / 선택 옵션 제공
#
# 해결 대상으로 포함한 실제 이슈:
#   1. PostgreSQL / Ollama / pgvector 미설치
#   2. PostgreSQL / Ollama 서비스 미기동
#   3. .env 누락 또는 핵심 변수 부재
#   4. DB 사용자 / DB / extension 미생성
#   5. nomic-embed-text 모델 미설치
#   6. 002-schema.sql 미적용으로 인한 핵심 테이블 누락
#   7. ts-node ESM 이슈로 npm run migrate 실패
#   8. dist/public 부재로 npm run build 실패
#
# 옵션:
#   --dry-run          실제 변경 없이 수행 예정 작업만 출력
#   --skip-brew        brew 설치 단계 건너뛰기
#   --skip-model-pull  Ollama 모델 pull 단계 건너뛰기
#   --skip-build       build 단계 건너뛰기
#   --start-server     마지막에 npm start 까지 실행
#   --force-env        기존 .env 백업 후 핵심값 강제 갱신 허용
#   --help             도움말 출력
#
# 예시:
#   bash scripts/bootstrap-local.sh
#   bash scripts/bootstrap-local.sh --start-server
#   bash scripts/bootstrap-local.sh --dry-run --skip-brew
#   DB_PASSWORD='my_pw' ADMIN_PASSWORD_VALUE='admin_pw' bash scripts/bootstrap-local.sh --force-env
# ============================================================
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# -----------------------------
# 기본값 (환경변수 override 가능)
# -----------------------------
PORT="${PORT:-52416}"
DB_NAME="${DB_NAME:-openmake_llm}"
DB_USER="${DB_USER:-openmake}"
DB_PASSWORD="${DB_PASSWORD:-openmake_secret_2026}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
OLLAMA_BASE_URL_VALUE="${OLLAMA_BASE_URL_VALUE:-http://localhost:11434}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"
LOG_DIR="$PROJECT_ROOT/logs/bootstrap"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/bootstrap-$TIMESTAMP.log"
DATABASE_URL_VALUE="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# -----------------------------
# 옵션 상태
# -----------------------------
DRY_RUN=0
SKIP_BREW=0
SKIP_MODEL_PULL=0
SKIP_BUILD=0
START_SERVER=0
FORCE_ENV=0

usage() {
  sed -n '1,45p' "$0" | sed 's/^# \{0,1\}//'
}

while (($# > 0)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-brew) SKIP_BREW=1 ;;
    --skip-model-pull) SKIP_MODEL_PULL=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --start-server) START_SERVER=1 ;;
    --force-env) FORCE_ENV=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

# -----------------------------
# 컬러 / 상태 표시
# -----------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

TOTAL_STEPS=11
CURRENT_STEP=0
CURRENT_LABEL=""
START_TS="$(date +%s)"
COMPLETED_STEPS=()

mkdir -p "$LOG_DIR"

# 콘솔과 로그 동시 기록
exec > >(tee -a "$LOG_FILE") 2>&1

render_progress_bar() {
  local current="$1" total="$2" label="$3"
  local width=30
  local filled=$(( current * width / total ))
  local empty=$(( width - filled ))
  local percent=$(( current * 100 / total ))
  local fill_bar empty_bar
  fill_bar=$(printf '%*s' "$filled" '' | tr ' ' '#')
  empty_bar=$(printf '%*s' "$empty" '' | tr ' ' '-')
  echo -e "${BLUE}[${fill_bar}${empty_bar}]${NC} ${percent}% (${current}/${total}) ${YELLOW}${label}${NC}"
}

step() {
  CURRENT_STEP=$((CURRENT_STEP + 1))
  CURRENT_LABEL="$1"
  echo ""
  render_progress_bar "$CURRENT_STEP" "$TOTAL_STEPS" "$1"
}

ok() { echo -e "${GREEN}✔${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✖${NC} $1"; exit 1; }
show_running() { echo -e "${BLUE}   • 실행 중:${NC} $1"; }
mark_done() { COMPLETED_STEPS+=("$1"); echo -e "${GREEN}  ↳ 완료:${NC} $1"; }

run_cmd() {
  local description="$1"; shift
  show_running "$description"
  if ((DRY_RUN)); then
    echo -e "${DIM}      [dry-run] $*${NC}"
  else
    "$@"
  fi
}

run_shell() {
  local description="$1"; shift
  show_running "$description"
  if ((DRY_RUN)); then
    echo -e "${DIM}      [dry-run] $*${NC}"
  else
    bash -lc "$*"
  fi
}

print_summary() {
  local end_ts elapsed
  end_ts="$(date +%s)"
  elapsed=$(( end_ts - START_TS ))
  echo ""
  echo -e "${GREEN}================ Summary ================${NC}"
  echo "로그 파일: $LOG_FILE"
  echo "총 소요 시간: ${elapsed}s"
  echo "완료 단계 수: ${#COMPLETED_STEPS[@]}/${TOTAL_STEPS}"
  if ((${#COMPLETED_STEPS[@]} > 0)); then
    for item in "${COMPLETED_STEPS[@]}"; do
      echo -e "  ${GREEN}- ${item}${NC}"
    done
  fi
  echo -e "${GREEN}=========================================${NC}"
}

on_error() {
  local exit_code="$1"
  echo ""
  echo -e "${RED}실패한 단계:${NC} ${CURRENT_LABEL:-unknown}"
  echo -e "${RED}로그 파일:${NC} $LOG_FILE"
  print_summary
  exit "$exit_code"
}
trap 'on_error $?' ERR

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "필수 명령을 찾을 수 없습니다: $1"
}

ensure_brew_formula() {
  local formula="$1"
  if brew list --formula | grep -qx "$formula"; then
    ok "$formula 이미 설치됨"
  else
    run_cmd "$formula 설치" brew install "$formula"
    ok "$formula 설치 완료"
  fi
}

ensure_brew_service() {
  local formula="$1"
  run_shell "$formula 서비스 시작" "brew services start '$formula' >/dev/null"
  ok "$formula 서비스 시작됨"
}

rand_hex() { openssl rand -hex 32; }

backup_env_if_needed() {
  if [[ -f "$ENV_FILE" ]] && ((FORCE_ENV)); then
    local backup="$ENV_FILE.bak.$TIMESTAMP"
    cp "$ENV_FILE" "$backup"
    ok ".env 백업 생성: $backup"
  fi
}

upsert_env() {
  local key="$1" value="$2"
  if ((DRY_RUN)); then
    echo -e "${DIM}      [dry-run] upsert ${key}=...${NC}"
    return 0
  fi
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
text = path.read_text() if path.exists() else ''
lines = text.splitlines()
out = []
found = False
for line in lines:
    if line.startswith(f"{key}="):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(line)
if not found:
    if out and out[-1] != '':
        out.append('')
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
}

step "사전 점검"
run_shell "OS / 경로 / 기본 도구 확인" "uname -s; pwd"
require_cmd brew
require_cmd node
require_cmd npm
require_cmd python3
require_cmd openssl
ok "기본 도구 확인 완료"
mark_done "사전 점검"

step "옵션 / 로그 / 환경 안내"
echo "DRY_RUN=$DRY_RUN SKIP_BREW=$SKIP_BREW SKIP_MODEL_PULL=$SKIP_MODEL_PULL SKIP_BUILD=$SKIP_BUILD START_SERVER=$START_SERVER FORCE_ENV=$FORCE_ENV"
echo "PROJECT_ROOT=$PROJECT_ROOT"
echo "LOG_FILE=$LOG_FILE"
mark_done "옵션 / 로그 / 환경 안내"

step "Homebrew 패키지 설치"
if ((SKIP_BREW)); then
  warn "--skip-brew 지정으로 패키지 설치 단계 생략"
else
  ensure_brew_formula postgresql@17
  ensure_brew_formula ollama
  ensure_brew_formula pgvector
fi
ok "필수 패키지 설치 확인 완료"
mark_done "Homebrew 패키지 설치"

step "서비스 기동 및 포트 확인"
ensure_brew_service postgresql@17
ensure_brew_service ollama
if ((DRY_RUN)); then
  echo "[dry-run] pg_isready / Ollama API 확인 생략 출력"
else
  /opt/homebrew/opt/postgresql@17/bin/pg_isready >/dev/null || fail "PostgreSQL이 응답하지 않습니다"
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null || fail "Ollama API가 응답하지 않습니다"
fi
ok "PostgreSQL / Ollama 정상 응답 확인"
mark_done "서비스 기동 및 포트 확인"

step ".env 준비 및 보정"
backup_env_if_needed
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    run_cmd ".env.example → .env 복사" cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env.example → .env 복사 완료"
  else
    run_shell "빈 .env 생성" ": > '$ENV_FILE'"
    warn ".env.example이 없어 빈 .env 생성"
  fi
else
  ok ".env 이미 존재 — 기존 값 보존하며 필요한 항목만 갱신"
fi
JWT_SECRET_VALUE="$(rand_hex)"
SESSION_SECRET_VALUE="$(rand_hex)"
ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD_VALUE:-change_me_admin_password}"
upsert_env "PORT" "$PORT"
upsert_env "NODE_ENV" "development"
upsert_env "JWT_SECRET" "$JWT_SECRET_VALUE"
upsert_env "SESSION_SECRET" "$SESSION_SECRET_VALUE"
upsert_env "ADMIN_PASSWORD" "$ADMIN_PASSWORD_VALUE"
upsert_env "DATABASE_URL" "$DATABASE_URL_VALUE"
upsert_env "OLLAMA_BASE_URL" "$OLLAMA_BASE_URL_VALUE"
upsert_env "OLLAMA_HOST" "$OLLAMA_BASE_URL_VALUE"
upsert_env "OLLAMA_DEFAULT_HOST" "localhost"
upsert_env "OLLAMA_DEFAULT_PORT" "11434"
upsert_env "OLLAMA_DEFAULT_NODE_NAME" "primary"
upsert_env "OLLAMA_MODEL" "gemini-3-flash-preview:cloud"
upsert_env "OLLAMA_DEFAULT_MODEL" "gemini-3-flash-preview:cloud"
upsert_env "GEMINI_API_KEY" ""
ok ".env 핵심 항목 정리 완료"
mark_done ".env 준비 및 보정"

step "DB 사용자 / DB / 확장 준비"
if ((DRY_RUN)); then
  echo "[dry-run] role/database 생성 및 vector/pg_trgm extension 적용"
else
  /opt/homebrew/opt/postgresql@17/bin/psql postgres <<SQL
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
   ELSE
      ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
   END IF;
END
$$;
SQL
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" 2>/dev/null || true
  psql "$DATABASE_URL_VALUE" -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
  psql "$DATABASE_URL_VALUE" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' >/dev/null || true
fi
ok "DB / 확장 준비 완료"
mark_done "DB 사용자 / DB / 확장 준비"

step "Node 의존성 설치"
run_cmd "npm install" npm install
ok "npm install 완료"
mark_done "Node 의존성 설치"

step "임베딩 모델 준비"
if ((SKIP_MODEL_PULL)); then
  warn "--skip-model-pull 지정으로 모델 설치 단계 생략"
else
  if ((DRY_RUN)); then
    echo "[dry-run] ollama list / ollama pull $EMBED_MODEL"
  else
    if ollama list | grep -q '^nomic-embed-text'; then
      ok "${EMBED_MODEL} 이미 설치됨"
    else
      run_cmd "ollama pull ${EMBED_MODEL}" ollama pull "$EMBED_MODEL"
      ok "${EMBED_MODEL} 설치 완료"
    fi
  fi
fi
mark_done "임베딩 모델 준비"

step "초기 스키마 적용"
run_shell "services/database/init/002-schema.sql 적용" "psql '$DATABASE_URL_VALUE' -f services/database/init/002-schema.sql >/dev/null"
ok "기본 스키마 적용 완료"
mark_done "초기 스키마 적용"

step "마이그레이션 적용"
run_shell "CommonJS 옵션으로 ts-node migration 실행" "npx ts-node --compiler-options '{\"module\":\"CommonJS\"}' scripts/run-migrations.ts"
ok "마이그레이션 적용 완료"
mark_done "마이그레이션 적용"

step "빌드"
if ((SKIP_BUILD)); then
  warn "--skip-build 지정으로 build 단계 생략"
else
  run_shell "dist/public 보장 후 npm run build" "mkdir -p backend/api/dist/public && npm run build"
  ok "빌드 완료"
fi
mark_done "빌드"

step "최종 점검"
if ((DRY_RUN)); then
  echo "[dry-run] migration_versions / Ollama models / HTTP 확인"
else
  psql "$DATABASE_URL_VALUE" -c 'SELECT version, filename FROM migration_versions ORDER BY version;'
  curl -sf http://127.0.0.1:11434/api/tags | python3 -c 'import sys,json; data=json.load(sys.stdin); print("Installed models:", ", ".join(m["name"] for m in data.get("models", [])))'
fi
ok "최종 점검 완료"
mark_done "최종 점검"

step "서버 시작(선택)"
if ((START_SERVER)); then
  run_shell "npm start" "npm start"
  ok "서버 시작 명령 완료"
else
  warn "--start-server 미지정: 서버는 자동 시작하지 않음"
fi
mark_done "서버 시작(선택)"

print_summary

echo ""
echo -e "${GREEN}Bootstrap 완료${NC}"
if ((START_SERVER)); then
  echo "브라우저에서 http://127.0.0.1:${PORT} 접속"
else
  echo "다음 단계:"
  echo "  1) cd $PROJECT_ROOT"
  echo "  2) npm start"
  echo "  3) 브라우저에서 http://127.0.0.1:${PORT} 접속"
fi

echo ""
echo "참고: 이 스크립트는 로컬 설치/복구용입니다."
echo "      장기 운영용 프로세스 관리(pm2/launchd 등)는 별도로 구성하세요."
