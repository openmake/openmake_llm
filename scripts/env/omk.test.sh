#!/usr/bin/env bash
# omk.sh 의 순수 함수 테스트 — 시스템(PM2·docker·네트워크)을 건드리지 않는다.
# 임시 OMK_ROOT 안에서 이름 파생·.env 읽기/쓰기·bench .env 생성·프록시 렌더링만 확인한다.
#   bash scripts/env/omk.test.sh          # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1
# shellcheck source=/dev/null
. "$HERE/omk.sh"
set +e   # omk.sh 의 set -e 를 끈다 — 실패를 세어서 보고한다

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

# ── 이름 파생: online 은 기본(무접미사), 그 외는 -<env> ──
eq "suffix online"  "$(env_suffix online)"  ""
eq "suffix staging" "$(env_suffix staging)" "-staging"
eq "pm2 online"     "$(pm2_names online)"   "openmake-llm openmake-next openmake-discord openmake-bench omk-updater-online"
eq "pm2 staging"    "$(pm2_names staging)"  "openmake-llm-staging openmake-next-staging openmake-discord-staging openmake-bench-staging omk-updater-staging"
eq "docker online"  "$(docker_containers online)"  "openmake-postgres openmake-redis"
eq "docker staging" "$(docker_containers staging)" "openmake-staging-postgres openmake-staging-redis"
eq "volumes online" "$(docker_volumes online)"     "openmake_pgdata openmake_redisdata"
eq "volumes staging" "$(docker_volumes staging)"   "openmake-staging_pgdata openmake-staging_redisdata"
eq "bench pm2"      "$(bench_pm2_name staging)" "openmake-bench-staging"
eq "dirs"           "$(llm_dir staging)|$(bench_dir staging)" "$OMK_ROOT/staging/llm|$OMK_ROOT/staging/bench"
eq "ref staging"    "$(env_default_ref staging)" "staging"
eq "ref online"     "$(env_default_ref online)"  "main"
ok "validate rejects dev"   '! ( validate_env dev ) >/dev/null 2>&1'
ok "validate rejects Upper" '! ( validate_env Staging ) >/dev/null 2>&1'
ok "validate accepts qa-1"  '( validate_env qa-1 ) >/dev/null 2>&1'

# ── 소유권 가드: 환경 디렉터리 밖의 경로는 남의 것 ──
ok "own: infra under env"     '! is_foreign_path "$OMK_ROOT/staging/llm/infra" "$OMK_ROOT/staging"'
ok "own: env dir itself"      '! is_foreign_path "$OMK_ROOT/staging" "$OMK_ROOT/staging"'
ok "foreign: legacy layout"   'is_foreign_path "$OMK_ROOT/chat-staging/infra" "$OMK_ROOT/staging"'
ok "foreign: prefix sibling"  'is_foreign_path "$OMK_ROOT/staging2/llm" "$OMK_ROOT/staging"'
ok "unknown owner passes"     '! is_foreign_path "" "$OMK_ROOT/staging"'

# ── .env 백업 복원: 설치 전에만, 있는 .env 는 덮지 않는다 ──
BK="$TMP/bk"; mkdir -p "$BK" "$TMP/r1" "$TMP/r2"; printf 'POSTGRES_PASSWORD=old\n' > "$BK/llm.env"
OMK_RESTORE_ENV_FROM="$BK" restore_env_backup "$TMP/r1" llm >/dev/null
eq "restore before install" "$(dotenv_get "$TMP/r1/.env" POSTGRES_PASSWORD)" "old"
printf 'POSTGRES_PASSWORD=current\n' > "$TMP/r2/.env"
OMK_RESTORE_ENV_FROM="$BK" restore_env_backup "$TMP/r2" llm >/dev/null
eq "restore never clobbers" "$(dotenv_get "$TMP/r2/.env" POSTGRES_PASSWORD)" "current"
OMK_RESTORE_ENV_FROM="$BK" restore_env_backup "$TMP/r1" bench >/dev/null
ok "restore missing backup is no-op" '[[ ! -f "$TMP/r1/bench.env" ]]'
( unset OMK_RESTORE_ENV_FROM; restore_env_backup "$TMP/none" llm ); ok "restore unset is no-op" '[[ ! -e "$TMP/none/.env" ]]'

# ── PM2 dump 검사: 이 환경의 앱이 저장돼 있을 때만 pm2 save 를 한다 ──
export PM2_HOME="$TMP/pm2"; mkdir -p "$PM2_HOME"
printf '[{"name":"other-app"},{"name":"openmake-llm-staging"}]' > "$PM2_HOME/dump.pm2"
ok "dump has env app"      'pm2_dump_has_any "$(pm2_names staging)"'
ok "dump lacks other env"  '! pm2_dump_has_any "$(pm2_names qa)"'
rm -f "$PM2_HOME/dump.pm2"; ok "no dump → false" '! pm2_dump_has_any "$(pm2_names staging)"'
unset PM2_HOME

