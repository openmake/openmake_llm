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
eq "ref dev"        "$(env_default_ref dev)"     "dev"
eq "ref 그 밖의 이름" "$(env_default_ref qa-1)"    "main"
# 기본값으로 정해진 브랜치가 저장소에 있는가 — 로컬 저장소로 본다(네트워크 없음)
RB="$TMP/rb"; git init -q "$RB" && git -C "$RB" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m x && git -C "$RB" branch -M main
eq "remote branch: 있음"        "$(remote_has_branch "$RB" main >/dev/null 2>&1; echo $?)" "0"
eq "remote branch: 없음"        "$(remote_has_branch "$RB" dev >/dev/null 2>&1; echo $?)"  "1"
# ── lock 변경 감지: update 가 의존성을 설치할지(바뀐 커밋 범위에 package-lock.json 이 있을 때만) ──
LR="$TMP/lock"; git init -q "$LR"
lr_commit() { git -C "$LR" add -A && git -C "$LR" -c user.email=t@example.com -c user.name=t commit -q -m "$1" && git -C "$LR" rev-parse --short HEAD; }
echo '{"v":1}' > "$LR/package-lock.json"; L1="$(lr_commit one)"
echo x > "$LR/other.txt";                  L2="$(lr_commit two)"
echo '{"v":2}' > "$LR/package-lock.json"; L3="$(lr_commit three)"
eq "lock: 다른 파일만 바뀜 → 설치 안 함" "$(lockfile_changed "$LR" "$L1" "$L2"; echo $?)" "1"
eq "lock: 바뀜 → 설치"                  "$(lockfile_changed "$LR" "$L2" "$L3"; echo $?)" "0"
eq "lock: 같은 커밋 → 설치 안 함"        "$(lockfile_changed "$LR" "$L3" "$L3"; echo $?)" "1"
eq "lock: 범위 전체(HEAD 표기)"          "$(lockfile_changed "$LR" "$L1" HEAD; echo $?)" "0"
eq "remote branch: 읽지 못함"   "$(remote_has_branch "$TMP/없는-저장소" dev >/dev/null 2>&1; echo $?)" "2"
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
OX="$TMP/ox"; mkdir -p "$OX"; printf 'CORS_ORIGINS=http://localhost:13000\nOMK_PROXY_PORT=33000\nOMK_ENV_HOSTS=stage-box\n' > "$OX/.env"
env_apply_origins "$OX"
eq "origins: 프록시 포트의 localhost·호스트 추가" "$(dotenv_get "$OX/.env" CORS_ORIGINS)|$ORIGINS_CHANGED" "http://localhost:13000,http://localhost:33000,http://127.0.0.1:33000,http://stage-box:33000|1"
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

# ── 공통 단계: 환경 설치와 로컬 개발이 같은 함수로 같은 단계를 밟는다 (docker·PM2 는 가짜) ──
ST="$TMP/st"; mkdir -p "$ST"
stack_probe() { # $1=.env 내용 $2…=stack_ensure 의 $5 이후 → 불린 단계와 게이트웨이에 넘어간 업스트림(base|model)
    ( printf '%s' "$1" > "$ST/.env"; shift
      log_info() { :; }; log_warn() { :; }
      searxng_ensure()        { printf 'search '; }
      runtime_images_ensure() { printf 'images '; }
      ops_sandbox_guard()     { printf 'guard '; }
      # shellcheck disable=SC2034  # stack_ensure 가 읽는다
      default_model_ensure()  { printf 'model '; DEFAULT_MODEL_BASE="http://127.0.0.1:18080/v1"; OMK_DEFAULT_MODEL_NAME="qwen3-1.7b"; }
      litellm_ensure()        { printf 'gateway[%s|%s]' "${6:-}" "${8:-}"; }
      stack_ensure "$ST" local "$ST/sx" "$ST" "$@" )
}
eq "stack: 업스트림이 없으면 기본 모델"   "$(stack_probe '' 0 0)" "search images guard model gateway[http://127.0.0.1:18080/v1|qwen3-1.7b]"
eq "stack: 기본 모델 이름을 .env 에"      "$(dotenv_get "$ST/.env" LLM_DEFAULT_MODEL)|$(dotenv_get "$ST/.env" LLM_FAST_FAIL_TIMEOUT_MS)" "qwen3-1.7b|60000"
eq "stack: 업스트림을 주면 그것을 따른다" "$(stack_probe '' 0 0 '' '' '' http://u/v1 k m)" "search images guard gateway[http://u/v1|m]"
eq "stack: --no-default-model"            "$(stack_probe '' 1 0)" "search images guard gateway[|]"
eq "stack: 게이트웨이를 끄면 모델도 없다" "$(stack_probe $'OMK_LITELLM=off\n' 0 0)" "search images guard gateway[|]"
eq "stack: 직접 넣은 주소는 그대로"       "$(stack_probe $'LLM_BASE_URL=http://my:1\n' 0 1)|$(dotenv_get "$ST/.env" LLM_BASE_URL)" "search images guard |http://my:1"

# ── 로컬 개발의 .env: 실행 모드, 그리고 LLM 주소가 omk 것인가 ──
printf 'NODE_ENV=production\n' > "$ST/d.env"; dev_env_defaults "$ST/d.env"
eq "dev env: production 은 development 로" "$(dotenv_get "$ST/d.env" NODE_ENV)" "development"
printf 'NODE_ENV=staging\n' > "$ST/d.env"; dev_env_defaults "$ST/d.env"
eq "dev env: 고른 값은 그대로"            "$(dotenv_get "$ST/d.env" NODE_ENV)" "staging"
llm_ours() { # $1=.env 내용 $2=4000 포트(0 열림 | 1 닫힘) → y|n
    local busy="$2"
    ( port_in_use() { return "$busy"; }; printf '%s' "$1" > "$ST/o.env"; dev_llm_is_ours "$ST/o.env" ) && echo y || echo n
}
eq "dev llm: 비어 있으면 omk 것"             "$(llm_ours '' 1)" "y"
eq "dev llm: 자리표시자는 omk 것"            "$(llm_ours $'LLM_BASE_URL=http://localhost:4000\n' 1)" "y"
eq "dev llm: 4000 에 실제 서버가 있으면 사용자 것" "$(llm_ours $'LLM_BASE_URL=http://localhost:4000\n' 0)" "n"
eq "dev llm: omk 게이트웨이 주소는 omk 것"   "$(llm_ours $'LLM_BASE_URL=http://127.0.0.1:13401\nOMK_LITELLM_PORT=13401\n' 1)" "y"
eq "dev llm: 직접 넣은 주소는 사용자 것"     "$(llm_ours $'LLM_BASE_URL=http://localhost:11434/v1\n' 1)" "n"

