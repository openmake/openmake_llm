#!/usr/bin/env bash
# uninstall.sh 의 승인 경로 테스트 — 실제 PM2·docker·파일을 건드리지 않는다.
# 임시 폴더에 uninstall.sh 를 복사하고(가짜 소스 표지 package.json·openmake_llm.sh 포함), PATH 앞의 가짜 pm2·docker 가
# 부른 명령만 기록한다. 입력은 /dev/null(비대화형)로 준다 — 터미널 입력의 y/N 은 여기서 다루지 않는다.
#   bash scripts/setup/uninstall.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

BIN="$TMP/bin"; mkdir -p "$BIN"
# 가짜 pm2 — 앱은 등록돼 있다고 답하고, 지우는 명령만 기록한다
cat > "$BIN/pm2" <<'EOF'
#!/usr/bin/env bash
case "$1" in describe) exit 0 ;; delete) echo "pm2 delete $2" >> "$CALLS" ;; esac
EOF
# 가짜 docker — 컨테이너가 있다고 답하고, 지우는 명령만 기록한다
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
    info) exit 0 ;;
    ps) printf 'openmake-postgres\nopenmake-redis\n' ;;
    rm|volume) echo "docker $*" >> "$CALLS" ;;
esac
EOF
chmod +x "$BIN/pm2" "$BIN/docker"

# 한 번 실행: $@ = uninstall.sh 인자 → "종료코드|기록된 명령(줄바꿈은 ;)|소스 남음(yes/no)"
run_uninstall() {
    local dir="$TMP/app-$RANDOM"; mkdir -p "$dir"
    mkdir -p "$dir/scripts/lib"; cp "$HERE/../lib/colima.sh" "$dir/scripts/lib/"
    cp "$HERE/../../uninstall.sh" "$dir/"; : > "$dir/package.json"; : > "$dir/openmake_llm.sh"; : > "$dir/.env"
    export CALLS="$TMP/calls-$RANDOM"; : > "$CALLS"
    local rc; ( cd "$TMP" && PATH="$BIN:$PATH" DOCKER_HOST=unix:///nonexistent bash "$dir/uninstall.sh" "$@" < /dev/null >/dev/null 2>&1 ); rc=$?
    printf '%s|%s|%s' "$rc" "$(tr '\n' ';' < "$CALLS")" "$([[ -d "$dir" ]] && echo yes || echo no)"
}

# ── 비대화형인데 --yes 가 없으면 아무것도 지우지 않고 멈춘다(종전: 전부 자동 승인) ──
eq "비대화형·--yes 없음: 종료 2, 아무것도 안 지움, 소스 남음" "$(run_uninstall)" "2||yes"
eq "비대화형·--keep-data 만: 역시 멈춘다" "$(run_uninstall --keep-data)" "2||yes"

# ── --yes 는 문서대로 전부 자동 승인 ──
# shellcheck disable=SC2034  # 아래 ok 의 eval 문자열이 읽는다
R="$(run_uninstall --yes)"
ok "--yes: 종료 0" '[[ "${R%%|*}" == 0 ]]'
ok "--yes: PM2 앱 둘을 지운다" '[[ "$R" == *"pm2 delete openmake-llm;"* && "$R" == *"pm2 delete openmake-next;"* ]]'
ok "--yes: 컨테이너를 지운다" '[[ "$R" == *"docker rm -f openmake-postgres;"* ]]'
ok "--yes: 볼륨을 지운다" '[[ "$R" == *"docker volume rm openmake_pgdata;"* ]]'
ok "--yes: 소스를 지운다" '[[ "$R" == *"|no" ]]'

# ── --yes 와 보존 옵션 ──
# shellcheck disable=SC2034
R="$(run_uninstall --yes --keep-data --keep-source)"
ok "--keep-data: 볼륨은 남긴다" '[[ "$R" != *"docker volume"* ]]'
ok "--keep-source: 소스는 남긴다" '[[ "$R" == *"|yes" ]]'
ok "--keep-*: PM2·컨테이너는 지운다" '[[ "$R" == *"pm2 delete openmake-llm;"* && "$R" == *"docker rm -f openmake-redis;"* ]]'

# ── 인스턴스 이름이 지울 대상에 반영된다 ──
# shellcheck disable=SC2034
R="$(run_uninstall --yes --keep-source --instance qa)"
ok "--instance qa: 이름이 붙은 앱·볼륨만" '[[ "$R" == *"pm2 delete openmake-llm-qa;"* && "$R" == *"openmake-qa_pgdata"* ]]'

printf '\nuninstall.test: %d passed, %d failed (bash %s)\n' "$PASS" "$FAIL" "$BASH_VERSION"
[[ $FAIL -eq 0 ]]
