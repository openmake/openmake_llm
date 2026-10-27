#!/usr/bin/env bash
# openmake_llm.sh 의 compose 환경 파일 선택 테스트 — 실제 docker·PM2·네트워크·DB 를 건드리지 않는다.
# 임시 폴더에 스크립트를 복사하고, PATH 앞의 가짜 docker/docker-compose/pm2/npm/npx 가 호출 인자를 한 원소씩 기록한다.
# 기본 compose(infra/docker-compose.yml)는 앱 .env, 외부 compose 는 자기 옆 .env(없으면 /dev/null) 하나만 받아야 한다 —
# 외부 compose 에 앱 .env 를 넘기면 외부의 POSTGRES_IMAGE 가 앱 값으로 덮여 deploy 가 DB 이미지를 바꾼다.
#   bash scripts/env/deploy-compose-env.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$HERE/../.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

# ── 가짜 실행 파일 ──
BIN="$TMP/bin"; mkdir -p "$BIN"
# compose: 인자를 [원소] 로 기록하고, 마지막 --env-file 의 POSTGRES_IMAGE 를 함께 남긴다(compose 는 뒤 파일이 이긴다).
# FAKE_NO_PLUGIN=1 이면 `docker compose version` 이 실패해 standalone 폴백을 탄다. FAKE_COMPOSE_RC 로 up/stop 실패를 만든다.
for name in docker docker-compose; do
    cat > "$BIN/$name" <<'EOF'
#!/usr/bin/env bash
name="$(basename "$0")"
if [[ "$name" == docker ]]; then
    [[ "${1:-}" == context ]] && exit 1
    if [[ "${1:-} ${2:-}" == "compose version" ]]; then [[ "${FAKE_NO_PLUGIN:-0}" == 1 ]] && exit 1; exit 0; fi
fi
line="$name" prev="" env_file="" image=""
for a in "$@"; do
    [[ "$prev" == --env-file ]] && env_file="$a"
    line="$line [$a]"; prev="$a"