# ── 런타임 이미지 태그: 환경별, 기본 인스턴스는 소스 기본값(:latest) ──
eq "images dev"    "$(runtime_image_names dev)"    "openmake-mcp-runtime:dev openmake-task-runtime:dev"
eq "images online" "$(runtime_image_names online)" "openmake-mcp-runtime:latest openmake-task-runtime:latest"
RX="$TMP/rx"; mkdir -p "$RX"; printf 'OMK_RUNTIME_IMAGES=off\n' > "$RX/.env"
runtime_images_ensure "$RX" dev >/dev/null; eq "images: off 면 아무것도 안 함" "$RUNTIME_CHANGED|$(dotenv_get "$RX/.env" MCP_SANDBOX_IMAGE)" "0|"
# egress 프록시 이미지 — docker 는 가짜. 떠 있는 컨테이너의 소스 해시 라벨이 지금 소스와 다를 때만 지운다.
egress_calls() { # $1=.env 내용 $2=컨테이너의 라벨(none=컨테이너 없음, same=지금 소스의 해시) $3=빌드 종료 코드
    ( EG="$TMP/eg"; rm -rf "$EG"; mkdir -p "$EG/infra/egress-proxy"; printf '%s' "$1" > "$EG/.env"; printf 'x' > "$EG/infra/egress-proxy/proxy.mjs"
      EG_CUR="$2" EG_RC="$3"; [[ "$EG_CUR" != same ]] || EG_CUR="$(egress_proxy_src_hash "$EG")"
      docker() {
          case "$1 ${2:-}" in
              "build -q")          printf 'build %s %s;' "$4" "${7#"$EG"/}" >> "$EG/calls"; [[ "$6" == "omk.src=$(egress_proxy_src_hash "$EG")" ]] || printf 'BAD-LABEL;' >> "$EG/calls"; return "$EG_RC" ;;
              "container inspect") [[ "$EG_CUR" != none ]] && printf '%s' "$EG_CUR" || return 1 ;;
              "rm -f")             printf 'rm %s;' "$3" >> "$EG/calls" ;;
          esac
      }
      egress_proxy_image_ensure "$EG" >/dev/null 2>&1; cat "$EG/calls" 2>/dev/null )
}
eq "egress: 컨테이너 없으면 빌드만"        "$(egress_calls '' none 0)"         "build openmake-egress-proxy:latest infra/egress-proxy;"
eq "egress: 옛 이미지 컨테이너는 지운다"   "$(egress_calls '' '111-9' 0)" "build openmake-egress-proxy:latest infra/egress-proxy;rm omk-egress-proxy;"
eq "egress: 라벨 없는 컨테이너도 지운다"   "$(egress_calls '' '' 0)"      "build openmake-egress-proxy:latest infra/egress-proxy;rm omk-egress-proxy;"
eq "egress: 같은 소스면 그대로 둔다"       "$(egress_calls '' same 0)" "build openmake-egress-proxy:latest infra/egress-proxy;"
eq "egress: 빌드 실패면 컨테이너를 안 건드린다" "$(egress_calls '' '111-9' 1)" "build openmake-egress-proxy:latest infra/egress-proxy;"
eq "egress: .env 의 이미지·컨테이너 이름을 따른다" \
   "$(egress_calls $'TASK_SANDBOX_EGRESS_PROXY_IMAGE=my/proxy:1\nTASK_SANDBOX_EGRESS_PROXY_CONTAINER=my-proxy\n' '111-9' 0)" \
   "build my/proxy:1 infra/egress-proxy;rm my-proxy;"

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
dev_apply_hosts "$DL" "stage-box,100.1.2.3"
eq "cors gets host origins" "$(dotenv_get "$DL/.env" CORS_ORIGINS)" "http://localhost:3010,http://stage-box:3010,http://stage-box:52417,http://100.1.2.3:3010,http://100.1.2.3:52417"
eq "hosts remembered"       "$(dotenv_get "$DL/.env" OMK_DEV_HOSTS)" "stage-box,100.1.2.3"
C1="$(dotenv_get "$DL/.env" CORS_ORIGINS)"; dev_apply_hosts "$DL" "stage-box,100.1.2.3"
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
ok "generated upstream"   "grep -q 'reverse_proxy /generated/\* localhost:52417' '$OUT'"
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
ok "https: 생성 파일"       "grep -q 'reverse_proxy /generated/\* localhost:52416' '$HO'"
ok "https: 뷰어 블록"        "grep -q '^mac-mini.local:8443 {' '$HO'"
ok "https: 자리표시자 없음"  "! grep -q '{{' '$HO'"
eq "https: 공개 주소·쿠키"   "$(dotenv_get "$OL/.env" OMK_APP_URL)|$(dotenv_get "$OL/.env" COOKIE_SECURE)|$(dotenv_get "$OL/.env" ALLOW_INSECURE_COOKIES)" "https://mac-mini.local|true|false"
ok "https: CORS"             "[[ '$(dotenv_get "$OL/.env" CORS_ORIGINS)' == *'https://mac-mini.local'* ]]"
dotenv_unset "$OL/.env" OMK_HTTPS_HOST; https_render opsenv >/dev/null
ok "https: 끄면 블록 제거"   "[[ ! -f '$HO' ]]"

