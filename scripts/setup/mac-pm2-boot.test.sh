#!/usr/bin/env bash
# 대역 전역은 source 한 mac-pm2-boot.sh 가 읽는다.
# shellcheck disable=SC2034
# mac-pm2-boot.sh · pm2-boot-guard.sh 시험 — 가짜 pm2·docker·launchctl 로 임시 HOME 만 바꾼다.
# 실제 PM2·launchd·컨테이너·sudo 는 호출하지 않는다. plist 검사(plutil)가 macOS 전용이라 macOS 에서만 돈다.
#   bash scripts/setup/mac-pm2-boot.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(uname -s)" != Darwin ]] || ! command -v plutil >/dev/null 2>&1; then echo "SKIP mac-pm2-boot.test (macOS 전용)"; exit 0; fi
command -v node >/dev/null 2>&1 || { echo "SKIP mac-pm2-boot.test (node 없음)"; exit 0; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "${LCTL_STATE:-}"' EXIT

HOME="$TMP/home & 'x'"; mkdir -p "$HOME"
OMK_ROOT="$HOME/.openmake"
export PM2_HOME="$TMP/pm2 home"; mkdir -p "$PM2_HOME"
export COLIMA_HOME="$TMP/Ext & Colima"; mkdir -p "$COLIMA_HOME/openmake"; : > "$COLIMA_HOME/openmake/colima.yaml"
APPS="$TMP/Volumes/APP disk/openmake_llm"
BIN="$TMP/bin"; ST="$TMP/state"; mkdir -p "$BIN" "$ST"
ln -s "$(command -v node)" "$BIN/node"

# 가짜 pm2 — 실제 pm2 처럼 node 스크립트다. 실행 중 앱 이름은 $ST/running, 호출은 $ST/pm2-calls.
cat > "$BIN/pm2" <<'PM2'
#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const ST = path.join(__dirname, "..", "state"), cmd = process.argv[2] || "";
const dump = path.join(process.env.PM2_HOME, "dump.pm2"), running = path.join(ST, "running");
fs.appendFileSync(path.join(ST, "pm2-calls"), `${process.argv.slice(2).join(" ")} PM2_HOME=${process.env.PM2_HOME}\n`);
fs.writeFileSync(path.join(ST, "pm2-env"), Object.keys(process.env).join("\n"));
const names = () => fs.readFileSync(running, "utf8").split("\n").filter(Boolean);
if (cmd === "jlist") process.stdout.write(JSON.stringify(names().map(n => ({ name: n, pm2_env: { status: "online" } }))));
else if (cmd === "resurrect") {
  if (!fs.existsSync(path.join(ST, "resurrect-broken"))) {
    const cur = new Set(names());
    for (const p of JSON.parse(fs.readFileSync(dump, "utf8"))) if (!cur.has(p.name)) fs.appendFileSync(running, p.name + "\n");
  }
} else if (cmd === "save") fs.writeFileSync(dump, JSON.stringify(names().map(n => ({ name: n }))));
PM2
# 가짜 docker — 컨테이너 "이름 재시작정책 상태" 는 $ST/containers. DOCKER_HOST 가 전용 소켓일 때만 답한다.
cat > "$BIN/docker" <<DOCKER
#!/bin/bash
ST='$ST'
echo "\$* DOCKER_HOST=\${DOCKER_HOST:-} DOCKER_CONTEXT=\${DOCKER_CONTEXT-unset}" >> "\$ST/docker-calls"
[ "\${DOCKER_HOST:-}" = "unix://$COLIMA_HOME/openmake/docker.sock" ] || exit 1
[ -f "\$ST/docker-down" ] && exit 1
[ -f "\$ST/docker-hang" ] && exec sleep 6543
case "\$1" in
  ps) awk '{print \$1}' "\$ST/containers" ;;
  inspect) f="\$3"; n="\$4"
    case "\$f" in
      *RestartPolicy*) awk -v n="\$n" '\$1==n{s=\$3; sub(/_.*/,"",s); print \$2, s}' "\$ST/containers" ;;
      *State.Status*) awk -v n="\$n" '\$1==n{s=\$3; gsub(/_/," ",s); print s}' "\$ST/containers" ;;
    esac ;;
  context) exit 1 ;;