done
[[ -n "$env_file" && -f "$env_file" ]] && image="$(grep -E '^POSTGRES_IMAGE=' "$env_file" | tail -1 | cut -d= -f2-)"
printf '%s image=%s\n' "$line" "$image" >> "$FAKE_LOG"
exit "${FAKE_COMPOSE_RC:-0}"
EOF
done
printf '#!/usr/bin/env bash\n[[ "${1:-}" == jlist ]] && echo "[]"\nexit 0\n' > "$BIN/pm2"
printf '#!/usr/bin/env bash\necho "$(basename "$0") $*" >> "$FAKE_LOG"\n' > "$BIN/npm"; cp "$BIN/npm" "$BIN/npx"
for name in curl node git lsof; do printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/$name"; done
chmod +x "$BIN"/*

# ── fixture: main 직전에 훅을 source 해 무거운 단계(PM2 앱·Caddy·Node 버전)만 갈아 끼운다 ──
# ensure_docker_service·compose_cmd·cmd_start/stop/deploy·start/stop_postgres/redis·cmd_build·cmd_migrate 는 실제 본문 그대로.
HOOK="$TMP/hook.sh"
cat > "$HOOK" <<'EOF'
require_node_version() { return 0; }
require_pm2_daemon_node_version() { return 0; }
start_app() { echo "start_app" >> "$FAKE_LOG"; }
stop_app() { echo "stop_app" >> "$FAKE_LOG"; }
wait_for_app_with_logs() { return 0; }
show_status() { return 0; }
follow_logs_if_tty() { return 0; }
sync_caddyfile() { return 0; }
EOF
mk_app() { # $1=앱 디렉터리 $2=앱 .env 내용(빈 값이면 .env 없음)
    mkdir -p "$1/scripts/lib" "$1/infra" "$1/apps/api"
    cp "$ROOT/scripts/lib/colima.sh" "$1/scripts/lib/"
    awk -v hook="$HOOK" '$0 == "main \"$@\"" { print ". \"" hook "\"" } { print }' "$ROOT/openmake_llm.sh" > "$1/openmake_llm.sh"
    : > "$1/infra/docker-compose.yml"
    if [[ -n "$2" ]]; then printf '%s\n' "$2" > "$1/.env"; fi
}
LOG="$TMP/calls.log"
run() { # $1=앱 $2=호출 cwd $3=COMPOSE_FILE(빈 값이면 스크립트 기본) $4…=명령 → 종료 코드 출력, 호출 기록은 $LOG
    local app="$1" cwd="$2" cf="$3"; shift 3
    : > "$LOG"
    ( cd "$cwd" || exit 99
      unset COMPOSE_FILE OMK_INSTANCE PORT POSTGRES_PORT REDIS_PORT POSTGRES_IMAGE OMK_DEPLOY_SKIP_CONFIRM
      if [[ -n "$cf" ]]; then export COMPOSE_FILE="$cf"; fi
      PATH="$BIN:$PATH" FAKE_LOG="$LOG" "$BASH" "$app/openmake_llm.sh" "$@" </dev/null >/dev/null 2>&1 )
    echo $?
}
calls() { tr '\n' ';' < "$LOG"; }
dc() { # $1=기대 이미지 $2…=argv → 가짜 compose 기록 한 줄
    local img="$1" s="$2" a; shift 2
    for a in "$@"; do s="$s [$a]"; done
    printf '%s image=%s' "$s" "$img"
}

APP_IMG="app-only/postgres:1"; EXT_IMG="ext-only/pgvector:1"
A="$TMP/app root"; mk_app "$A" "POSTGRES_IMAGE=$APP_IMG"
B="$TMP/app noenv"; mk_app "$B" ""
EXT="$TMP/ext dir"; mkdir -p "$EXT"; : > "$EXT/docker-compose.yml"; printf 'POSTGRES_IMAGE=%s\n' "$EXT_IMG" > "$EXT/.env"
BARE="$TMP/ext bare"; mkdir -p "$BARE"; : > "$BARE/docker-compose.yml"
CALLER="$TMP/caller dir"; mkdir -p "$CALLER"
ok "fixture: main 직전에 훅이 들어갔다" 'grep -qxF ". \"$HOOK\"" "$A/openmake_llm.sh"'

# ── 1. 기본 compose + 앱 .env: 기존처럼 앱 .env (상대 경로·다른 cwd·symlink 로 가리켜도 같은 정책) ──
eq "기본: 앱 .env 를 넘긴다" "$(run "$A" "$A" "" start)|$(calls)" \
    "0|$(dc "$APP_IMG" docker compose --env-file "$A/.env" -f "$A/infra/docker-compose.yml" up -d postgres);$(dc "$APP_IMG" docker compose --env-file "$A/.env" -f "$A/infra/docker-compose.yml" up -d redis);start_app;"
eq "기본: 상대 경로도 기본 정책" "$(run "$A" "$A" "infra/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$APP_IMG" docker compose --env-file "$A/.env" -f infra/docker-compose.yml up -d postgres)"
eq "기본: 다른 cwd 의 상대 경로도 기본 정책" "$(run "$A" "$CALLER" "../app root/infra/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$APP_IMG" docker compose --env-file "$A/.env" -f "../app root/infra/docker-compose.yml" up -d postgres)"
mkdir -p "$TMP/link dir"; ln -s "$A/infra/docker-compose.yml" "$TMP/link dir/compose.yml"
eq "기본: symlink 로 가리켜도 기본 정책" "$(run "$A" "$A" "$TMP/link dir/compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$APP_IMG" docker compose --env-file "$A/.env" -f "$TMP/link dir/compose.yml" up -d postgres)"
eq "기본: 앱 .env 가 없으면 --env-file 생략(기존)" "$(run "$B" "$B" "" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "" docker compose -f "$B/infra/docker-compose.yml" up -d postgres)"

# ── 2. 외부 compose + 양쪽 .env: 외부 .env 하나만, 앱 .env 는 넘기지 않는다 ──
eq "외부: 외부 .env 만 넘긴다(외부 이미지 유지)" "$(run "$A" "$A" "$EXT/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$EXT_IMG" docker compose --env-file "$EXT/.env" -f "$EXT/docker-compose.yml" up -d postgres)"
ok "외부: 앱 .env 는 어떤 인자에도 없다" '! grep -qF "[$A/.env]" "$LOG"'
eq "외부: --env-file 은 한 번만" "$(sed -n 1p "$LOG" | grep -o '\[--env-file\]' | wc -l | tr -d ' ')" "1"
C="$TMP/app compose-in-env"; EXTNS="$TMP/extns"; mkdir -p "$EXTNS"; : > "$EXTNS/docker-compose.yml"; printf 'POSTGRES_IMAGE=%s\n' "$EXT_IMG" > "$EXTNS/.env"
mk_app "$C" "$(printf 'POSTGRES_IMAGE=%s\nCOMPOSE_FILE=%s' "$APP_IMG" "$EXTNS/docker-compose.yml")"
eq "외부: 앱 .env 의 COMPOSE_FILE 로 지정해도 외부 .env 만" "$(run "$C" "$C" "" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$EXT_IMG" docker compose --env-file "$EXTNS/.env" -f "$EXTNS/docker-compose.yml" up -d postgres)"

# ── 3. 외부 .env 없음: /dev/null 로 자동 .env 유입을 막고 앱 .env 도 넘기지 않는다 ──
eq "외부 .env 없음: /dev/null" "$(run "$A" "$A" "$BARE/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "" docker compose --env-file /dev/null -f "$BARE/docker-compose.yml" up -d postgres)"
ok "외부 .env 없음: 앱 .env 는 어떤 인자에도 없다" '! grep -qF "[$A/.env]" "$LOG"'
mkdir -p "$TMP/extlink dir"; ln -s "$EXT/docker-compose.yml" "$TMP/extlink dir/docker-compose.yml"
eq "외부 symlink: 지정한 경로의 부모(.env 없음) 기준" "$(run "$A" "$A" "$TMP/extlink dir/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "" docker compose --env-file /dev/null -f "$TMP/extlink dir/docker-compose.yml" up -d postgres)"

# ── 4. 공백·상대 경로·다른 호출 cwd: 경로는 한 인자로, 상대 경로는 호출 cwd 기준 그대로 ──
eq "외부 상대 경로(다른 cwd): 공백 경로가 한 인자, cwd 기준 유지" "$(run "$A" "$CALLER" "../ext dir/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$EXT_IMG" docker compose --env-file "../ext dir/.env" -f "../ext dir/docker-compose.yml" up -d postgres)"
eq "외부 파일 이름만(compose 옆 cwd)" "$(run "$A" "$EXT" "docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$EXT_IMG" docker compose --env-file "./.env" -f docker-compose.yml up -d postgres)"

# ── 5. 실제 start/stop/deploy 경로 — 모든 compose 호출이 같은 규칙, deploy 는 빌드 → compose → 마이그레이션 ──
X=(--env-file "$EXT/.env" -f "$EXT/docker-compose.yml"); D=(--env-file "$A/.env" -f "$A/infra/docker-compose.yml")
eq "deploy(외부): 빌드 → postgres·redis up → 마이그레이션" "$(run "$A" "$A" "$EXT/docker-compose.yml" deploy --yes)|$(calls)" \
    "0|npm run build;$(dc "$EXT_IMG" docker compose "${X[@]}" up -d postgres);$(dc "$EXT_IMG" docker compose "${X[@]}" up -d redis);npx ts-node src/data/migrations/cli.ts status;npx ts-node src/data/migrations/cli.ts migrate;"
eq "deploy(기본): 빌드 → postgres·redis up → 마이그레이션" "$(run "$A" "$A" "" deploy --yes)|$(calls)" \
    "0|npm run build;$(dc "$APP_IMG" docker compose "${D[@]}" up -d postgres);$(dc "$APP_IMG" docker compose "${D[@]}" up -d redis);npx ts-node src/data/migrations/cli.ts status;npx ts-node src/data/migrations/cli.ts migrate;"
eq "start(외부): postgres·redis up → 앱" "$(run "$A" "$A" "$EXT/docker-compose.yml" start)|$(calls)" \
    "0|$(dc "$EXT_IMG" docker compose "${X[@]}" up -d postgres);$(dc "$EXT_IMG" docker compose "${X[@]}" up -d redis);start_app;"
eq "stop(외부): 앱 → redis·postgres stop" "$(run "$A" "$A" "$EXT/docker-compose.yml" stop)|$(calls)" \
    "0|stop_app;$(dc "$EXT_IMG" docker compose "${X[@]}" stop redis);$(dc "$EXT_IMG" docker compose "${X[@]}" stop postgres);"
eq "stop(기본): 앱 → redis·postgres stop" "$(run "$A" "$A" "" stop)|$(calls)" \
    "0|stop_app;$(dc "$APP_IMG" docker compose "${D[@]}" stop redis);$(dc "$APP_IMG" docker compose "${D[@]}" stop postgres);"

# ── 6. standalone 폴백·실패 처리 — 폴백도 같은 환경 파일, up 실패는 2, stop 실패는 경고만 ──
eq "폴백(외부): docker-compose 도 외부 .env 만" "$(export FAKE_NO_PLUGIN=1; run "$A" "$A" "$EXT/docker-compose.yml" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$EXT_IMG" docker-compose "${X[@]}" up -d postgres)"
eq "폴백(기본): docker-compose 도 앱 .env" "$(export FAKE_NO_PLUGIN=1; run "$A" "$A" "" start)|$(sed -n 1p "$LOG")" \
    "0|$(dc "$APP_IMG" docker-compose "${D[@]}" up -d postgres)"
eq "start: up 실패 → 2, 뒤 단계 없음" "$(export FAKE_COMPOSE_RC=1; run "$A" "$A" "$EXT/docker-compose.yml" start)|$(calls)" \
    "2|$(dc "$EXT_IMG" docker compose "${X[@]}" up -d postgres);"
eq "deploy: up 실패 → 2, 마이그레이션 없음" "$(export FAKE_COMPOSE_RC=1; run "$A" "$A" "$EXT/docker-compose.yml" deploy --yes)|$(calls)" \
    "2|npm run build;$(dc "$EXT_IMG" docker compose "${X[@]}" up -d postgres);"
eq "stop: stop 실패는 경고만(종료 0, 둘 다 시도)" "$(export FAKE_COMPOSE_RC=1; run "$A" "$A" "$EXT/docker-compose.yml" stop)|$(calls)" \
    "0|stop_app;$(dc "$EXT_IMG" docker compose "${X[@]}" stop redis);$(dc "$EXT_IMG" docker compose "${X[@]}" stop postgres);"

echo "deploy-compose-env: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