# ── 릴리스 게이트: 확인한 커밋에서 나온 릴리스만 통과 (임시 저장소 — 네트워크·실제 원격 없음) ──
GO="$TMP/gate-origin.git"; GW="$TMP/gate-work"; GC="$TMP/gate-online"
gg() { git -C "$GW" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }
gate_release() { # $1=버전 — release-please 가 하는 것처럼 버전·CHANGELOG 만 고친다
    sed -i.bak -E "s/\"version\": \"[0-9.]+\"/\"version\": \"$1\"/" "$GW/package.json" "$GW/apps/api/package.json" && rm -f "$GW/package.json.bak" "$GW/apps/api/package.json.bak"
    printf '{\n  ".": "%s"\n}\n' "$1" > "$GW/.release-please-manifest.json"; printf '## %s\n' "$1" >> "$GW/CHANGELOG.md"
    gg commit -qam "chore(main): release $1" && gg tag "v$1" && gg push -q origin main "v$1"
}
git init -q --bare "$GO"; git init -q "$GW"; gg checkout -q -b main; gg remote add origin "$GO"; mkdir -p "$GW/apps/api"
printf '{\n  "packages": { ".": { "changelog-path": "CHANGELOG.md", "extra-files": [ { "type": "json", "path": "apps/api/package.json", "jsonpath": "$.version" } ] } }\n}\n' > "$GW/release-please-config.json"
printf '{\n  "name": "x",\n  "version": "1.0.0",\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n' > "$GW/package.json"; cp "$GW/package.json" "$GW/apps/api/package.json"
printf '{\n  ".": "1.0.0"\n}\n' > "$GW/.release-please-manifest.json"; printf '# log\n' > "$GW/CHANGELOG.md"; printf 'a\n' > "$GW/app.txt"
gg add -A; gg commit -qm "feat: a"; gg push -q origin main
eq "meta: 설정의 extra-files 를 읽는다" "$(release_meta_paths "$GW" HEAD | LC_ALL=C sort | tr '\n' ' ')" ".release-please-manifest.json CHANGELOG.md CHANGELOG.md apps/api/package.json package-lock.json package.json "
V1="$(gg rev-parse HEAD)"
verified_push "$GW" origin >/dev/null 2>&1
eq "verify: origin 에 기록" "$(git -C "$GO" rev-parse "refs/omk/verified/$V1" 2>/dev/null)" "$V1"
ok "verify: 다시 해도 무해" 'verified_push "$GW" origin >/dev/null 2>&1'
gate_release 1.0.1
git clone -q "$GO" "$GC" 2>/dev/null
ok "gate: 기록을 받기 전에는 거부" '! release_gate_check "$GC" v1.0.1'
ok "gate: 이유 — 기록 없음"        '[[ "$GATE_REASON" == *"확인 기록이 없습니다"* ]]'
release_gate_fetch "$GC"
ok "gate: 확인한 커밋 + 릴리스 커밋 통과" 'release_gate_check "$GC" v1.0.1'
eq "gate: 근거 커밋"                "$GATE_VERIFIED" "$V1"
# 확인 뒤에 머지된 커밋이 릴리스에 들어갔다
printf 'b\n' >> "$GW/app.txt"; gg commit -qam "fix: b"; gate_release 1.0.2
git -C "$GC" fetch -q --tags; release_gate_fetch "$GC"
ok "gate: 확인하지 않은 커밋이 있으면 거부" '! release_gate_check "$GC" v1.0.2'
ok "gate: 이유에 커밋·경로"         '[[ "$GATE_REASON" == *"fix: b"* && "$GATE_REASON" == *"app.txt"* ]]'
ok "gate: 이전 릴리스는 여전히 통과" 'release_gate_check "$GC" v1.0.1'
# 태그 커밋 자체를 확인했으면(릴리스 뒤 staging 을 올려 확인) 그 태그는 통과한다
gg checkout -q v1.0.2; verified_push "$GW" origin >/dev/null 2>&1; gg checkout -q main; release_gate_fetch "$GC"
ok "gate: 태그 커밋을 확인했으면 통과" 'release_gate_check "$GC" v1.0.2'
# 릴리스 커밋에 의존성 변경이 섞였다 — 경로는 허용 목록이지만 내용이 버전이 아니다
verified_push "$GW" origin >/dev/null 2>&1
sed -i.bak 's/"a": "1.0.0"/"a": "2.0.0"/' "$GW/package.json" && rm -f "$GW/package.json.bak"; gate_release 1.0.3
git -C "$GC" fetch -q --tags; release_gate_fetch "$GC"
ok "gate: 버전 외 변경이 섞이면 거부" '! release_gate_check "$GC" v1.0.3'
ok "gate: 이유에 파일"               '[[ "$GATE_REASON" == *"package.json (버전 외 변경)"* ]]'
# 확인하지 않은 커밋이 허용 목록을 넓혀도 소용없다 (목록은 확인한 커밋에서 읽는다)
verified_push "$GW" origin >/dev/null 2>&1
sed -i.bak 's#"apps/api/package.json"#"app.txt"#' "$GW/release-please-config.json" && rm -f "$GW/release-please-config.json.bak"
printf 'c\n' >> "$GW/app.txt"; gate_release 1.0.4
git -C "$GC" fetch -q --tags; release_gate_fetch "$GC"
ok "gate: 허용 목록을 넓히는 커밋 거부" '! release_gate_check "$GC" v1.0.4'
ok "gate: 없는 태그 거부"             '! release_gate_check "$GC" v9.9.9'
# --force-unverified: 기록을 남기고 진행 / 없으면 종료 코드 2 로 끝낸다
( release_gate_enforce gateenv "$GC" v1.0.4 0 ) >/dev/null 2>&1; eq "enforce: 거부는 종료 코드 2" "$?" "2"
# shellcheck disable=SC2034  # confirm 이 읽는다
( ASSUME_YES=1; release_gate_enforce gateenv "$GC" v1.0.4 1 ) >/dev/null 2>&1; eq "enforce: force 는 진행" "$?" "0"
ok "enforce: force 기록"              "grep -q 'force-unverified v1.0.4' '$OMK_ROOT/gateenv/logs/release-gate.log'"
( release_gate_enforce gateenv "$GC" v1.0.1 0 ) >/dev/null 2>&1; eq "enforce: 확인된 릴리스 진행" "$?" "0"

# ── docker 접속: macOS 의 전용 Colima 를 강제하고 Linux 는 건드리지 않는다 ──
DH="$TMP/dh"; mkdir -p "$DH/.colima/openmake"
eq "docker host: 소켓이 없어도 Colima 선택" "$( unset DOCKER_HOST DOCKER_CONTEXT; omk_docker_host Darwin "$DH"; echo "$DOCKER_HOST" )" "unix://$DH/.colima/openmake/docker.sock"
eq "docker host: desktop 호스트와 컨텍스트 덮어씀" "$( DOCKER_HOST=unix:///desktop DOCKER_CONTEXT=desktop-linux; omk_docker_host Darwin "$DH"; echo "$DOCKER_HOST|${DOCKER_CONTEXT:-}" )" "unix://$DH/.colima/openmake/docker.sock|"
if python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "$DH/.colima/openmake/docker.sock" 2>/dev/null; then
    eq "docker host: Linux 는 그대로" "$( unset DOCKER_HOST; omk_docker_host Linux "$DH"; echo "${DOCKER_HOST:-}" )" ""
    eq "docker host: Linux 컨텍스트도 그대로" "$( DOCKER_HOST=tcp://x:1 DOCKER_CONTEXT=custom; omk_docker_host Linux "$DH"; echo "$DOCKER_HOST|$DOCKER_CONTEXT" )" "tcp://x:1|custom"
    eq "docker host: 항상 0"        "$( unset DOCKER_HOST; omk_docker_host Linux "$DH"; echo "$?" )" "0"
else
    FAIL=$((FAIL+1)); echo "FAIL docker host: 시험용 소켓을 만들지 못했다 (python3 없음 또는 경로가 너무 길다: $DH)"
fi

# ── 작업 workspace: 홈 아래(환경 디렉터리)로 — Colima 는 홈만 VM 에 공유한다 ──
SR="$TMP/sr"; mkdir -p "$SR"; : > "$SR/.env"
sandbox_root_ensure "$SR/.env" staging
eq "sandbox root: 기록"        "$(dotenv_get "$SR/.env" TASK_SANDBOX_ROOT)" "$OMK_ROOT/staging/task-workspaces"
ok "sandbox root: 디렉터리 생성" '[[ -d "$OMK_ROOT/staging/task-workspaces" ]]'
printf 'TASK_SANDBOX_ROOT=%s\n' "$SR/custom" > "$SR/.env"; sandbox_root_ensure "$SR/.env" staging
eq "sandbox root: 기존 값 존중"  "$(dotenv_get "$SR/.env" TASK_SANDBOX_ROOT)" "$SR/custom"
ok "sandbox root: 그 값의 디렉터리" '[[ -d "$SR/custom" ]]'
# 런타임 이미지 단계는 전용 Colima 를 쓰는 호스트에서만 workspace 를 옮긴다 — Linux·기존 설치본의 경로는 그대로
eq "uses colima: 전용 소켓"   "$( DOCKER_HOST="unix://$HOME/.colima/openmake/docker.sock"; uses_colima && echo y || echo n )" "y"
eq "uses colima: 미설정"      "$( unset DOCKER_HOST; uses_colima && echo y || echo n )" "n"
eq "uses colima: 다른 데몬"   "$( DOCKER_HOST=unix:///var/run/docker.sock; uses_colima && echo y || echo n )" "n"
eq "uses colima: 다른 프로필" "$( DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"; uses_colima && echo y || echo n )" "n"