# ── .env 읽기/쓰기 ──
F="$TMP/a.env"; printf 'A=1\nB="two words"\n# C=no\nD=x=y\n' > "$F"
eq "get plain"   "$(dotenv_get "$F" A)" "1"
eq "get quoted"  "$(dotenv_get "$F" B)" "two words"
eq "get comment" "$(dotenv_get "$F" C)" ""
eq "get with ="  "$(dotenv_get "$F" D)" "x=y"
dotenv_set "$F" A 2;            eq "set replace" "$(dotenv_get "$F" A)" "2"
dotenv_set "$F" E "http://h:1/p"; eq "set append" "$(dotenv_get "$F" E)" "http://h:1/p"
dotenv_ensure "$F" A 9;         eq "ensure keeps" "$(dotenv_get "$F" A)" "2"
dotenv_ensure "$F" G 7;         eq "ensure adds"  "$(dotenv_get "$F" G)" "7"
eq "no duplicate keys" "$(grep -c '^A=' "$F")" "1"
eq "others untouched"  "$(dotenv_get "$F" D)" "x=y"

# ── llm 포트 해석 (install.sh 규칙: OMK_WEB_PORT 없으면 OMK_APP_URL 끝 포트) ──
L="$OMK_ROOT/staging/llm"; mkdir -p "$L"
printf 'PORT=52417\nOMK_APP_URL=http://localhost:3010\nPOSTGRES_PORT=5433\n' > "$L/.env"
eq "api port"          "$(llm_api_port "$L")" "52417"
eq "web port from url" "$(llm_web_port "$L")" "3010"
eq "defaults"          "$(llm_api_port "$TMP/none")|$(llm_web_port "$TMP/none")" "52416|3000"

# ── bench .env: 짝 맞는 값만 채우고, 재실행해도 포트가 안 바뀐다 ──
B="$OMK_ROOT/staging/bench"; mkdir -p "$B"
P1="$(bench_ensure_env "$B" staging 52417 3010 1)"
ok "bench port numeric >= base" "[[ '$P1' =~ ^[0-9]+$ && $P1 -ge $OMKB_PORT_BASE ]]"
eq "bench base url"  "$(dotenv_get "$B/.env" OMK_BASE_URL)"  "http://localhost:52417/api/v1"
eq "bench web port"  "$(dotenv_get "$B/.env" OMK_WEB_PORT)"  "3010"
eq "bench instance"  "$(dotenv_get "$B/.env" OMKB_INSTANCE)" "staging"
eq "bench auth"      "$(dotenv_get "$B/.env" OMKB_AUTH)"     "openmake"
eq "bench log dir"   "$(dotenv_get "$B/.env" OMKB_LOG_DIR)"  "$OMK_ROOT/staging/logs"
dotenv_set "$B/.env" OMK_API_KEY "omk_live_keep"
P2="$(bench_ensure_env "$B" staging 52417 3010 1)"
eq "bench port stable" "$P2" "$P1"
eq "bench key kept"    "$(dotenv_get "$B/.env" OMK_API_KEY)" "omk_live_keep"
BO="$OMK_ROOT/online/bench"; mkdir -p "$BO"; bench_ensure_env "$BO" online 52416 3000 1 >/dev/null
eq "online has no instance key" "$(dotenv_get "$BO/.env" OMKB_INSTANCE)" ""
BD="$TMP/devbench"; mkdir -p "$BD"; bench_ensure_env "$BD" dev 52417 3010 0 >/dev/null
eq "dev has no auth" "$(dotenv_get "$BD/.env" OMKB_AUTH)" ""

# ── 프록시 렌더링: 템플릿의 {{…}} 가 .env 값으로 전부 치환된다 ──
proxy_render staging >/dev/null
OUT="$OMK_ROOT/caddy/caddy.d/staging.caddy"
ok "render file exists"   "[[ -f '$OUT' ]]"
ok "no placeholders left" "! grep -q '{{' '$OUT'"
ok "api upstream"         "grep -q 'reverse_proxy /api/\* localhost:52417' '$OUT'"
ok "web upstream"         "grep -q 'reverse_proxy localhost:3010' '$OUT'"
PP="$(dotenv_get "$L/.env" OMK_PROXY_PORT)"
ok "proxy port recorded"  "[[ '$PP' =~ ^[0-9]+$ && $PP -ge $OMK_PROXY_PORT_BASE ]]"
ok "site address"         "grep -q '^:$PP {' '$OUT'"
eq "proxy dir recorded"   "$(dotenv_get "$L/.env" OMK_PROXY_DIR)" "$OMK_ROOT/caddy"
ok "root Caddyfile imports" "grep -q 'import $OMK_ROOT/caddy/caddy.d/\*.caddy' '$OMK_ROOT/caddy/Caddyfile'"
proxy_render staging >/dev/null
eq "proxy port stable" "$(dotenv_get "$L/.env" OMK_PROXY_PORT)" "$PP"
proxy_remove staging >/dev/null
ok "proxy remove" "[[ ! -f '$OUT' ]]"

echo ""; echo "omk.test: $PASS passed, $FAIL failed (bash $BASH_VERSION)"
[[ $FAIL -eq 0 ]]