esac
DOCKER
chmod +x "$BIN/pm2" "$BIN/docker"
PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin"
sudo() { echo "sudo $*" >> "$ST/sudo-calls"; return 1; }

# 가짜 launchctl — 공용 대역에 `print gui/<uid>` 의 서비스 목록을 더한다 (다른 PM2 등록 탐지용).
# shellcheck source=/dev/null
. "$HERE/fake-launchctl.test-lib.sh"
eval "$(declare -f launchctl | sed '1s/^launchctl/fake_lctl_base/')"
OTHER_JOBS="$TMP/other-jobs"; : > "$OTHER_JOBS"; JOB_STATUS="$TMP/job-status"
launchctl() {
    if [[ "$1" == print && "$2" == "gui/$(id -u)" ]]; then
        [[ -f "$LCTL_STATE/domain" ]] || return 113
        printf 'gui/%s = {\n\tservices = {\n' "$(id -u)"
        while IFS= read -r l; do [[ -n "$l" ]] && printf '\t\t0\t-\t%s\n' "$l"; done < "$OTHER_JOBS"
        [[ -f "$LCTL_STATE/loaded.plist" ]] && printf '\t\t0\t-\tcom.openmake.pm2\n'
        printf '\t}\n}\n'; return 0
    fi
    if [[ "$1" == print && "$2" == gui/*/* && "$2" != */com.openmake.pm2 ]]; then
        grep -qxF "${2##*/}" "$OTHER_JOBS" || return 113
        printf '%s = {\n\tpath = %s\n}\n' "${2##*/}" "$(cat "$TMP/other-path" 2>/dev/null)"; return 0
    fi
    if [[ "$1" == kickstart ]]; then echo "kickstart $2" >> "$LCTL_STATE/log"; printf '\tstate = running\n' > "$JOB_STATUS"; return 0; fi
    if [[ "$1" == print && "$2" == */com.openmake.pm2 ]]; then
        fake_lctl_base "$@" || return $?
        cat "$JOB_STATUS" 2>/dev/null; return 0
    fi
    fake_lctl_base "$@"
}
# shellcheck source=/dev/null
. "$HERE/mac-pm2-boot.sh"
SCAN_ROOT="$TMP/scan"; mkdir -p "$SCAN_ROOT/LaunchAgents" "$SCAN_ROOT/LaunchDaemons"
PM2_BOOT_SCAN_DIRS=("$HOME/Library/LaunchAgents" "$SCAN_ROOT/LaunchAgents" "$SCAN_ROOT/LaunchDaemons")

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }
OUT="$TMP/out"
run() { # $@=인자 → 종료 코드 (출력은 $OUT)
    local rc=0
    (main "$@") > "$OUT" 2>&1 || rc=$?
    printf '%s' "$rc"
}
snapshot() { (cd "$HOME" && find . -print0 | sort -z | xargs -0 ls -ld 2>/dev/null | awk '{print $1, $NF}'; cat Library/LaunchAgents/*.plist 2>/dev/null); cat "$PM2_HOME/dump.pm2" 2>/dev/null; }
dump_sum() { cksum < "$PM2_HOME/dump.pm2"; }
write_dump() { # 앱 2개 — 작업 폴더·실행 파일·인터프리터가 외장 경로
    printf '[{"name":"openmake-llm-staging","pm_cwd":"%s","pm_exec_path":"%s/dist/cli.js","exec_interpreter":"%s/node","env":{"KEEP":"1"}},{"name":"openmake-next-staging","pm_cwd":"%s/web","pm_exec_path":"%s/web/server.js","exec_interpreter":"node"}]' \
        "$APPS" "$APPS" "$BIN" "$APPS" "$APPS" > "$PM2_HOME/dump.pm2"
}
make_apps() { mkdir -p "$APPS/dist" "$APPS/web"; : > "$APPS/dist/cli.js"; : > "$APPS/web/server.js"; }
# 직접 멈춘 unless-stopped 컨테이너(openmake-dev-*)는 VM 과 함께 다시 뜨지 않는다 — 기다리면 복구가 막힌다
printf 'openmake-staging-postgres unless-stopped running_healthy\nopenmake-staging-redis unless-stopped running_healthy\nold-postgres no exited\nopenmake-gone-postgres no exited\nopenmake-dev-postgres unless-stopped exited\n' > "$ST/containers"
: > "$ST/running"
reset_calls() { : > "$ST/pm2-calls"; : > "$ST/docker-calls"; rm -f "$ST/sudo-calls"; }

# ── 저장된 앱 목록이 없거나 깨졌으면 아무것도 바꾸지 않는다 ──
reset_calls; make_apps
BEFORE="$(snapshot)"
eq "dump 없음: 오류" "$(run --apply)" "2"
ok "dump 없음: 이유" 'grep -q "dump" "$OUT"'
eq "dump 없음: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "dump 없음: launchctl 변경 없음" "$(fake_lctl_log)" ""
printf '[]' > "$PM2_HOME/dump.pm2"; BEFORE="$(snapshot)"
eq "빈 dump: 오류" "$(run --apply)" "2"
eq "빈 dump: 파일 변경 없음" "$(snapshot)" "$BEFORE"
printf '[{"name":' > "$PM2_HOME/dump.pm2"; BEFORE="$(snapshot)"
eq "깨진 dump: 오류" "$(run --apply)" "2"
eq "깨진 dump: dump 그대로" "$(snapshot)" "$BEFORE"
eq "깨진 dump: pm2 save·resurrect 없음" "$(grep -cE '^(save|resurrect)' "$ST/pm2-calls")" "0"

# ── dump 가 가리키는 경로가 지금 없으면 등록하지 않는다 (부팅 때 영원히 기다리게 되므로) ──
write_dump; rm -rf "$APPS"; BEFORE="$(snapshot)"
eq "앱 경로 없음: 오류" "$(run --apply)" "2"
ok "앱 경로 없음: 경로를 알림" 'grep -qF "$APPS" "$OUT"'
eq "앱 경로 없음: 파일 변경 없음" "$(snapshot)" "$BEFORE"
make_apps

# ── 전용 DB/Redis 를 찾을 수 없으면 거부 ──
touch "$ST/docker-down"; BEFORE="$(snapshot)"
eq "Docker 응답 없음: 오류" "$(run --apply)" "2"
eq "Docker 응답 없음: 파일 변경 없음" "$(snapshot)" "$BEFORE"
rm -f "$ST/docker-down"

# ── --check: 등록 없음 + 정상 dump → 바꿀 항목만 알린다 ──
reset_calls; BEFORE="$(snapshot)"
eq "check: 남은 항목 → 1" "$(run --check)" "1"
ok "check: 등록할 것을 알림" 'grep -q "^fix: .*com.openmake.pm2" "$OUT"'
eq "check: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "check: launchctl 변경 없음" "$(fake_lctl_log)" ""
eq "check: pm2 호출 없음" "$(cat "$ST/pm2-calls")" ""
ok "check: Docker 는 전용 소켓으로만 (DOCKER_CONTEXT 없이)" '! grep -v "DOCKER_HOST=unix://$COLIMA_HOME/openmake/docker.sock DOCKER_CONTEXT=unset" "$ST/docker-calls" | grep -q .'

# ── 다른 PM2 등록이 있으면 손대지 않는다 ──
# (1) root 소유/시스템 데몬 — 알 수 없는 등록: 거부
printf '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>pm2.root</string><key>ProgramArguments</key><array><string>/usr/local/bin/pm2</string><string>resurrect</string></array></dict></plist>' > "$SCAN_ROOT/LaunchDaemons/pm2.root.plist"
BEFORE="$(snapshot)"
eq "시스템 PM2 등록: 거부" "$(run --apply)" "2"
ok "시스템 PM2 등록: 파일을 알림" 'grep -qF "$SCAN_ROOT/LaunchDaemons/pm2.root.plist" "$OUT"'
eq "시스템 PM2 등록: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "시스템 PM2 등록: launchctl 변경 없음" "$(fake_lctl_log)" ""
rm -f "$SCAN_ROOT/LaunchDaemons/pm2.root.plist"
# (1b) 이름·라벨이 pm2 가 아니고 인자가 여러 줄(<string> 하나씩)인 사용자 정의 등록: 거부 (중복 복구 방지)
cat > "$SCAN_ROOT/LaunchAgents/com.example.apps.plist" <<'P'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.apps</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/tools/bin/pm2</string>
        <string>resurrect</string>
    </array>
</dict>
</plist>
P
echo "com.example.apps" > "$OTHER_JOBS"
BEFORE="$(snapshot)"
eq "여러 줄 사용자 PM2 등록: 거부" "$(run --apply)" "2"
eq "여러 줄 사용자 PM2 등록: 한 번만 알림 (로드된 라벨과 같은 등록)" "$(grep -c "other PM2 boot registration" "$OUT")" "1"
ok "여러 줄 사용자 PM2 등록: 파일을 알림" 'grep -qF "com.example.apps.plist" "$OUT"'
eq "여러 줄 사용자 PM2 등록: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "여러 줄 사용자 PM2 등록: launchctl 변경 없음" "$(fake_lctl_log)" ""
plutil -convert binary1 "$SCAN_ROOT/LaunchAgents/com.example.apps.plist"
eq "바이너리 사용자 PM2 등록: 거부" "$(run --apply)" "2"
rm -f "$SCAN_ROOT/LaunchAgents/com.example.apps.plist"; : > "$OTHER_JOBS"
# (2) 로드된 알 수 없는 pm2 작업(파일 없음): 거부
echo "pm2.someone" > "$OTHER_JOBS"
eq "로드된 다른 PM2 작업: 거부" "$(run --apply)" "2"
eq "로드된 다른 PM2 작업: launchctl 변경 없음" "$(fake_lctl_log)" ""
: > "$OTHER_JOBS"
# (3) 사용자 자신의 건강한 pm2 startup (같은 PM2_HOME, 로드됨): 그대로 두고 중복 등록하지 않는다
U="${USER:-$(id -un)}"; mkdir -p "$HOME/Library/LaunchAgents"
cat > "$HOME/Library/LaunchAgents/pm2.$U.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>pm2.$U</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>$BIN/pm2 resurrect</string></array>
<key>EnvironmentVariables</key><dict><key>PM2_HOME</key><string>$(printf '%s' "$PM2_HOME" | sed 's/&/\&amp;/g')</string></dict>
<key>RunAtLoad</key><true/></dict></plist>
P
echo "pm2.$U" > "$OTHER_JOBS"; printf '%s' "$HOME/Library/LaunchAgents/pm2.$U.plist" > "$TMP/other-path"
BEFORE="$(snapshot)"
eq "기존 건강한 pm2 startup: 유지 → 0" "$(run --apply)" "0"
ok "기존 건강한 pm2 startup: 알림" 'grep -q "pm2.$U" "$OUT"'
eq "기존 건강한 pm2 startup: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "기존 건강한 pm2 startup: launchctl 변경 없음" "$(fake_lctl_log)" ""
# 같은 파일인데 다른 PM2_HOME 이면 알 수 없는 설정 — 거부
sed -i '' "s|<string>$(printf '%s' "$PM2_HOME" | sed 's/&/\\&amp;/g')</string>|<string>/elsewhere/.pm2</string>|" "$HOME/Library/LaunchAgents/pm2.$U.plist"
eq "다른 PM2_HOME 의 pm2 startup: 거부" "$(run --apply)" "2"
# 로드되지 않은 pm2 startup 파일도 알 수 없는 상태 — 거부 (덮어쓰지도 않는다)
: > "$OTHER_JOBS"
eq "로드 안 된 pm2 startup 파일: 거부" "$(run --apply)" "2"
eq "로드 안 된 pm2 startup 파일: launchctl 변경 없음" "$(fake_lctl_log)" ""
rm -f "$HOME/Library/LaunchAgents/pm2.$U.plist" "$TMP/other-path"

# ── --apply: 등록 ──
reset_calls; SUM="$(dump_sum)"
eq "apply: 0" "$(run --apply)" "0"
P="$HOME/Library/LaunchAgents/com.openmake.pm2.plist"
ok "apply: plist 유효" 'plutil -lint -s "$P" >/dev/null'
eq "apply: 등록" "$(fake_lctl_log)" "bootstrap"
eq "apply: dump 그대로" "$(dump_sum)" "$SUM"
eq "apply: pm2 save 없음" "$(grep -c '^save' "$ST/pm2-calls")" "0"
eq "apply: sudo 없음" "$(cat "$ST/sudo-calls" 2>/dev/null)" ""
B="$(ls "$OMK_ROOT/backups/pm2/" 2>/dev/null | head -1)"
ok "apply: dump 백업" '[[ -n "$B" ]] && cmp -s "$OMK_ROOT/backups/pm2/$B" "$PM2_HOME/dump.pm2"'
eq "apply: 백업 0600" "$(stat -f %Lp "$OMK_ROOT/backups/pm2/$B" 2>/dev/null)" "600"
G="$HOME/.local/share/openmake/pm2-boot-guard.sh"
ok "apply: 가드 설치 (저장소 밖)" '[[ -x "$G" ]] && cmp -s "$G" "$HERE/pm2-boot-guard.sh"'
J="$(plutil -convert json -o - "$P")"
jget() { node -e 'const j=JSON.parse(process.argv[1]);const v=eval("j"+process.argv[2]);process.stdout.write(Array.isArray(v)?v.join("\n"):String(v))' "$J" "$1"; }
eq "plist: 인자" "$(jget .ProgramArguments)" "$(printf '%s\n' /bin/bash "$G" run "$BIN/node" "$BIN/pm2" "$BIN/docker" "unix://$COLIMA_HOME/openmake/docker.sock" openmake-staging-postgres openmake-staging-redis)"
eq "plist: HOME" "$(jget .EnvironmentVariables.HOME)" "$HOME"
eq "plist: PM2_HOME" "$(jget .EnvironmentVariables.PM2_HOME)" "$PM2_HOME"
eq "plist: PATH (선택된 node 먼저)" "$(jget .EnvironmentVariables.PATH)" "$BIN:/usr/bin:/bin:/usr/sbin:/sbin"
ok "plist: 멈춘 컨테이너는 기다리지 않음" '[[ "$(jget .ProgramArguments)" != *openmake-dev-postgres* ]]'
eq "plist: DOCKER 전역 환경 없음" "$(jget '.EnvironmentVariables.DOCKER_HOST')" "undefined"
eq "plist: RunAtLoad" "$(jget .RunAtLoad)" "true"
eq "plist: KeepAlive 없음 (무한 재시도 없음)" "$(jget .KeepAlive)" "undefined"
eq "plist: 작업이 끝나도 PM2 데몬을 죽이지 않음" "$(jget .AbandonProcessGroup)" "true"
eq "plist: 로그" "$(jget .StandardErrorPath)" "$OMK_ROOT/logs/pm2-boot.log"

# 같은 상태에서 다시 실행하면 아무것도 바꾸지 않는다
reset_calls; fake_lctl_reset 1; fake_lctl_load "$P"; BEFORE="$(snapshot)"
eq "재실행 check: 0" "$(run --check)" "0"
eq "재실행 apply: 0" "$(run --apply)" "0"
eq "재실행: launchctl 변경 없음" "$(fake_lctl_log)" ""
eq "재실행: 파일 변경 없음" "$(snapshot)" "$BEFORE"
# 마지막 가드 실행이 실패로 끝났으면(의존성 시간 초과 등): check 는 실패를 알리고, apply 는 우리 작업만 다시 실행한다
printf '\tstate = not running\n\tlast exit code = 75\n' > "$JOB_STATUS"
eq "실패한 가드: check → 2" "$(run --check)" "2"
ok "실패한 가드: check 가 종료 코드를 알림" 'grep -q "^error: .*75" "$OUT"'
eq "실패한 가드: check 는 다시 실행하지 않음" "$(fake_lctl_log)" ""
eq "실패한 가드: apply → 다시 실행 (결과는 로그 — 보류 1)" "$(run --apply)" "1"
eq "실패한 가드: apply 는 kickstart 만" "$(fake_lctl_log)" "kickstart gui/$(id -u)/com.openmake.pm2"
ok "실패한 가드: ok 라고 하지 않음" '! grep -q "^result: ok" "$OUT"'
eq "실패한 가드: 파일 변경 없음" "$(snapshot)" "$BEFORE"
# 실행 중(기다리는 중)·성공 종료·아직 끝난 적 없음 → 그대로 (불필요한 resurrect 없음)
for st in '\tstate = running\n' '\tstate = not running\n\tlast exit code = 0\n' '\tstate = not running\n\tlast exit code = (never exited)\n'; do
    fake_lctl_reset 1; fake_lctl_load "$P"; printf "$st" > "$JOB_STATUS"
    eq "가드 상태 [$st]: apply 0" "$(run --apply)" "0"
    eq "가드 상태 [$st]: launchctl 변경 없음" "$(fake_lctl_log)" ""
done
rm -f "$JOB_STATUS"
# 우리 등록 + 다른 PM2 등록 = 이중 등록 → 거부
echo "pm2.$U" > "$OTHER_JOBS"; printf '%s' "$HOME/Library/LaunchAgents/pm2.$U.plist" > "$TMP/other-path"
eq "이중 등록: 거부" "$(run --check)" "2"
: > "$OTHER_JOBS"; rm -f "$TMP/other-path"

# GUI 세션이 없으면(SSH 전용) 정의만 두고 보류로 알린다 — 성공으로 말하지 않는다
rm -f "$P"; fake_lctl_reset 0
eq "GUI 없음: 보류 → 1" "$(run --apply)" "1"
ok "GUI 없음: 정의는 둔다" '[[ -f "$P" ]]'
ok "GUI 없음: ok 라고 하지 않는다" '! grep -q "^result: ok" "$OUT"'
fake_lctl_reset 1
# 등록이 실패하면 오류 (성공으로 말하지 않는다)
eval "$(declare -f launchctl | sed '1s/^launchctl/lctl_ok/')"
launchctl() { [[ "$1" == bootstrap ]] && return 5; lctl_ok "$@"; }
eq "bootstrap 실패: 오류" "$(run --apply)" "2"
eval "$(declare -f lctl_ok | sed '1s/^lctl_ok/launchctl/')"

# ── 부팅 가드 (실제로 별도 bash 로 실행) ──
GUARD="$HERE/pm2-boot-guard.sh"
GLOG="$TMP/guard.log"
guard() { # → 종료 코드 (출력은 $GLOG)
    local rc=0
    env -i HOME="$HOME" PM2_HOME="$PM2_HOME" PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" OMK_PM2_BACKUP_DIR="$OMK_ROOT/backups/pm2" \
        OMK_PM2_BOOT_WAIT_SECONDS="${WAIT:-3}" OMK_PM2_BOOT_INTERVAL=1 OMK_PM2_BOOT_DOCKER_TIMEOUT="${OMK_PM2_BOOT_DOCKER_TIMEOUT:-20}" \
        "${GBASH:-/bin/bash}" "$GUARD" run "$BIN/node" "$BIN/pm2" "$BIN/docker" "unix://$COLIMA_HOME/openmake/docker.sock" \
        openmake-staging-postgres openmake-staging-redis > "$GLOG" 2>&1 || rc=$?
    printf '%s' "$rc"
}
for GBASH in /bin/bash ${BASH5:-}; do
    [[ -x "$GBASH" ]] || continue
    # 정상: 경로·DB 준비 → resurrect, 앱 확인, dump 는 그대로
    : > "$ST/running"; reset_calls; SUM="$(dump_sum)"
    eq "가드($GBASH): 성공" "$(guard)" "0"
    eq "가드($GBASH): 앱 복구" "$(sort "$ST/running" | tr '\n' ' ')" "openmake-llm-staging openmake-next-staging "
    eq "가드($GBASH): dump 그대로" "$(dump_sum)" "$SUM"
    eq "가드($GBASH): save 없음" "$(grep -c '^save' "$ST/pm2-calls")" "0"
    eq "가드($GBASH): PM2 에 가드 전용 환경을 넘기지 않음" "$(grep -c OMK_PM2 "$ST/pm2-env")" "0"
    ok "가드($GBASH): PM2_HOME 전달" 'grep -q "^resurrect PM2_HOME=$PM2_HOME$" "$ST/pm2-calls"'
    eq "가드($GBASH): 부팅 직전 dump 백업 0600" "$(stat -f %Lp "$OMK_ROOT/backups/pm2/dump.pm2.last-boot" 2>/dev/null)" "600"
    # 이미 떠 있으면 중복 없이 성공 (pm2 resurrect 는 없는 이름만 띄운다 — 여기선 확인만)
    eq "가드($GBASH): 이미 실행 중 → 0" "$(guard)" "0"

    # 외장 경로가 늦게 붙는다: 기다렸다가 진행
    : > "$ST/running"; mv "$TMP/Volumes" "$TMP/Volumes.off"
    ( sleep 2; mv "$TMP/Volumes.off" "$TMP/Volumes" ) &
    eq "가드($GBASH): 늦은 외장 경로 → 기다린 뒤 성공" "$(WAIT=10 guard)" "0"
    wait
    ok "가드($GBASH): 기다린 경로를 기록" 'grep -qF "$APPS" "$GLOG"'
    # 경로가 끝내 없으면: 시간 제한 후 0 이 아닌 종료, resurrect 없음
    : > "$ST/running"; reset_calls; mv "$TMP/Volumes" "$TMP/Volumes.off"
    eq "가드($GBASH): 경로 끝내 없음 → 75" "$(WAIT=2 guard)" "75"
    eq "가드($GBASH): 경로 없음 → resurrect 안 함" "$(grep -c '^resurrect' "$ST/pm2-calls")" "0"
    ok "가드($GBASH): 실패를 기록" 'grep -q "error" "$GLOG"'
    mv "$TMP/Volumes.off" "$TMP/Volumes"

    # pm2 실행 파일이 늦게 생긴다(외장 경로의 전역 모듈 등): 바로 실패하지 않고 기다린다
    : > "$ST/running"; mv "$BIN/pm2" "$TMP/pm2.off"
    ( sleep 2; mv "$TMP/pm2.off" "$BIN/pm2" ) &
    eq "가드($GBASH): 늦은 pm2 경로 → 기다린 뒤 성공" "$(WAIT=10 guard)" "0"
    wait

    # docker 가 멈추면(응답 없음): 호출마다 시간 제한으로 끊고, 전체 기한 안에 75 로 끝낸다
    : > "$ST/running"; reset_calls; touch "$ST/docker-hang"; T0="$(date +%s)"
    eq "가드($GBASH): 멈춘 docker → 75" "$(WAIT=2 OMK_PM2_BOOT_DOCKER_TIMEOUT=1 guard)" "75"
    ok "가드($GBASH): 멈춘 docker → 제한 시간 안에 끝남" '[[ $(( $(date +%s) - T0 )) -lt 30 ]]'
    ok "가드($GBASH): 멈춘 docker → 기록" 'grep -q "timed out" "$GLOG"'
    ok "가드($GBASH): 멈춘 docker 프로세스를 남기지 않음" '! pgrep -f "sleep 6543" >/dev/null'
    eq "가드($GBASH): 멈춘 docker → resurrect 안 함" "$(grep -c '^resurrect' "$ST/pm2-calls")" "0"
    rm -f "$ST/docker-hang"

    # DB 가 늦게 healthy: 기다렸다가 진행
    sed -i '' 's/openmake-staging-postgres unless-stopped running_healthy/openmake-staging-postgres unless-stopped running_starting/' "$ST/containers"
    ( sleep 2; sed -i '' 's/running_starting/running_healthy/' "$ST/containers" ) &
    : > "$ST/running"
    eq "가드($GBASH): 늦은 DB → 기다린 뒤 성공" "$(WAIT=10 guard)" "0"
    wait
    # DB 가 끝내 준비 안 됨 → 75, resurrect 없음
    sed -i '' 's/openmake-staging-redis unless-stopped running_healthy/openmake-staging-redis unless-stopped exited/' "$ST/containers"
    : > "$ST/running"; reset_calls
    eq "가드($GBASH): Redis 안 뜸 → 75" "$(WAIT=2 guard)" "75"
    eq "가드($GBASH): Redis 안 뜸 → resurrect 안 함" "$(grep -c '^resurrect' "$ST/pm2-calls")" "0"
    ok "가드($GBASH): 기다린 컨테이너를 기록" 'grep -q "openmake-staging-redis" "$GLOG"'
    sed -i '' 's/openmake-staging-redis unless-stopped exited/openmake-staging-redis unless-stopped running_healthy/' "$ST/containers"

    # 깨진 dump: pm2 resurrect 가 그 파일을 지우므로 부르지 않는다
    cp "$PM2_HOME/dump.pm2" "$TMP/dump.keep"; printf '[{"name":' > "$PM2_HOME/dump.pm2"; reset_calls
    eq "가드($GBASH): 깨진 dump → 78" "$(guard)" "78"
    eq "가드($GBASH): 깨진 dump 그대로" "$(cat "$PM2_HOME/dump.pm2")" '[{"name":'
    eq "가드($GBASH): 깨진 dump → pm2 호출 없음" "$(cat "$ST/pm2-calls")" ""
    cp "$TMP/dump.keep" "$PM2_HOME/dump.pm2"

    # resurrect 후 앱이 없으면 실패로 알린다
    : > "$ST/running"; touch "$ST/resurrect-broken"
    eq "가드($GBASH): 복구 확인 실패 → 1" "$(guard)" "1"
    ok "가드($GBASH): 빠진 앱 기록" 'grep -q "openmake-llm-staging" "$GLOG"'
    rm -f "$ST/resurrect-broken"
done

# ── 설치기(80-finish): 저장 규칙 ──
log_ok() { echo "ok: $*"; }; log_warn() { echo "warn: $*"; }; log_info() { echo "info: $*"; }; add_todo() { echo "todo: $*"; }
NO_START=0; DGX_VIA=""; SCRIPT_DIR="$(cd "$HERE/../.." && pwd)"; SKIP_DOCKER=0
# shellcheck source=/dev/null
. "$HERE/mac/80-finish.sh"
run_pm2_boot_repair() { echo "repair $*" >> "$ST/repair-calls"; return "${REPAIR_RC:-0}"; }
# 지금 실행 중 앱이 없으면 dump 를 절대 덮지 않는다
: > "$ST/running"; reset_calls; SUM="$(dump_sum)"
setup_autostart > "$OUT" 2>&1
eq "설치기: 빈 실행 목록 → dump 그대로" "$(dump_sum)" "$SUM"
eq "설치기: 빈 실행 목록 → save 없음" "$(grep -c '^save' "$ST/pm2-calls")" "0"
ok "설치기: 빈 실행 목록 → 성공이라 하지 않음" '! grep -q "^ok: 재부팅 자동 시작" "$OUT"'
# 저장된 앱이 지금 목록에 없으면(잃게 되면) 저장하지 않는다
printf 'openmake-llm-staging\n' > "$ST/running"; reset_calls
setup_autostart > "$OUT" 2>&1
eq "설치기: 저장 앱 손실 → dump 그대로" "$(dump_sum)" "$SUM"
ok "설치기: 손실 앱 알림" 'grep -q "openmake-next-staging" "$OUT"'
# 저장된 앱이 모두 있으면(새 앱 추가 포함) 백업 후 저장하고 등록 도우미를 부른다
printf 'openmake-llm-staging\nopenmake-next-staging\nopenmake-llm\n' > "$ST/running"; reset_calls; : > "$ST/repair-calls"
setup_autostart > "$OUT" 2>&1
eq "설치기: 저장" "$(grep -c '^save' "$ST/pm2-calls")" "1"
ok "설치기: 새 앱 저장됨" 'grep -q "\"openmake-llm\"" "$PM2_HOME/dump.pm2"'
eq "설치기: 등록 도우미 호출" "$(cat "$ST/repair-calls")" "repair --apply"
ok "설치기: 성공 알림" 'grep -q "^ok: 재부팅 자동 시작" "$OUT"'
eq "설치기: sudo pm2 startup 없음" "$(cat "$ST/sudo-calls" 2>/dev/null)" ""
# 등록 도우미 실패를 성공으로 말하지 않는다
REPAIR_RC=2; setup_autostart > "$OUT" 2>&1; REPAIR_RC=0
ok "설치기: 등록 실패 → 성공이라 하지 않음" '! grep -q "^ok: 재부팅 자동 시작" "$OUT"'
ok "설치기: 등록 실패 → 할 일" 'grep -q "^todo: .*mac-pm2-boot.sh" "$OUT"'

printf '\nmac-pm2-boot.test: %d passed, %d failed (bash %s)\n' "$PASS" "$FAIL" "$BASH_VERSION"
[[ $FAIL -eq 0 ]]