# ── 실행 로그: 설치·갱신·리셋은 파일로도 남긴다 (tee 를 붙이지 않아도) ──
ok "log: env install"      'omk_log_wanted env install'
ok "log: env update"       'omk_log_wanted env update'
ok "log: env reset"        'omk_log_wanted env reset'
ok "log: dev setup"        'omk_log_wanted dev setup'
ok "log: dev reset"        'omk_log_wanted dev reset'
ok "log: dev up 은 아님 (포그라운드 서버)" '! omk_log_wanted dev up'
ok "log: env status 는 아님"  '! omk_log_wanted env status'
ok "log: env logs 는 아님"    '! omk_log_wanted env logs'
ok "log: 도움말은 아님"       '! omk_log_wanted help'
ok "log: 끄기 OMK_LOG=off"   '! ( OMK_LOG=off; omk_log_wanted env install )'
ok "log: 이미 기록 중이면 다시 감싸지 않는다" '! ( OMK_LOG_ACTIVE=1; omk_log_wanted env install )'
eq "log path: 환경 이름 포함" "$(omk_log_path 20260929-170000 env install staging --ref x)" "$OMK_ROOT/logs/omk/20260929-170000-env-install-staging.log"
eq "log path: 이름 없는 명령" "$(omk_log_path 20260929-170000 dev setup)"                  "$OMK_ROOT/logs/omk/20260929-170000-dev-setup.log"
eq "log path: 옵션은 이름이 아니다" "$(omk_log_path 20260929-170000 dev setup --no-searxng)" "$OMK_ROOT/logs/omk/20260929-170000-dev-setup.log"
eq "log path: 이상한 글자는 뺀다"  "$(omk_log_path 20260929-170000 env install '../x y')"   "$OMK_ROOT/logs/omk/20260929-170000-env-install-.._x_y.log"
eq "strip: 색 코드 제거" "$(printf '\033[32m[OK]\033[0m done\n' | omk_log_strip)" "[OK] done"
# 실제로 감싸 실행 — 화면 출력과 종료 코드는 그대로, 파일에는 색 없이
LG="$TMP/lg.log"
OUT="$( omk_log_run "$LG" bash -c 'printf "\033[32mhello\033[0m\n"; echo err >&2; exit 7' 2>&1 )"; RC=$?
eq "run: 종료 코드 유지" "$RC" "7"
ok "run: 화면에 출력"    '[[ "$OUT" == *hello* && "$OUT" == *err* ]]'
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q err "$LG" 2>/dev/null && break; sleep 0.2; done
eq "run: 파일에 색 없이" "$(grep -c '^hello$' "$LG")|$(grep -c '^err$' "$LG")" "1|1"
# GNU 형식을 먼저 본다 — Linux 의 `stat -f` 는 실패하지 않고 파일시스템 정보를 출력한다(그러면 뒤의 대안으로 넘어가지 않는다).
eq "run: 파일 권한 600" "$(stat -c '%a' "$LG" 2>/dev/null || stat -f '%Lp' "$LG")" "600"
# ── 래퍼: 'omk dev …' 는 작업 클론(~/.openmake 밖) 안에서 치면 그 클론의 omk.sh, 나머지는 설치본 ──
fake_omk() { mkdir -p "$1/scripts/env"; printf '#!/usr/bin/env bash\necho "%s $*"\n' "$2" > "$1/scripts/env/omk.sh"; }
fake_omk "$OMK_ROOT/staging/llm" installed
git init -q "$OMK_ROOT/staging/llm"; touch "$OMK_ROOT/staging/llm/openmake_llm.sh"
WC="$TMP/work/openmake_llm"; fake_omk "$WC" clone; git init -q "$WC"; touch "$WC/openmake_llm.sh"; mkdir -p "$WC/apps/api"
NC="$TMP/work/noscript"; mkdir -p "$NC"; git init -q "$NC"; touch "$NC/openmake_llm.sh"
install_wrapper >/dev/null
W="$OMK_ROOT/bin/omk"
eq "wrapper: 클론 하위 폴더의 dev 는 클론 것"   "$(cd "$WC/apps/api" && bash "$W" dev up api)" "clone dev up api"
eq "wrapper: 클론 안이라도 env 는 설치본"       "$(cd "$WC" && bash "$W" env status staging)" "installed env status staging"
eq "wrapper: 클론 밖의 dev 는 설치본"           "$(cd "$TMP" && bash "$W" dev up)"            "installed dev up"
eq "wrapper: ~/.openmake 안의 클론은 설치본"    "$(cd "$OMK_ROOT/staging/llm" && bash "$W" dev up)" "installed dev up"
eq "wrapper: omk.sh 없는 클론은 설치본"         "$(cd "$NC" && bash "$W" dev up)"             "installed dev up"
# 환경을 설치하지 않고 작업 클론만 쓰는 장비 — 'dev setup' 이 래퍼를 깐다 (무거운 단계는 가짜로)
printf '#!/usr/bin/env bash\nexit 0\n' > "$WC/install.sh"; chmod +x "$WC/install.sh"
DS_ROOT="$TMP/dsroot"
(
    OMK_ROOT="$DS_ROOT"
    # shellcheck disable=SC2034  # cmd_dev_setup 이 읽는다
    dev_locate() { DEV_LLM="$WC"; DEV_BENCH=""; }
    ensure_git() { :; }; dev_warn_legacy() { :; }; load_toolchain() { :; }; dev_build_packages() { :; }; dev_searxng() { :; }
    stack_ensure() { :; }; omk_docker_host() { :; }   # 실제 스택(SearXNG·이미지·기본 모델·PM2)을 띄우지 않는다
    cmd_dev_setup >/dev/null 2>&1
)
ok "dev setup: 래퍼 설치" '[[ -x "$DS_ROOT/bin/omk" ]]'
eq "dev setup 래퍼: 클론 안의 dev 는 클론 것" "$(cd "$WC" && OMK_ROOT="$DS_ROOT" bash "$DS_ROOT/bin/omk" dev up)" "clone dev up"
# ~/.openmake 를 지운 뒤 'dev up' 만 실행해도 래퍼가 돌아온다 — .env·node_modules 가 남아 있으면 setup 을 건너뛰기 때문
DU_ROOT="$TMP/duroot"
mkdir -p "$WC/node_modules"; : > "$WC/.env"
DU_SETUP_RAN="$(
    OMK_ROOT="$DU_ROOT"
    # shellcheck disable=SC2034  # cmd_dev_up 이 읽는다
    dev_locate() { DEV_LLM="$WC"; DEV_BENCH=""; }
    dev_warn_legacy() { :; }; load_toolchain() { :; }; dev_build_packages() { :; }; dev_apply_hosts() { :; }
    dev_compose() { :; }; dev_searxng() { :; }; dev_llm_up() { :; }; cmd_dev_status() { :; }   # 실제 스택을 띄우지 않는다
    cmd_dev_setup() { echo setup; }
    cmd_dev_up deps 2>/dev/null | grep -c '^setup$'
)"
eq "dev up: 준비된 클론이면 setup 을 건너뛴다" "$DU_SETUP_RAN" "0"
ok "dev up: 래퍼가 없으면 설치" '[[ -x "$DU_ROOT/bin/omk" ]]'
eq "dev up 래퍼: 클론 안의 dev 는 클론 것" "$(cd "$WC" && OMK_ROOT="$DU_ROOT" bash "$DU_ROOT/bin/omk" dev up 2>/dev/null)" "clone dev up"

# ── 웹 빌드: Next 는 rewrites(/api · /generated)의 대상을 빌드 때 굳힌다 — 빌드가 그 환경의 API 포트를 받아야 한다 ──
# (실행 때 넣은 API_PROXY_TARGET 은 이미 굳은 빌드본에 닿지 않는다. 기본 포트가 아닌 환경에서 생성 이미지가 500 이던 원인.)
BT="$TMP/buildtarget"; mkdir -p "$BT/bin"
cp "$HERE/../../openmake_llm.sh" "$BT/"
printf 'PORT=52417\n' > "$BT/.env"
printf '#!/usr/bin/env bash\nprintf "%%s" "${API_PROXY_TARGET:-}" > "%s/seen"\n' "$BT" > "$BT/bin/npm"; chmod +x "$BT/bin/npm"
( unset PORT API_PROXY_TARGET; PATH="$BT/bin:$PATH" bash "$BT/openmake_llm.sh" build --no-restart >/dev/null 2>&1 )
eq "build: API 포트를 프록시 대상으로 넘긴다" "$(cat "$BT/seen" 2>/dev/null)" "http://localhost:52417"
for f in install_linux.sh scripts/setup/mac/60-app.sh; do
    ok "build: $f 도 빌드에 넘긴다" "grep -q 'API_PROXY_TARGET=\"http://localhost:\$APP_PORT\" npm run build' '$HERE/../../$f'"
done

# ── 재시작: 이미 등록된 앱도 ecosystem.config.js 의 지금 정의로 다시 띄운다 ──
# `pm2 restart <이름>` 은 ecosystem 을 다시 읽지 않는다 — kill_timeout 을 10000→35000 으로 올린 변경이 기존
# 설치본에 닿지 않아 종료 절차가 10초에 SIGKILL 로 끊겼다(2026-10-11 staging 실측). 가짜 pm2 로 호출만 기록한다.
RS="$TMP/restarttarget"; mkdir -p "$RS/bin" "$RS/apps/api/dist"
cp "$HERE/../../openmake_llm.sh" "$RS/"; : > "$RS/apps/api/dist/cli.js"; : > "$RS/next.js"
printf 'OMK_INSTANCE=rs\nPORT=52499\nRS_FROM_DOTENV=fresh\n' > "$RS/.env"
cat > "$RS/ecosystem.config.js" <<'EOF'
const s = process.env.OMK_INSTANCE ? `-${process.env.OMK_INSTANCE}` : '';
module.exports = { apps: [
    { name: `openmake-llm${s}`, script: 'apps/api/dist/cli.js', cwd: __dirname, kill_timeout: 35000 },
    { name: `openmake-next${s}`, script: `${__dirname}/next.js`, cwd: __dirname },
    { name: `openmake-discord${s}`, script: 'apps/discord-bot/dist/index.js', cwd: __dirname },
] };
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$RS/bin/npm"
cat > "$RS/bin/pm2" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == jlist ]]; then cat "$RS/jlist"; exit 0; fi
printf '%s | cwd=%s | env=%s\n' "\$*" "\$PWD" "\${RS_FROM_DOTENV:-}" >> "$RS/pm2.log"
EOF
chmod +x "$RS/bin/npm" "$RS/bin/pm2"
rs_build() { : > "$RS/pm2.log"; ( unset OMK_INSTANCE RS_FROM_DOTENV; PATH="$RS/bin:$PATH" bash "$RS/openmake_llm.sh" build >/dev/null 2>&1 ); }
if has node; then
    printf '[{"name":"openmake-llm-rs"},{"name":"openmake-next-rs"}]' > "$RS/jlist"; rs_build
    eq "restart: 등록된 앱은 지우고 ecosystem 으로 다시 등록한다(이 앱만, .env 값은 셸로)" "$(cut -d'|' -f1,3 "$RS/pm2.log" | tr '\n' ';')" \
        "delete openmake-llm-rs | env=fresh;start ecosystem.config.js --only openmake-llm-rs | env=fresh;delete openmake-next-rs | env=fresh;start ecosystem.config.js --only openmake-next-rs | env=fresh;"
    ok "restart: ecosystem 은 설치본 디렉터리에서 평가한다" '[[ "$(grep -c "^start .*cwd=$RS " "$RS/pm2.log")" == 2 ]]'
    printf '[{"name":"openmake-llm-rs"}]' > "$RS/jlist"; rs_build
    ok "restart: 등록되지 않은 앱(next·discord)은 새로 띄우지 않는다" '! grep -qE "next|discord" "$RS/pm2.log"'
    # ecosystem 이 그 이름을 정의하지 않으면(이름이 어긋난 설치본) 지우지 않는다 — 지우면 다시 띄울 정의가 없다.
    printf '[{"name":"openmake-llm-rs"}]' > "$RS/jlist"; printf 'PORT=52499\nOMK_INSTANCE=rs\n' > "$RS/.env"
    ( cd "$RS" && sed -i.bak 's/openmake-llm\$/openmake-api$/' ecosystem.config.js ); rs_build
    eq "restart: ecosystem 에 없는 이름은 지우지 않고 예전처럼 재시작" "$(cut -d'|' -f1 "$RS/pm2.log" | tr '\n' ';')" "restart openmake-llm-rs --update-env ;"
    mv "$RS/ecosystem.config.js.bak" "$RS/ecosystem.config.js"; rm -f "$RS/apps/api/dist/cli.js"; rs_build
    eq "restart: 띄울 script 가 없으면 지우지 않는다" "$(cut -d'|' -f1 "$RS/pm2.log" | tr '\n' ';')" "restart openmake-llm-rs --update-env ;"
