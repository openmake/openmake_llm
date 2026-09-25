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
# 안전장치 — 이 테스트는 실제 프록시·PM2 를 절대 건드리지 않는다. (2026-09-19: proxy_remove 가 돌고 있는
# 실제 프록시에 임시 폴더의 빈 설정을 reload 해 staging 라우팅을 날린 사고가 있었다.)
proxy_running() { return 1; }
# shellcheck disable=SC2034  # omk.sh 의 caddy reload 가 읽는다
OMK_CADDY_ADMIN="127.0.0.1:1"
set +e   # omk.sh 의 set -e 를 끈다 — 실패를 세어서 보고한다

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

# ── 이름 파생: online 은 기본(무접미사), 그 외는 -<env> ──
eq "suffix online"  "$(env_suffix online)"  ""
eq "suffix staging" "$(env_suffix staging)" "-staging"
eq "pm2 online"     "$(pm2_names online)"   "openmake-llm openmake-next openmake-discord openmake-bench openmake-litellm omk-updater-online omk-backup-online"
eq "pm2 staging"    "$(pm2_names staging)"  "openmake-llm-staging openmake-next-staging openmake-discord-staging openmake-bench-staging openmake-litellm-staging omk-updater-staging omk-backup-staging"
eq "docker online"  "$(docker_containers online)"  "openmake-postgres openmake-redis openmake-searxng"
eq "docker staging" "$(docker_containers staging)" "openmake-staging-postgres openmake-staging-redis openmake-staging-searxng"
eq "volumes online" "$(docker_volumes online)"     "openmake_pgdata openmake_redisdata"
eq "volumes staging" "$(docker_volumes staging)"   "openmake-staging_pgdata openmake-staging_redisdata"
eq "bench pm2"      "$(bench_pm2_name staging)" "openmake-bench-staging"
eq "dirs"           "$(llm_dir staging)|$(bench_dir staging)" "$OMK_ROOT/staging/llm|$OMK_ROOT/staging/bench"
eq "ref staging"    "$(env_default_ref staging)" "main"
eq "ref online"     "$(env_default_ref online)"  "release"
eq "ref dev"        "$(env_default_ref dev)"     "main"
ok "validate rejects local" '! ( validate_env local ) >/dev/null 2>&1'
DV="$TMP/devclone"; mkdir -p "$DV"
# shellcheck disable=SC2034  # dev_instance 가 읽는다
eq "dev server: 새 클론은 local"  "$( DEV_LLM="$DV"; dev_instance )" "local"
printf 'OMK_INSTANCE=dev\n' > "$DV/.env"
# shellcheck disable=SC2034
eq "dev server: 준비된 클론은 .env 를 따른다" "$( DEV_LLM="$DV"; dev_instance )" "dev"
ok "validate accepts dev"   '( validate_env dev ) >/dev/null 2>&1'
ok "validate rejects Upper" '! ( validate_env Staging ) >/dev/null 2>&1'
ok "validate accepts qa-1"  '( validate_env qa-1 ) >/dev/null 2>&1'