else echo "SKIP restart: ecosystem 재적용 (node 없음)"; fi
eq "restart: 이름만으로 재시작하는 곳은 폴백 한 곳뿐" "$(grep -cE '^[^#]*pm2 restart "\$' "$HERE/../../openmake_llm.sh")" "1"
# 스크립트가 만드는 이름과 실제 ecosystem 이 만드는 이름이 같아야 --only 가 맞는 앱을 집는다.
if ( cd "$HERE/../.." && node -e 'require("./ecosystem.config.js")' ) >/dev/null 2>&1; then
    eq "restart: ecosystem 의 앱 이름 = 스크립트의 앱 이름" \
        "$( cd "$HERE/../.." && OMK_INSTANCE=rs node -e 'console.log(require("./ecosystem.config.js").apps.slice(0,2).map(a=>a.name).join(" "))' )" "openmake-llm-rs openmake-next-rs"
else echo "SKIP restart: 실제 ecosystem 이름 대조 (의존성 없음)"; fi

# ── 스모크: 갱신 직후 설치본이 실제로 도는지 사람 없이 본다 (네트워크는 건드리지 않는다 — smoke_code 를 갈아 끼운다) ──
SM="$OMK_ROOT/smk/llm"; mkdir -p "$SM/apps/web/.next"
printf 'PORT=52417\nOMK_WEB_PORT=3010\n' > "$SM/.env"
printf '{"rewrites":{"beforeFiles":[],"afterFiles":[{"source":"/api/:path*","destination":"http://localhost:52417/api/:path*"},{"source":"/generated/:path*","destination":"http://localhost:52417/generated/:path*"}],"fallback":[]}}' > "$SM/apps/web/.next/routes-manifest.json"
eq "smoke: 빌드본의 API 포트를 읽는다"   "$(web_manifest_api_port "$SM")" "52417"
eq "smoke: 빌드본이 없으면 빈 값"        "$(web_manifest_api_port "$TMP/없는-설치본")" ""
ok "smoke: 빌드본 포트가 .env 와 같으면 통과" 'smoke_check_manifest "$SM"'
printf 'PORT=52418\nOMK_WEB_PORT=3010\n' > "$SM/.env"
ok "smoke: 빌드본 포트가 다르면 실패"    '! smoke_check_manifest "$SM"'
ok "smoke: 실패 이유에 두 포트를 적는다" '[[ "$SMOKE_WHY" == *52417* && "$SMOKE_WHY" == *52418* ]]'
printf 'PORT=52417\nOMK_WEB_PORT=3010\n' > "$SM/.env"
eq "smoke: JSON 문자열 이스케이프" "$(json_str 'a"b\c')" '"a\"b\\c"'
ok "smoke: 계정이 없으면 로그인 실패"    '! smoke_check_login "$SM"'
ok "smoke: 계정이 없다고 이유를 적는다"  '[[ "$SMOKE_WHY" == *OMK_SMOKE_EMAIL* ]]'
ok "smoke: 로그인 없이는 채팅을 건너뛴다" '! ( SMOKE_TOKEN=""; smoke_check_chat "$SM" )'
# /generated 는 웹 포트로 묻는다 — API 까지 닿으면 없는 파일은 404, 빌드본이 엉뚱한 포트를 보면 500 이다.
eq "smoke: /generated 404 는 통과" "$( smoke_code() { printf 404; }; smoke_check_generated "$SM" && echo ok )" "ok"
eq "smoke: /generated 500 은 실패" "$( smoke_code() { printf 500; }; smoke_check_generated "$SM" || echo fail )" "fail"
eq "smoke: /generated 는 웹 포트로 묻는다" "$( smoke_code() { printf '%s' "$2" > "$TMP/gen-url"; printf 404; }; smoke_check_generated "$SM"; cat "$TMP/gen-url" )" "http://localhost:3010/generated/omk-smoke-none.png"
git init -q "$SM" && git -C "$SM" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m x
SM_SHA="$(git -C "$SM" rev-parse HEAD)"
SM_RC="$(
    load_toolchain() { :; }
    smoke_check_health() { return 0; }; smoke_check_manifest() { return 0; }; smoke_check_generated() { return 0; }
    smoke_check_login() { return 0; }; smoke_check_ready() { return 0; }; smoke_check_chat() { return 0; }
    cmd_env_smoke smk >/dev/null 2>&1; echo $?
)"
eq "smoke: 전부 통과하면 0" "$SM_RC" "0"
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
SM_OUT="$(
    load_toolchain() { :; }
    smoke_check_health() { return 0; }; smoke_check_manifest() { SMOKE_WHY=포트; return 1; }; smoke_check_generated() { echo ran-generated; return 0; }
    smoke_check_login() { return 0; }; smoke_check_ready() { return 0; }; smoke_check_chat() { return 0; }
    cmd_env_smoke smk 2>&1; echo "rc=$?"
)"
ok "smoke: 하나라도 실패하면 3"        '[[ "$SM_OUT" == *rc=3* ]]'
ok "smoke: 실패해도 나머지 항목을 본다" '[[ "$SM_OUT" == *ran-generated* ]]'