# ── 웹 검색: 이름·설정 파일·.env 표시 (docker·네트워크는 건드리지 않는다) ──
eq "searxng online"  "$(searxng_name online)"  "openmake-searxng"
eq "searxng dev"     "$(searxng_name dev)"     "openmake-dev-searxng"
SX="$TMP/sx"; mkdir -p "$SX"; searxng_write_settings "$SX/settings.yml"
ok "settings: json 포맷 허용"   'grep -qE "^    - json$" "$SX/settings.yml"'
ok "settings: limiter 끔"       'grep -qE "^  limiter: false$" "$SX/settings.yml"'
ok "settings: secret 64 hex"    'grep -qE "secret_key: \"[0-9a-f]{64}\"" "$SX/settings.yml"'
printf 'A=1\nB=2\nA2=3\n' > "$SX/.env"; dotenv_unset "$SX/.env" A
eq "unset: 그 키만 지운다"       "$(tr '\n' ' ' < "$SX/.env")" "B=2 A2=3 "
dotenv_unset "$SX/.env" NOPE; eq "unset: 없는 키는 무해" "$(tr '\n' ' ' < "$SX/.env")" "B=2 A2=3 "
eq "line: 미설정"    "$(search_line "$SX")" "SearXNG 없음 (키 없는 기본 제공자만 — 일반 웹 검색은 거의 0건)"
( SEARCH_CHANGED=0; search_mark_offline "$SX/.env" >/dev/null; echo "$SEARCH_CHANGED" > "$SX/changed" )
eq "offline: 대기 시간 단축"    "$(dotenv_get "$SX/.env" WEB_SEARCH_FETCH_TIMEOUT_MS)|$(dotenv_get "$SX/.env" OMK_SEARCH_OFFLINE)|$(cat "$SX/changed")" "2000|1|1"
ok "line: 오프라인 표시"        '[[ "$(search_line "$SX")" == 꺼짐*외부* ]]'
printf 'WEB_SEARCH_FETCH_TIMEOUT_MS=9000\n' > "$SX/.env"; search_mark_offline "$SX/.env" >/dev/null
eq "offline: 사용자 값 존중"    "$(dotenv_get "$SX/.env" WEB_SEARCH_FETCH_TIMEOUT_MS)|$(dotenv_get "$SX/.env" OMK_SEARCH_OFFLINE)" "9000|1"
printf 'SEARXNG_URL=http://127.0.0.1:8888\nOMK_SEARXNG_PORT=8888\n' > "$SX/.env"; SEARCH_CHANGED=0; search_forget "$SX/.env"
eq "forget: omk 주소를 걷어낸다" "$(cat "$SX/.env")|$SEARCH_CHANGED" "|1"
printf 'SEARXNG_URL=http://search.internal:8080\n' > "$SX/.env"; SEARCH_CHANGED=0; search_forget "$SX/.env"
eq "forget: 사용자 주소는 남긴다" "$(dotenv_get "$SX/.env" SEARXNG_URL)|$SEARCH_CHANGED" "http://search.internal:8080|0"
# omk 가 띄운 뒤 사용자가 주소만 바꾼 경우(OMK_SEARXNG_PORT 는 남아 있다) — 되돌리지 않는다
printf 'SEARXNG_URL=http://search.internal:8080\nOMK_SEARXNG_PORT=8888\n' > "$SX/.env"; searxng_ensure "$SX" t "$SX/c" "$SX" >/dev/null
eq "ensure: 바꾼 URL 을 되돌리지 않음" "$(dotenv_get "$SX/.env" SEARXNG_URL)|$(dotenv_get "$SX/.env" OMK_SEARXNG_PORT)" "http://search.internal:8080|"
printf 'OMK_SEARXNG=off\n' > "$SX/.env"; SEARCH_CHANGED=9; searxng_ensure "$SX" t "$SX/c" "$SX"
eq "ensure: off 면 아무것도 안 함" "$SEARCH_CHANGED|$([[ -d "$SX/c" ]] && echo made)" "0|"
printf 'SEARXNG_URL=http://search.internal:8080\n' > "$SX/.env"; searxng_ensure "$SX" t "$SX/c" "$SX" >/dev/null
eq "ensure: 사용자 URL 은 그대로" "$(dotenv_get "$SX/.env" SEARXNG_URL)|$SEARCH_CHANGED" "http://search.internal:8080|0"

# ── 프록시 주소(origin) 허용 ──
OX="$TMP/ox"; mkdir -p "$OX"; printf 'CORS_ORIGINS=http://localhost:13000\nOMK_PROXY_PORT=33000\nOMK_ENV_HOSTS=tom\n' > "$OX/.env"
env_apply_origins "$OX"
eq "origins: 프록시 포트의 localhost·호스트 추가" "$(dotenv_get "$OX/.env" CORS_ORIGINS)|$ORIGINS_CHANGED" "http://localhost:13000,http://localhost:33000,http://127.0.0.1:33000,http://tom:33000|1"
env_apply_origins "$OX"; eq "origins: 멱등" "$ORIGINS_CHANGED" "0"
printf 'CORS_ORIGINS=x\n' > "$OX/.env"; env_apply_origins "$OX"; eq "origins: 프록시 없으면 그대로" "$(dotenv_get "$OX/.env" CORS_ORIGINS)" "x"

ok "proxy: 남의 OMK_ROOT 프록시는 우리 것이 아니다" '! ( proxy_running() { return 0; }; pm2_app_cwd() { printf /somewhere/else/caddy; }; proxy_is_ours )'
ok "proxy: 이 OMK_ROOT 의 프록시는 우리 것"          '( proxy_running() { return 0; }; pm2_app_cwd() { proxy_dir; }; proxy_is_ours )'

# ── 릴리스 추종: 가장 높은 vX.Y.Z, 새 태그가 생기면 behind ──
GR="$TMP/rel"; git init -q "$GR"; ( cd "$GR" || exit; git -c user.email=t@t -c user.name=t commit -q --allow-empty -m a; git tag v1.9.0; git tag v1.10.0; git tag not-a-release; git tag v1.10.0-rc1 )
eq "release: 가장 높은 태그" "$(latest_release_tag "$GR")" "v1.10.0"
git clone -q "$GR" "$TMP/relc" 2>/dev/null; release_checkout "$TMP/relc" v1.10.0
eq "release: 로컬 브랜치 release" "$(git -C "$TMP/relc" rev-parse --abbrev-ref HEAD)" "release"
ok "release: 최신이면 behind 아님" '! release_behind "$TMP/relc"'
( cd "$GR" || exit; git -c user.email=t@t -c user.name=t commit -q --allow-empty -m b; git tag v1.11.0 )
ok "release: 새 태그가 생기면 behind" 'release_behind "$TMP/relc" && [[ "$RELEASE_TAG" == "v1.11.0" ]]'

# ── 백업 위치: 환경 디렉터리 밖이 기본, .env 의 BACKUP_DIR 이 있으면 그쪽 ──
eq "backup dir 기본" "$(backup_dir staging)" "$OMK_ROOT/backups/staging"
ok "backup dir 는 환경 밖" '[[ "$(backup_dir staging)" != "$(env_dir staging)"/* ]]'
mkdir -p "$(llm_dir bk)"; printf 'BACKUP_DIR=/mnt/backup/omk\n' > "$(llm_dir bk)/.env"
eq "backup dir: .env 우선" "$(backup_dir bk)" "/mnt/backup/omk"; rm -rf "$(env_dir bk)"

# ── LiteLLM: 환경별 이름·위치, off 면 아무것도 안 함 ──
eq "litellm names" "$(litellm_pm2_name staging)|$(litellm_pm2_name online)|$(litellm_dir dev)" "openmake-litellm-staging|openmake-litellm|$OMK_ROOT/dev/litellm"
LX="$TMP/lx"; mkdir -p "$LX"; printf 'OMK_LITELLM=off\nLLM_BASE_URL=http://x\n' > "$LX/.env"
litellm_ensure "$LX" dev >/dev/null; eq "litellm: off 면 그대로" "$LITELLM_CHANGED|$(dotenv_get "$LX/.env" LLM_BASE_URL)|$([[ -d "$OMK_ROOT/dev/litellm" ]] && echo y || echo n)" "0|http://x|n"

printf 'model_list:\n  - model_name: a\n' > "$LX/repo.yaml"; : > "$LX/l.env"
litellm_render_config "$LX/repo.yaml" "$LX/l.env" "$LX/out.yaml"; ok "litellm config: 업스트림 없으면 레포 것 그대로" 'cmp -s "$LX/repo.yaml" "$LX/out.yaml"'
printf 'OMK_UPSTREAM_MODEL=qwen3.5:397b-cloud\n' > "$LX/l.env"; litellm_render_config "$LX/repo.yaml" "$LX/l.env" "$LX/out.yaml"
eq "litellm config: 업스트림 모델 한 항목 추가" "$(grep -c 'model_name' "$LX/out.yaml")|$(grep -c 'openai/qwen3.5:397b-cloud' "$LX/out.yaml")|$(grep -c 'os.environ/OMK_UPSTREAM_API_BASE' "$LX/out.yaml")" "2|1|1"

ok "llamacpp: 이 플랫폼의 릴리스 이름" '[[ "$(llamacpp_platform)" =~ ^(macos|ubuntu)-(arm64|x64)$ ]]'
( default_model_resolve; [[ "$OMK_DEFAULT_MODEL_NAME|$OMK_DEFAULT_MODEL_CTX" == "qwen3-1.7b|16384" ]] ) && ok "default model: 기본값" true || ok "default model: 기본값" false
mkdir -p "$(llamacpp_dir)"; printf 'HF=a/b:Q4\nNAME=mine\nCTX=8192\n' > "$(llamacpp_dir)/model.conf"
eq "default model: 기억된 선택" "$( default_model_resolve; echo "$OMK_DEFAULT_MODEL_HF|$OMK_DEFAULT_MODEL_NAME|$OMK_DEFAULT_MODEL_CTX" )" "a/b:Q4|mine|8192"
eq "default model: 명시가 우선" "$( OMK_DEFAULT_MODEL_NAME=x; default_model_resolve; echo "$OMK_DEFAULT_MODEL_NAME|$OMK_DEFAULT_MODEL_HF" )" "x|a/b:Q4"
rm -rf "$(llamacpp_dir)"
eq "llamacpp dir" "$(llamacpp_dir)" "$OMK_ROOT/llamacpp"