# ── /ready: 쓰기 없는 준비 확인(LLM 노드·DB·기본 모델) — 릴리스 환경은 채팅 대신 이것으로 연결을 본다 ──
eq "smoke ready: 200 은 통과" "$( OMK_SMOKE_READY_WAIT=0; smoke_code() { printf '{}' > "$1"; printf 200; }; smoke_check_ready "$SM" && echo ok )" "ok"
eq "smoke ready: API 포트의 /ready 로 묻는다" "$( OMK_SMOKE_READY_WAIT=0; smoke_code() { printf '%s' "$2" > "$TMP/ready-url"; printf 200; }; smoke_check_ready "$SM"; cat "$TMP/ready-url" )" "http://localhost:52417/ready"
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
SR_WHY="$( OMK_SMOKE_READY_WAIT=0
    smoke_code() { printf '{"success":true,"data":{"ready":false,"onlineNodes":1,"dbConnected":true,"defaultModel":{"id":"x","listed":false}}}' > "$1"; printf 503; }
    smoke_check_ready "$SM" || printf '%s' "$SMOKE_WHY" )"
ok "smoke ready: 503 은 실패, 이유에 무엇이 안 됐는지" '[[ "$SR_WHY" == *"/ready → 503"* && "$SR_WHY" == *"기본 모델"* && "$SR_WHY" != *"DB 연결"* ]]'
# shellcheck disable=SC2034  # OMK_SMOKE_READY_WAIT 는 smoke_check_ready 가 읽는다
SR_N="$( OMK_SMOKE_READY_WAIT=3; sleep() { :; }
    smoke_code() { local n; n=$(( $(cat "$TMP/ready-n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$TMP/ready-n"; printf '{}' > "$1"; [[ $n -ge 2 ]] && printf 200 || printf 503; }
    rm -f "$TMP/ready-n"; smoke_check_ready "$SM" && cat "$TMP/ready-n" )"
eq "smoke ready: 재기동 직후 503 이면 기다렸다 다시 본다" "$SR_N" "2"

# ── 검사 고르기: 릴리스를 따르는 환경은 쓰기 없는 검사만(채팅 제외), 그 밖은 채팅까지 ──
eq "smoke: 브랜치 환경은 채팅까지" "$(smoke_checks_for "$SM")" "health manifest generated login ready chat"
printf 'OMK_TRACK=release\n' >> "$SM/.env"
eq "smoke: 릴리스 환경은 채팅 제외" "$(smoke_checks_for "$SM")" "health manifest generated login ready"
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
SM_REL="$(
    load_toolchain() { :; }
    smoke_check_health() { return 0; }; smoke_check_manifest() { return 0; }; smoke_check_generated() { return 0; }
    smoke_check_login() { return 0; }; smoke_check_ready() { echo ran-ready; return 0; }; smoke_check_chat() { echo ran-chat; return 0; }
    cmd_env_smoke smk 2>&1; echo "rc=$?"
)"
ok "smoke: 릴리스 환경은 채팅을 보내지 않는다" '[[ "$SM_REL" == *ran-ready* && "$SM_REL" != *ran-chat* && "$SM_REL" == *rc=0* ]]'
printf 'PORT=52417\nOMK_WEB_PORT=3010\n' > "$SM/.env"

# ── 결과 표지: 확인한 커밋에 GitHub 커밋 상태를 붙인다 (dev → main 자동 머지의 필수 체크가 읽는다) ──
eq "status: https 원격"  "$( git -C "$SM" remote add origin https://github.com/openmake/openmake_llm.git; status_repo_slug "$SM" )" "openmake/openmake_llm"
eq "status: ssh 원격"    "$( git -C "$SM" remote set-url origin git@github.com:openmake/openmake_llm.git; status_repo_slug "$SM" )" "openmake/openmake_llm"
eq "status: 표지 이름"   "$(status_context staging)" "omk/env-staging"
ok "status: 토큰이 없으면 붙이지 않는다" '! status_post "$SM" smk "$SM_SHA" success ok >/dev/null 2>&1'
printf 'OMK_STATUS_TOKEN=t0ken\n' >> "$SM/.env"
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
ST_ARGS="$( curl() { printf '%s\n' "$@" > "$TMP/st-args"; printf 201; }; status_post "$SM" smk "$SM_SHA" failure "채팅 실패" >/dev/null 2>&1; cat "$TMP/st-args" )"
ok "status: 그 커밋의 statuses 로 보낸다" '[[ "$ST_ARGS" == *"/repos/openmake/openmake_llm/statuses/$SM_SHA"* ]]'
ok "status: 표지 이름과 결과를 담는다"    '[[ "$ST_ARGS" == *"\"context\":\"omk/env-smk\""* && "$ST_ARGS" == *"\"state\":\"failure\""* ]]'
ok "status: 토큰을 헤더로 보낸다"         '[[ "$ST_ARGS" == *"Authorization: Bearer t0ken"* ]]'
ok "status: 201 이 아니면 실패"           '! ( curl() { printf 403; }; status_post "$SM" smk "$SM_SHA" success ok >/dev/null 2>&1 )'
ST_N="$(
    status_post() { echo post; }
    status_report smk "$SM_SHA" success ok; status_report smk "$SM_SHA" success ok; status_report smk "$SM_SHA" failure 실패
)"
eq "status: 같은 커밋·같은 결과는 한 번만" "$(printf '%s\n' "$ST_N" | grep -c post)" "2"
rm -f "$(status_marker smk)"
( status_post() { return 1; }; status_report smk "$SM_SHA" success ok ) >/dev/null 2>&1
ok "status: 못 붙였으면 기억하지 않는다" '[[ ! -f "$(status_marker smk)" ]]'

# ── 갱신 → 스모크 → 표지 (autoupdate 가 부른다) ──
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
UR="$(
    cmd_env_update() { return 2; }; status_report() { echo "report $2 $3"; }; cmd_env_smoke() { echo smoke; }
    env_update_report smk --if-behind >/dev/null 2>&1; echo "rc=$?"
    env_update_report smk --if-behind 2>/dev/null
)"
ok "report: 갱신 실패는 실패 표지"       '[[ "$UR" == *"report $SM_SHA failure"* ]]'
ok "report: 갱신 실패면 스모크를 돌리지 않는다" '[[ "$UR" != *smoke* ]]'
ok "report: 갱신 실패의 종료 코드를 넘긴다" '[[ "$UR" == *rc=2* ]]'
rm -f "$(status_marker smk)"
eq "report: 갱신 뒤 스모크를 표지와 함께" "$( cmd_env_update() { :; }; cmd_env_smoke() { echo "smoke $*"; }; env_update_report smk --if-behind 2>/dev/null )" "smoke smk --report"
printf '%s success' "$SM_SHA" > "$(status_marker smk)"
eq "report: 통과를 기록한 커밋은 다시 보지 않는다" "$( cmd_env_update() { :; }; cmd_env_smoke() { echo smoke; }; env_update_report smk --if-behind 2>/dev/null )" ""
printf '%s failure' "$SM_SHA" > "$(status_marker smk)"
eq "report: 실패로 남은 커밋은 다시 본다" "$( cmd_env_update() { :; }; cmd_env_smoke() { echo smoke; }; env_update_report smk --if-behind 2>/dev/null )" "smoke"
rm -f "$(status_marker smk)"
# pull 은 됐는데 빌드가 실패한 커밋은 HEAD 가 이미 원격과 같다 — 다음 주기에 "최신이면 건너뛰기"를 그대로 두면
# 갱신 없이 예전 빌드본을 스모크해 그 커밋에 통과를 붙인다. 지난 갱신이 실패했으면 건너뛰지 않고 다시 갱신한다.
( cmd_env_update() { return 2; }; status_report() { :; }; env_update_report smk --if-behind --yes ) >/dev/null 2>&1
ok "report: 갱신 실패를 기억한다" '[[ -f "$(update_failed_marker smk)" ]]'
eq "report: 지난 갱신이 실패했으면 건너뛰지 않고 다시 배포까지 한다" \
    "$( cmd_env_update() { echo "update $*"; }; cmd_env_smoke() { :; }; env_update_report smk --if-behind --yes 2>/dev/null )" "update smk --yes --redeploy"
( cmd_env_update() { :; }; cmd_env_smoke() { :; }; env_update_report smk --if-behind --yes ) >/dev/null 2>&1
ok "report: 갱신이 되면 기억을 지운다" '[[ ! -f "$(update_failed_marker smk)" ]]'
eq "report: 평소에는 최신이면 건너뛴다" \
    "$( cmd_env_update() { echo "update $*"; }; cmd_env_smoke() { :; }; env_update_report smk --if-behind --yes 2>/dev/null )" "update smk --if-behind --yes"