# ── 런타임 이미지 태그: 환경별, 기본 인스턴스는 소스 기본값(:latest) ──
eq "images dev"    "$(runtime_image_names dev)"    "openmake-mcp-runtime:dev openmake-task-runtime:dev"
eq "images online" "$(runtime_image_names online)" "openmake-mcp-runtime:latest openmake-task-runtime:latest"
RX="$TMP/rx"; mkdir -p "$RX"; printf 'OMK_RUNTIME_IMAGES=off\n' > "$RX/.env"
runtime_images_ensure "$RX" dev >/dev/null; eq "images: off 면 아무것도 안 함" "$RUNTIME_CHANGED|$(dotenv_get "$RX/.env" MCP_SANDBOX_IMAGE)" "0|"

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
# dump 판독은 node 로 한다(설치본에는 install.sh 가 항상 깔아 둔다) — 맨 컨테이너처럼 node 가 없으면 건너뛴다.
if has node; then ok "dump has env app" 'pm2_dump_has_any "$(pm2_names staging)"'; else echo "SKIP dump has env app (node 없음)"; fi
ok "dump lacks other env"  '! pm2_dump_has_any "$(pm2_names qa)"'
rm -f "$PM2_HOME/dump.pm2"; ok "no dump → false" '! pm2_dump_has_any "$(pm2_names staging)"'
unset PM2_HOME

# ── dev 호스트: CORS_ORIGINS 에 호스트별 웹·API origin 을 더한다(멱등, 기존 값 보존) ──
eq "csv union keeps order" "$(csv_union "a,b" "b,c")" "a,b,c"
eq "csv union empty left"  "$(csv_union "" "x,y")" "x,y"
DL="$TMP/devllm"; mkdir -p "$DL"; printf 'PORT=52417\nOMK_WEB_PORT=3010\nCORS_ORIGINS=http://localhost:3010\n' > "$DL/.env"
dev_apply_hosts "$DL" "tom,100.1.2.3"
eq "cors gets host origins" "$(dotenv_get "$DL/.env" CORS_ORIGINS)" "http://localhost:3010,http://tom:3010,http://tom:52417,http://100.1.2.3:3010,http://100.1.2.3:52417"
eq "hosts remembered"       "$(dotenv_get "$DL/.env" OMK_DEV_HOSTS)" "tom,100.1.2.3"
C1="$(dotenv_get "$DL/.env" CORS_ORIGINS)"; dev_apply_hosts "$DL" "tom,100.1.2.3"
eq "cors idempotent"        "$(dotenv_get "$DL/.env" CORS_ORIGINS)" "$C1"
C0="$(dotenv_get "$DL/.env" CORS_ORIGINS)"; dev_apply_hosts "$DL" ""
eq "no hosts is no-op"      "$(dotenv_get "$DL/.env" CORS_ORIGINS)" "$C0"

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

# ── 운영 구성 옵션 (install_mac.sh 가 켠다) — 네트워크·docker·PM2 는 스텁 ──
ok "root Caddyfile skip_install_trust" "grep -q 'skip_install_trust' '$OMK_ROOT/caddy/Caddyfile'"
OL="$OMK_ROOT/opsenv/llm"; mkdir -p "$OL/scripts/setup/profiles"
cp "$HERE/../setup/profiles/ops-features.env" "$OL/scripts/setup/profiles/"
printf 'LOG_LEVEL=debug\nDEFAULT_ADMIN_EMAIL=admin@example.com\nCORS_ORIGINS=http://localhost:3000\nPORT=52416\nOMK_WEB_PORT=3000\n' > "$OL/.env"
scraper_venv_ensure() { dotenv_set "$1" SCRAPER_PYTHON_BIN "/stub/python3"; }   # 실제 uv 설치 대신
ops_profile_apply "$OL" opsenv >/dev/null
eq "profile: 기존 값 존중"       "$(dotenv_get "$OL/.env" LOG_LEVEL)" "debug"
eq "profile: 기능 플래그 추가"   "$(dotenv_get "$OL/.env" AGENT_TASK_QUEUE_ENABLED)" "true"
eq "profile: JSON 값 보존"       "$(dotenv_get "$OL/.env" LLM_REASONING_EFFORTS_JSON)" '{"qwen3.8":["low","medium","xhigh"],"bai:glm-5.3":["low","high"]}'
eq "profile: 표시"               "$(dotenv_get "$OL/.env" OMK_OPS_PROFILE)" "1"
eq "profile: 작업 공간"          "$(dotenv_get "$OL/.env" TASK_SANDBOX_ROOT)" "$OMK_ROOT/opsenv/task-workspaces"
eq "profile: 스크래퍼"           "$(dotenv_get "$OL/.env" SCRAPER_PYTHON_BIN)" "/stub/python3"
if has node; then
    ok "vapid: 공개키 87자"  "[[ \$(dotenv_get '$OL/.env' VAPID_PUBLIC_KEY | wc -c) -eq 87 ]]"
    ok "vapid: 개인키 43자"  "[[ \$(dotenv_get '$OL/.env' VAPID_PRIVATE_KEY | wc -c) -eq 43 ]]"
    eq "vapid: subject"      "$(dotenv_get "$OL/.env" VAPID_SUBJECT)" "mailto:admin@example.com"