rm -f "$(status_marker smk)"
# --redeploy: 하위 openmake_llm.sh 가 실제로 다시 빌드·배포하는가 — 래퍼 인자만 보던 테스트는 "HEAD 같음 → deploy 생략" 을 놓쳤다
RD="$TMP/redeploy"; mkdir -p "$RD/.git"
printf '#!/usr/bin/env bash\necho "osh $*" >> "%s/calls"\n' "$RD" > "$RD/openmake_llm.sh"; chmod +x "$RD/openmake_llm.sh"
redeploy_probe() { # $1=트랙(release|"") $2=릴리스가 앞섰나(0|1) $3…=update 인자 → openmake_llm.sh 호출 기록
    : > "$RD/calls"
    ( RP_TRACK="$1" RP_BEHIND="$2"; shift 2   # cmd_env_update 의 지역 변수(track)와 이름이 겹치면 동적 범위로 가려진다
      log_info() { :; }; log_ok() { :; }; log_step() { :; }; log_warn() { :; }
      llm_dir() { echo "$RD"; }; bench_dir() { echo "$TMP/no-bench"; }; load_toolchain() { :; }
      dotenv_get() { [[ "$2" == OMK_TRACK ]] && echo "$RP_TRACK"; return 0; }
      release_behind() { [[ "$RP_BEHIND" == 1 ]]; }; repo_behind() { return 1; }
      restore_lockfiles() { :; }; searxng_ensure() { :; }; env_backup_run() { :; }; release_gate_enforce() { :; }
      runtime_images_ensure() { RUNTIME_CHANGED=0; }; ops_sandbox_guard() { :; }; litellm_dir() { echo "$TMP/no-litellm"; }
      bench_update() { :; }; proxy_dir() { echo "$TMP/no-proxy"; }
      git() { case "$*" in *"merge -q --ff-only"*) return 0 ;; *"rev-parse HEAD"*) echo deadbeef ;; *) command git "$@" ;; esac; }
      lockfile_changed() { [[ "${RP_LOCK:-0}" == 1 ]]; }; deps_install() { echo "deps" >> "$RD/calls"; }
      # shellcheck disable=SC2034  # cmd_env_update 가 읽는다
      RELEASE_TAG=v9.9.9; cmd_env_update smk "$@" ) >/dev/null 2>&1
    tr '\n' '|' < "$RD/calls"
}
eq "redeploy: 일반 트랙은 update --force"            "$(redeploy_probe '' 0 --yes --redeploy)" "osh update --yes --force|"
eq "redeploy: 일반 트랙 평소엔 종전 그대로"          "$(redeploy_probe '' 0 --yes)" "osh update --yes|"
eq "redeploy: 릴리스가 최신이어도 다시 deploy"       "$(redeploy_probe release 0 --yes --redeploy)" "osh deploy --yes|"
eq "redeploy: 릴리스가 최신이면 평소엔 생략"         "$(redeploy_probe release 0 --yes)" ""
eq "redeploy: 릴리스가 앞섰으면 종전대로 한 번 deploy" "$(redeploy_probe release 1 --yes --redeploy)" "osh deploy --yes|"
# 릴리스 track: ff 로 받은 범위에 package-lock.json 이 있으면 deploy 전에 의존성을 맞춘다 — 최신이면(ff 없음) 설치하지 않는다
eq "deps: 릴리스 ff 가 lock 을 바꿨으면 설치 → deploy"   "$(RP_LOCK=1 redeploy_probe release 1 --yes)" "deps|osh deploy --yes|"
eq "deps: lock 그대로면 종전대로 deploy 만"              "$(RP_LOCK=0 redeploy_probe release 1 --yes)" "osh deploy --yes|"
eq "deps: 최신(ff 없음)이면 --redeploy 여도 설치 안 함"   "$(RP_LOCK=1 redeploy_probe release 0 --yes --redeploy)" "osh deploy --yes|"
# 승격 워크플로: main 의 필수 체크에 환경 dev 의 표지가 없으면 자동 머지를 걸지 않는다 — 걸면 CI 만으로 main 에 들어간다.
PW="$HERE/../../.github/workflows/promote.yml"
ok "promote: 필수 체크에 omk/env-dev 가 있는지 본다" "grep -q 'required_status_checks.contexts' '$PW' && grep -q 'index(\"omk/env-dev\")' '$PW'"
ok "promote: 그 확인이 자동 머지보다 앞에 있다" "[[ \$(grep -n 'index(\"omk/env-dev\")' '$PW' | head -1 | cut -d: -f1) -lt \$(grep -n 'gh pr merge' '$PW' | head -1 | cut -d: -f1) ]]"
# autoupdate: 표지 토큰을 넣은 환경만 갱신 뒤 스모크·표지까지 간다 — 토큰이 없으면 지금까지와 같다.
mkdir -p "$SM/scripts/env"; : > "$SM/scripts/env/omk.sh"
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
AU="$( load_toolchain() { :; }; require_pm2() { :; }; pm2() { [[ "$1" != start ]] || printf '%s ' "$@" > "$TMP/pm2-args"; [[ "$1" != describe ]]; }; cmd_env_autoupdate smk >/dev/null 2>&1; cat "$TMP/pm2-args" )"
ok "autoupdate: 토큰이 있으면 --report"  '[[ "$AU" == *"env update smk --if-behind --yes --report"* ]]'
printf 'PORT=52417\n' > "$SM/.env"
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
AU="$( load_toolchain() { :; }; require_pm2() { :; }; pm2() { [[ "$1" != start ]] || printf '%s ' "$@" > "$TMP/pm2-args"; [[ "$1" != describe ]]; }; cmd_env_autoupdate smk >/dev/null 2>&1; cat "$TMP/pm2-args" )"
ok "autoupdate: 토큰이 없으면 예전 그대로" '[[ "$AU" == *"--if-behind --yes "* && "$AU" != *--report* ]]'

# ── 뷰어: exporter 의 .env 경로를 vendor 준비와 nginx mount 에 함께 전달 ──
viewer_data_probe() {
    local probe="$TMP/viewer-probe" configured="$1"
    mkdir -p "$probe/infra/artifact-viewer"
    printf 'OMK_ARTIFACT_VIEWER=1\nPORT=52416\n' > "$probe/.env"
    [[ -z "$configured" ]] || printf 'ARTIFACT_VIEWER_DATA_DIR="%s"\n' "$configured" >> "$probe/.env"
    [[ -z "${3:-}" ]] || printf '%s\n' "$3" >> "$probe/.env"
    printf '#!/usr/bin/env bash\nprintf "vendor:%%s\\n" "${ARTIFACT_VIEWER_DATA_DIR:-UNSET}" >> "$VIEWER_PROBE_LOG"\n' > "$probe/infra/artifact-viewer/fetch-vendor.sh"
    : > "$probe/calls"
    ( export VIEWER_PROBE_LOG="$probe/calls"
      if [[ $# -ge 2 && "$2" != __UNSET__ ]]; then export ARTIFACT_VIEWER_DATA_DIR="$2"; else unset ARTIFACT_VIEWER_DATA_DIR; fi
      docker() {
          [[ "$1" != compose ]] || {
              printf 'compose:%s\n' "${ARTIFACT_VIEWER_DATA_DIR:-UNSET}" >> "$VIEWER_PROBE_LOG"
              printf 'arg:%s\n' "$@" >> "$VIEWER_PROBE_LOG"
          }
          return 0
      }
      viewer_ensure "$probe"
    ) >/dev/null 2>&1
    cat "$probe/calls"
}
VD="$(viewer_data_probe "$TMP/published artifacts")"
eq "viewer: vendor 와 compose 에 설정 경로 전달(공백 포함)" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:%s\ncompose:%s' "$TMP/published artifacts" "$TMP/published artifacts")"
eq "viewer: compose 가 앱 .env 를 명시적으로 읽음" "$(printf '%s\n' "$VD" | grep -A1 '^arg:--env-file$')" "$(printf 'arg:--env-file\narg:%s' "$TMP/viewer-probe/.env")"
VD="$(viewer_data_probe '')"
eq "viewer: 미설정 시 같은 repo 기본 경로 사용" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:%s\ncompose:%s' "$TMP/viewer-probe/data/artifact-viewer" "$TMP/viewer-probe/data/artifact-viewer")"
VD="$(viewer_data_probe 'data/published artifacts')"
eq "viewer: 상대 경로도 앱 repo 기준으로 mount" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:%s\ncompose:%s' "$TMP/viewer-probe/data/published artifacts" "$TMP/viewer-probe/data/published artifacts")"
VD="$(viewer_data_probe "$TMP/from-file" "$TMP/from-shell")"
eq "viewer: shell 환경이 .env 보다 우선" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:%s\ncompose:%s' "$TMP/from-shell" "$TMP/from-shell")"
VD="$(viewer_data_probe '' __UNSET__ 'ARTIFACT_VIEWER_DATA_DIR=/data/artifacts # publications')"
eq "viewer: 인라인 주석은 경로에 포함하지 않음" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:/data/artifacts\ncompose:/data/artifacts')"
VD="$(viewer_data_probe '' __UNSET__ 'ARTIFACT_VIEWER_DATA_DIR="/data/hash # file" # publications')"
eq "viewer: 따옴표 내부 hash 는 보존하고 외부 주석만 제거" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:/data/hash # file\ncompose:/data/hash # file')"
VD="$(viewer_data_probe "$TMP/from-file" '')"
eq "viewer: 명시적인 빈 shell 환경이면 backend 기본 경로 사용" "$(printf '%s\n' "$VD" | head -2)" "$(printf 'vendor:%s\ncompose:%s' "$TMP/viewer-probe/data/artifact-viewer" "$TMP/viewer-probe/data/artifact-viewer")"

echo ""; echo "omk.test: $PASS passed, $FAIL failed (bash $BASH_VERSION)"
[[ $FAIL -eq 0 ]]