fi
N1="$(grep -c '' "$OL/.env")"; ops_profile_apply "$OL" opsenv >/dev/null
eq "profile: 재실행 멱등" "$(grep -c '' "$OL/.env")" "$N1"
eq "profile: 중복 키 없음" "$(grep -oE '^[A-Z_0-9]+=' "$OL/.env" | sort | uniq -d | tr -d '\n')" ""
dotenv_set "$OL/.env" OMK_RUNTIME_IMAGES off; OPS_CHANGED=0; ops_sandbox_guard "$OL" >/dev/null
eq "sandbox guard: 이미지 없으면 끔" "$(dotenv_get "$OL/.env" TASK_SANDBOX_ENABLED)|$(dotenv_get "$OL/.env" ARTIFACT_EXPORT_ENABLED)|$OPS_CHANGED" "false|false|1"

dgx_http_code() { printf '200'; }
dgx_apply "$OL" opsenv 192.168.0.50 vkey >/dev/null
eq "dgx: 기본 모델"   "$(dotenv_get "$OL/.env" LLM_DEFAULT_MODEL)" "qwen3.8-27b"
eq "dgx: tokenize"    "$(dotenv_get "$OL/.env" LLM_TOKENIZE_URL)|$(dotenv_get "$OL/.env" LLM_TOKENIZE_API_KEY)" "http://192.168.0.50:8002/tokenize|vkey"
eq "dgx: metrics"     "$(dotenv_get "$OL/.env" VLLM_METRICS_URLS)" "http://192.168.0.50:8002/metrics,http://192.168.0.50:8003/metrics"
eq "dgx: 음악 주소"   "$(dotenv_get "$(litellm_dir opsenv)/litellm.env" ACESTEP_CHAT_URL)" "http://192.168.0.50:8005/v1/chat/completions"
dotenv_set "$OL/.env" SSRF_ALLOWED_HOSTS "a.internal"; dgx_apply "$OL" opsenv 192.168.0.50 vkey >/dev/null
eq "dgx: SSRF 합집합" "$(dotenv_get "$OL/.env" SSRF_ALLOWED_HOSTS)" "a.internal,192.168.0.50"
ok "dgx: 연결 요약"   "[[ '$DGX_LINE' == *'채팅 :8002=200'* ]]"

port_in_use() { return 1; }   # :443 점유 여부와 무관하게 렌더만 본다
dotenv_set "$OL/.env" OMK_HTTPS_HOST mac-mini.local; dotenv_set "$OL/.env" OMK_ARTIFACT_VIEWER 1
https_render opsenv >/dev/null
HO="$OMK_ROOT/caddy/caddy.d/opsenv-https.caddy"
ok "https: 사이트 블록"      "grep -q '^mac-mini.local {' '$HO' && grep -q 'tls internal' '$HO'"
ok "https: 업스트림"         "grep -q 'reverse_proxy /api/\* localhost:52416' '$HO' && grep -q 'reverse_proxy localhost:3000' '$HO'"
ok "https: 뷰어 블록"        "grep -q '^mac-mini.local:8443 {' '$HO'"
ok "https: 자리표시자 없음"  "! grep -q '{{' '$HO'"
eq "https: 공개 주소·쿠키"   "$(dotenv_get "$OL/.env" OMK_APP_URL)|$(dotenv_get "$OL/.env" COOKIE_SECURE)|$(dotenv_get "$OL/.env" ALLOW_INSECURE_COOKIES)" "https://mac-mini.local|true|false"
ok "https: CORS"             "[[ '$(dotenv_get "$OL/.env" CORS_ORIGINS)' == *'https://mac-mini.local'* ]]"
dotenv_unset "$OL/.env" OMK_HTTPS_HOST; https_render opsenv >/dev/null
ok "https: 끄면 블록 제거"   "[[ ! -f '$HO' ]]"

echo ""; echo "omk.test: $PASS passed, $FAIL failed (bash $BASH_VERSION)"
[[ $FAIL -eq 0 ]]
