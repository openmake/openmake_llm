#!/bin/bash
# successor-replace.sh 셸 테스트 (plan-pr2.4 §3.4 — macOS 전용: hdiutil·PlistBuddy·ps).
# 실제 스크립트 바이트를 돈다. PATH 대역은 open·osascript 뿐이고(사례 ⑪ 만 kill, ⑳ 만 date 를 더한다) ps·kill(내장)·hdiutil 은 진짜다.
# 가짜 앱의 실행 파일은 cc 로 만든 C 프로그램이다 — /bin/sleep 사본은 실행 즉시 SIGKILL 된다(2026-11-19 실측, 종료 137).
# 사용: bash apps/desktop-native/tests/successor-replace.test.sh
set -uo pipefail
[ "$(uname -s)" = Darwin ] || { echo "macOS 전용 — 건너뜀"; exit 0; }

HERE="$(cd "$(dirname "$0")" && pwd -P)"
SCRIPT="${SUCC_SCRIPT:-$HERE/../scripts/successor-replace.sh}" # SUCC_SCRIPT: 변이 확인용
ROOT="$(cd "$(mktemp -d /tmp/omk-succ-test.XXXXXX)" && pwd -P)"
KEY="omk_live_TESTKEY0123456789"
PASS=0
FAIL=0
DOMAINS=()
STRAYS=()

cleanup() {
  for p in ${STRAYS[@]+"${STRAYS[@]}"}; do /bin/kill -KILL "$p" 2>/dev/null; done
  for d in ${DOMAINS[@]+"${DOMAINS[@]}"}; do defaults delete "$d" >/dev/null 2>&1; rm -f "$HOME/Library/Preferences/$d.plist"; done
  hdiutil info 2>/dev/null | grep -o "/Volumes/OMKSuccTest[^ ]*" | while read -r v; do hdiutil detach "$v" -quiet -force; done
  chmod -R u+w "$ROOT" 2>/dev/null
  rm -rf "$ROOT"
}
trap cleanup EXIT

ok() { if "$@"; then PASS=$((PASS + 1)); echo "  ok   - $DESC"; else FAIL=$((FAIL + 1)); echo "  FAIL - $DESC"; fi; }
t() { DESC="$1"; shift; ok "$@"; }
not() { ! "$@"; }

# ─── 고정물 ───
cat > "$ROOT/fake.c" <<'C'
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(void) {
  const char *m = getenv("FAKE_MODE");
  if (m && !strcmp(m, "ignore-term")) signal(SIGTERM, SIG_IGN);
  if (m && !strcmp(m, "die1")) { sleep(1); return 0; }
  sleep(120);
  return 0;
}
C
cc -o "$ROOT/fake-bin" "$ROOT/fake.c" || { echo "cc 실패"; exit 1; }

# make_app <폴더> <이름> <번들 ID> <버전> <실행 파일 이름>
make_app() {
  local app="$1/$2.app"
  mkdir -p "$app/Contents/MacOS"
  cp "$ROOT/fake-bin" "$app/Contents/MacOS/$5"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$3</string>
  <key>CFBundleShortVersionString</key><string>$4</string>
  <key>CFBundleExecutable</key><string>$5</string>
</dict></plist>
PLIST
}

# make_dmg <이름> [번들 ID] [버전] — "noapp" 이면 앱 없는 이미지
make_dmg() {
  local src="$ROOT/dmgsrc-$1"
  mkdir -p "$src"
  if [ "$1" = noapp ]; then echo x > "$src/README"; else make_app "$src" "OpenMake Code" "$2" "$3" "OpenMake Code"; fi
  hdiutil create -quiet -volname "OMKSuccTest$1" -srcfolder "$src" -ov -format UDZO "$ROOT/$1.dmg" || { echo "dmg 생성 실패: $1"; exit 1; }
}
make_dmg good cc.openmake.code 0.5.0
make_dmg noapp
make_dmg badid cc.openmake.other 0.5.0
make_dmg badver cc.openmake.code 0.5.1

lstart_epoch() {
  local l
  l="$(TZ=UTC LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null)" || return 1
  l="${l%"${l##*[! ]}"}"
  [ -n "$l" ] || return 1
  TZ=UTC LC_ALL=C date -j -f '%a %b %d %T %Y' "$l" +%s 2>/dev/null
}

# 소유자 판정 참조 구현(plan §3.2.2 r5 의 세 갈래) — 입력은 표식 내용과 ps 뿐. 수정 시각을 보지 않는다.
owner() {
  local pid st extra now d
  read -r pid st extra <<<"$1"
  [[ "$pid" =~ ^[0-9]+$ && "$st" =~ ^[0-9]+$ && -z "$extra" ]] || { echo alive; return; } # 확인 불가 → 유예
  ps -p "$pid" >/dev/null 2>&1 || { echo ended; return; }
  now="$(lstart_epoch "$pid")" || { echo alive; return; }
  d=$((now - st)); d=${d#-}
  if [ "$d" -le 1 ]; then echo alive; else echo ended; fi
}
# r4 규칙(시작 ≤ 수정 시각) — 시계 역행에서 틀리는 것을 보이는 대조용.
owner_r4() {
  local pid
  pid="$(cut -d' ' -f1 "$1")"
  if [ "$(lstart_epoch "$pid")" -le "$(stat -f %m "$1")" ]; then echo alive; else echo ended; fi
}

# setup <이름> [dmg] — 사례 폴더·옛 앱·대역·환경을 만든다.
setup() {
  C="$ROOT/case-$1"
  mkdir -p "$C/Applications" "$C/bin" "$C/support"
  make_app "$C/Applications" "OpenMake Companion" cc.openmake.companion 0.4.4 OpenMakeCompanion
  ditto "$C/Applications/OpenMake Companion.app" "$C/orig-old.app"
  cp "$ROOT/${2:-good}.dmg" "$C/update.dmg"
  OLD="$C/Applications/OpenMake Companion.app"
  NEW="$C/Applications/OpenMake Code.app"
  NEW_EXEC="$NEW/Contents/MacOS/OpenMake Code"
  PENDING="$C/support/successor-pending"
  KH="$C/support/key-handoff"
  DOMAIN="cc.openmake.test.successor.$$.$1"
  DOMAINS+=("$DOMAIN")
  cat > "$C/bin/open" <<'SH'
#!/bin/bash
echo "$*" >> "$FAKE_DIR/open.log"
if [ "$1" = "-a" ]; then echo "$2" >> "$FAKE_DIR/reopen.log"; exit 0; fi
app="$1"
echo "$app" >> "$FAKE_DIR/open-new.log"
if [ -f "$FAKE_PENDING" ]; then
  echo "present $(stat -f %Lp "$FAKE_PENDING")" > "$FAKE_DIR/marker-at-open"
  cat "$FAKE_PENDING" > "$FAKE_DIR/marker-content"
else
  echo absent > "$FAKE_DIR/marker-at-open"
fi
echo "$PPID" > "$FAKE_DIR/script.pid"
TZ=UTC LC_ALL=C ps -o lstart= -p "$PPID" > "$FAKE_DIR/script-lstart"
[ -n "${FAKE_OPEN_EXIT:-}" ] && exit "$FAKE_OPEN_EXIT"
if [ "${FAKE_OPEN_LAUNCH:-1}" = 1 ]; then
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
  "$app/Contents/MacOS/$exe" </dev/null >/dev/null 2>&1 &
  pid=$!
  echo "$pid" > "$FAKE_DIR/app.pid"
  # fork 와 exec 사이에는 comm 이 아직 셸이다 — exec 가 끝날 때까지 기다린다(판정 시한 0 사례가 흔들리지 않게).
  for _ in $(seq 1 40); do [ "$(ps -p "$pid" -o comm= 2>/dev/null)" = "$app/Contents/MacOS/$exe" ] && break; sleep 0.05; done
fi
if [ "${FAKE_OPEN_PAUSE:-0}" = 1 ]; then kill -STOP "$PPID"; touch "$FAKE_DIR/paused"; fi
exit 0
SH
  cat > "$C/bin/osascript" <<'SH'
#!/bin/bash
echo "$*" >> "$FAKE_DIR/alert.log"
SH
  chmod +x "$C/bin/open" "$C/bin/osascript"
  ENVS=(
    PATH="$C/bin:$PATH" FAKE_DIR="$C" FAKE_PENDING="$PENDING"
    OMK_SUCC_APP="$OLD" OMK_SUCC_DMG="$C/update.dmg" OMK_SUCC_NAME="OpenMake Code"
    OMK_SUCC_BUNDLE_ID=cc.openmake.code OMK_SUCC_VERSION=0.5.0 OMK_SUCC_LOG="$C/log"
    OMK_SUCC_PENDING="$PENDING" OMK_KH="$KH"
    OMK_SUCC_DEFAULTS_DOMAIN="$DOMAIN" OMK_SUCC_FAILED_KEY=update.successorFailedVersion
    OMK_SUCC_START_DELAY=0 OMK_SUCC_APPEAR_SECONDS=5 OMK_SUCC_SURVIVE_SECONDS=3
    OMK_UPD_FAIL_TITLE=MSG_FAIL_TITLE OMK_UPD_LOG=MSG_LOG
    OMK_SUCC_MSG_MOUNT=MSG_MOUNT OMK_SUCC_MSG_NO_APP=MSG_NO_APP OMK_SUCC_MSG_BUNDLE_ID=MSG_BUNDLE_ID
    OMK_SUCC_MSG_VERSION=MSG_VERSION OMK_SUCC_MSG_COPY=MSG_COPY OMK_SUCC_MSG_RUNNING=MSG_RUNNING
    OMK_SUCC_MSG_PREPARE=MSG_PREPARE OMK_SUCC_MSG_REPLACE=MSG_REPLACE OMK_SUCC_MSG_LAUNCH=MSG_LAUNCH
    OMK_SUCC_MSG_KILL_FAILED=MSG_KILL_FAILED
  )
  touch "$C/open.log" "$C/reopen.log" "$C/alert.log" "$C/open-new.log"
}

# run [환경 더하기...] — 앞에서 돌리고 종료 코드를 RC 에.
run() { printf '%s\n' "$KEY" | env "${ENVS[@]}" "$@" /bin/bash "$SCRIPT"; RC=$?; }
# run_bg [환경 더하기...] — 뒤에서 돌리고 PID 를 SPID 에.
run_bg() { printf '%s\n' "$KEY" | env "${ENVS[@]}" "$@" /bin/bash "$SCRIPT" & SPID=$!; }
wait_for() { local i; for i in $(seq 1 1200); do [ -e "$1" ] && return 0; sleep 0.05; done; return 1; }
# 정지 대역(FAKE_OPEN_PAUSE)을 기다린다 — 시간 초과면 그대로 이어 가지 않고 중단한다(늦게 온 STOP 이 CONT 뒤에 닿아 스크립트가 영영 멈추지 않게).
wait_paused() {
  wait_for "$C/paused" && return 0
  echo "  FAIL - 정지 대역 대기 시간 초과(60초) — 중단"
  /bin/kill -KILL "$SPID" 2>/dev/null
  exit 1
}

old_intact() { diff -r "$C/orig-old.app" "$OLD" >/dev/null 2>&1; }
reopens() { [ "$(wc -l < "$C/reopen.log" | tr -d ' ')" = "$1" ]; }
opened_new() { [ "$(wc -l < "$C/open-new.log" | tr -d ' ')" = "$1" ]; }
failed_recorded() { [ "$(defaults read "$DOMAIN" update.successorFailedVersion 2>/dev/null)" = 0.5.0 ]; }
alerted() { grep -q "$1" "$C/alert.log"; }
no_alert() { [ ! -s "$C/alert.log" ]; }
marker_absent() { [ ! -e "$PENDING" ]; }
fifo_gone() {
  [ ! -e "$KH" ] || return 1
  local w
  w="$(sed -n 's/.*key-handoff writer //p' "$C/log" | tail -1)"
  [ -z "$w" ] || ! kill -0 "$w" 2>/dev/null
}
fifo_was_made() { grep -q 'key-handoff writer [0-9]' "$C/log"; }
key_not_logged() { ! grep -q "$KEY" "$C/log"; }
app_pid() { cat "$C/app.pid"; }
app_dead() { ! kill -0 "$(app_pid)" 2>/dev/null; }
new_is_dmg_app() { [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEW/Contents/Info.plist" 2>/dev/null)" = 0.5.0 ]; }
nothing_left() { [ ! -e "$NEW" ] && [ ! -e "$NEW.new" ] && [ ! -e "$NEW.old" ]; }
marker_matches_script() {
  local pid st ref
  read -r pid st < "$C/marker-content"
  ref="$(TZ=UTC LC_ALL=C date -j -f '%a %b %d %T %Y' "$(sed 's/ *$//' "$C/script-lstart")" +%s)"
  [ "$pid" = "$(cat "$C/script.pid")" ] && [ "$st" = "$ref" ] && [ "$(wc -l < "$C/marker-content" | tr -d ' ')" = 1 ]
}

[ -f "$SCRIPT" ] || { echo "FAIL - 스크립트 없음: $SCRIPT"; exit 1; }

echo "# 성공 (⑥⑧⑨⑭⑮ · 키 · FIFO)"
setup success
printf '99999 1\n' > "$PENDING"; touch -t 202001010000 "$PENDING" # 남은 옛 표식 — 덮어써져야 한다(⑮)
run_bg
wait_for "$C/app.pid"; sleep 1
t "생존 구간 안: 표식이 있다(확정 전 — ⑨)" test -f "$PENDING"
t "생존 구간 안: 옛 앱이 아직 있다(판정 뒤에만 지운다 — ⑥)" old_intact
wait "$SPID"; RC=$?
STRAYS+=("$(app_pid)")
t "종료 코드 0" test "$RC" = 0
t "open 순간 표식이 있었고 0600 (⑧)" grep -qx 'present 600' "$C/marker-at-open"
t "표식 내용 = 스크립트 PID + 테스트가 따로 읽은 그 PID 의 시작 시각 한 줄, 옛 표식은 덮어씀 (⑭⑮)" marker_matches_script
t "새 앱이 dmg 의 것" new_is_dmg_app
t "옛 앱이 지워졌다" test ! -e "$OLD"
t "확정 뒤 표식이 없다 (⑨)" marker_absent
t "새 프로세스가 살아 있다" kill -0 "$(app_pid)"
t "FIFO 를 만들었다" fifo_was_made
t "FIFO·쓰는 쪽 정리" fifo_gone
t "키가 로그에 없다" key_not_logged
t "옛 앱을 다시 열지 않았다" reopens 0
t "실패 버전을 적지 않았다" not failed_recorded
t "경고 없음" no_alert
t "dmg·.new·.old 정리" eval '[ ! -e "$C/update.dmg" ] && [ ! -e "$NEW.new" ] && [ ! -e "$NEW.old" ]'
/bin/kill -KILL "$(app_pid)" 2>/dev/null

echo "# 같은 이름 앱이 이미 있음 — 성공 시 교체"
setup existing-ok
make_app "$C/Applications" "OpenMake Code" cc.openmake.code 0.4.9 "OpenMake Code"
run
STRAYS+=("$(app_pid)")
t "종료 코드 0" test "$RC" = 0
t "새 앱이 dmg 의 것으로 바뀌었다" new_is_dmg_app
t ".old 가 없다" test ! -e "$NEW.old"
/bin/kill -KILL "$(app_pid)" 2>/dev/null

echo "# 같은 이름 앱이 이미 있음 — 실패 시 원래 것 복원 (⑤: 살아 있는 채 판정 실패)"
setup existing-fail
make_app "$C/Applications" "OpenMake Code" cc.openmake.code 0.4.9 "OpenMake Code"
ditto "$NEW" "$C/orig-new.app"
run OMK_SUCC_APPEAR_SECONDS=0
t "종료 코드 ≠ 0" test "$RC" != 0
t "띄운 프로세스가 끝났다" app_dead
t "원래 OpenMake Code.app 이 그대로 돌아왔다" diff -r "$C/orig-new.app" "$NEW"
t ".old·.new 없음" eval '[ ! -e "$NEW.old" ] && [ ! -e "$NEW.new" ]'
t "옛 앱 그대로" old_intact
t "옛 앱 다시 열기 1회" reopens 1
t "실패 버전 기록" failed_recorded
t "표식 없음" marker_absent
t "FIFO·쓰는 쪽 없음 (⑦)" fifo_gone
t "키가 로그에 없다" key_not_logged
t "실패 문구" alerted MSG_LAUNCH

for c in "noapp:MSG_NO_APP" "badid:MSG_BUNDLE_ID" "badver:MSG_VERSION"; do
  echo "# dmg 검증 실패: ${c%%:*}"
  setup "${c%%:*}" "${c%%:*}"
  run
  t "종료 코드 ≠ 0" test "$RC" != 0
  t "아무것도 옮기지 않았다" nothing_left
  t "옛 앱 그대로" old_intact
  t "옛 앱 다시 열기 1회" reopens 1
  t "새 앱을 열지 않았다" opened_new 0
  t "실패 버전 기록" failed_recorded
  t "표식 없음" marker_absent
  t "문구 ${c#*:}" alerted "${c#*:}"
done

echo "# 복사 실패"
setup copyfail
chmod 555 "$C/Applications"
run
chmod 755 "$C/Applications"
t "종료 코드 ≠ 0" test "$RC" != 0
t "아무것도 옮기지 않았다" nothing_left
t "옛 앱 그대로" old_intact
t "옛 앱 다시 열기 1회" reopens 1
t "실패 버전 기록" failed_recorded
t "문구" alerted MSG_COPY

echo "# 열기 실패 (open ≠ 0)"
setup openfail
run FAKE_OPEN_EXIT=1 FAKE_OPEN_LAUNCH=0
t "종료 코드 ≠ 0" test "$RC" != 0
t "새 앱 제거" nothing_left
t "옛 앱 그대로" old_intact
t "옛 앱 다시 열기 1회" reopens 1
t "실패 버전 기록" failed_recorded
t "표식 없음" marker_absent
t "FIFO·쓰는 쪽 없음" fifo_gone
t "문구" alerted MSG_LAUNCH

echo "# ② open 0 인데 프로세스가 안 생긴다"
setup noproc
run FAKE_OPEN_LAUNCH=0 OMK_SUCC_APPEAR_SECONDS=1
t "종료 코드 ≠ 0" test "$RC" != 0
t "새 앱 제거" nothing_left
t "옛 앱 그대로, 다시 열기 1회" eval 'old_intact && reopens 1'
t "실패 버전 기록·표식 없음" eval 'failed_recorded && marker_absent'

echo "# ③⑩ 떴다가 1초 뒤 죽는다 → 되돌리기 A"
setup die1
run FAKE_MODE=die1
t "종료 코드 ≠ 0" test "$RC" != 0
t "새 앱 제거" nothing_left
t "옛 앱 번들 바이트 그대로" old_intact
t "옛 앱 open 1회" reopens 1
t "표식 없음" marker_absent
t "실패 버전 기록" failed_recorded
t "FIFO·쓰는 쪽 없음 (⑦)" fifo_gone

echo "# ① 새 앱 경로의 프로세스가 이미 돌고 있다 → 아무것도 옮기지 않는다"
setup running
make_app "$C/Applications" "OpenMake Code" cc.openmake.code 0.4.9 "OpenMake Code"
ditto "$NEW" "$C/orig-new.app"
"$NEW_EXEC" </dev/null >/dev/null 2>&1 &
RUNNING=$!; disown "$RUNNING"
STRAYS+=("$RUNNING")
sleep 0.3
run
t "종료 코드 0(실패가 아니다)" test "$RC" = 0
t "기존 앱 바이트 그대로" diff -r "$C/orig-new.app" "$NEW"
t ".new·.old 없음" eval '[ ! -e "$NEW.new" ] && [ ! -e "$NEW.old" ]'
t "그 프로세스가 살아 있다" kill -0 "$RUNNING"
t "옛 앱 그대로, 다시 열기 1회" eval 'old_intact && reopens 1'
t "새 앱을 열지 않았다" opened_new 0
t "실패 버전을 적지 않았다" not failed_recorded
t "표식을 만들지 않았다" marker_absent
t "실행 중 문구" alerted MSG_RUNNING
/bin/kill -KILL "$RUNNING" 2>/dev/null

echo "# ④ 새 앱 경로를 인자로만 가진 다른 프로세스"
setup decoy
mkdir -p "$C/elsewhere"
cp "$ROOT/fake-bin" "$C/elsewhere/decoy"
"$C/elsewhere/decoy" "$NEW_EXEC" </dev/null >/dev/null 2>&1 &
DECOY=$!; disown "$DECOY"
STRAYS+=("$DECOY")
sleep 0.3
run FAKE_OPEN_LAUNCH=0 OMK_SUCC_APPEAR_SECONDS=1
t "성공으로 치지 않았다(종료 코드 ≠ 0)" test "$RC" != 0
t "새 앱 제거·옛 앱 그대로" eval 'nothing_left && old_intact'
t "되돌리기가 그 프로세스를 죽이지 않았다" kill -0 "$DECOY"
/bin/kill -KILL "$DECOY" 2>/dev/null

echo "# ⑪ 되돌리기 B — 새 프로세스를 끝내지 못한다"
setup branchb
cat > "$C/bin/kill" <<'SH'
#!/bin/bash
# KILL 을 삼킨다(그 밖은 진짜 kill 로).
for a in "$@"; do case "$a" in -KILL|-9|-s\ KILL) exit 0 ;; esac; done
exec /bin/kill "$@"
SH
chmod +x "$C/bin/kill"
run FAKE_MODE=ignore-term OMK_SUCC_APPEAR_SECONDS=0
STRAYS+=("$(app_pid)")
t "종료 코드 ≠ 0" test "$RC" != 0
t "대역 프로세스가 아직 살아 있다(종료 미확인 상태를 만들었다)" kill -0 "$(app_pid)"
t "FIFO·쓰는 쪽이 없다" fifo_gone
t "새 앱 번들이 그대로다" new_is_dmg_app
t "표식이 남아 있다" test -f "$PENDING"
t "옛 앱 open 0회" reopens 0
t "B 문구" alerted MSG_KILL_FAILED
t "실패 버전 기록" failed_recorded
t "옛 앱 번들 그대로" old_intact
/bin/kill -KILL "$(app_pid)" 2>/dev/null

echo "# ⑫ 표식을 만들 수 없다"
setup nomarker
rm -rf "$C/support"; echo file > "$C/support"
run
t "종료 코드 ≠ 0" test "$RC" != 0
t "아무것도 옮기지 않았다" nothing_left
t "새 앱을 열지 않았다" opened_new 0
t "옛 앱 그대로, open 1회" eval 'old_intact && reopens 1'
t "실패 버전 기록" failed_recorded
t "문구" alerted MSG_PREPARE

echo "# ⑬ FIFO 를 만든 뒤 스크립트에 TERM"
setup term
run_bg FAKE_OPEN_PAUSE=1
wait_paused
STRAYS+=("$(app_pid)")
t "FIFO 가 만들어져 있었다" test -p "$KH"
kill -TERM "$SPID"; kill -CONT "$SPID"
wait "$SPID"
t "FIFO·쓰는 쪽이 남지 않는다 (trap EXIT)" fifo_gone
t "키가 로그에 없다" key_not_logged
/bin/kill -KILL "$(app_pid)" 2>/dev/null

echo "# ⑯ 절전 대역 — 멈춘 스크립트도 소유자로 살아 있다"
setup sleep
run_bg FAKE_OPEN_PAUSE=1
wait_paused
t "멈춘 동안 표식이 있다" test -f "$PENDING"
t "표식의 PID 가 살아 있다" kill -0 "$(cut -d' ' -f1 "$PENDING")"
t "참조 판정: 살아 있음" test "$(owner "$(cat "$PENDING")")" = alive
/bin/kill -KILL "$(app_pid)"; kill -CONT "$SPID"
wait "$SPID"; RC=$?
t "되돌리기 A: 종료 코드 ≠ 0" test "$RC" != 0
t "옛 앱 번들 바이트 그대로, open 1회" eval 'old_intact && reopens 1'
t "표식 없음" marker_absent

echo "# ⑱⑲ 시계 역행 대역 — 소유자 식별은 수정 시각과 무관"
setup clock
run_bg FAKE_OPEN_PAUSE=1
wait_paused
ST="$(cut -d' ' -f2 "$PENDING")"
touch -t "$(date -r $((ST - 3600)) +%Y%m%d%H%M.%S)" "$PENDING"
t "수정 시각이 스크립트 시작보다 1시간 앞: 참조 판정 살아 있음 (⑱)" test "$(owner "$(cat "$PENDING")")" = alive
t "같은 순간 r4 규칙은 끝남(r4 결함 재현)" test "$(owner_r4 "$PENDING")" = ended
touch -t "$(date -r $((ST + 86400)) +%Y%m%d%H%M.%S)" "$PENDING"
t "수정 시각을 하루 뒤로: 여전히 살아 있음 (⑲)" test "$(owner "$(cat "$PENDING")")" = alive
COPY="$(cat "$PENDING")"
/bin/kill -KILL "$(app_pid)"; kill -CONT "$SPID"
wait "$SPID"; RC=$?
t "되돌리기 A: 옛 앱 그대로, open 1회, 표식 없음" eval '[ "$RC" != 0 ] && old_intact && reopens 1 && marker_absent'
t "끝난 스크립트의 표식 사본: 끝남(PID 없음)" test "$(owner "$COPY")" = ended
sleep 2 # 다른 프로세스의 시작 시각이 1초 넘게 늦도록
"$ROOT/fake-bin" </dev/null >/dev/null 2>&1 &
OTHER=$!; disown "$OTHER"
STRAYS+=("$OTHER")
t "PID 를 다른 프로세스로 바꾼 사본: 끝남(시작 시각 다름)" test "$(owner "$OTHER ${COPY#* }")" = ended
t "시작 시각 칸을 지운 사본: 확인 불가 → 살아 있음" test "$(owner "${COPY%% *}")" = alive
/bin/kill -KILL "$OTHER" 2>/dev/null

echo "# ⑳ 시작 시각을 읽지 못한다(date 대역 실패)"
setup nodate
printf '#!/bin/bash\nexit 1\n' > "$C/bin/date"; chmod +x "$C/bin/date"
run
t "종료 코드 ≠ 0" test "$RC" != 0
t "표식이 없다" marker_absent
t "아무것도 옮기지 않았다" nothing_left
t "새 앱을 열지 않았다" opened_new 0
t "옛 앱 그대로, open 1회" eval 'old_intact && reopens 1'

echo "# ⑰ 정적: 스크립트가 표식의 나이·수정 시각을 읽거나 맞추지 않는다"
t "stat·find -mmin/-newer·touch 0건" not grep -nE '(^|[^A-Za-z_])stat([^A-Za-z_]|$)|-mmin|-mtime|-newer|(^|[^A-Za-z_])touch([^A-Za-z_]|$)' "$SCRIPT"
t "표식 뒤 판정을 exec·nohup 으로 넘기지 않는다" not grep -nE '^[^#]*\b(exec [^>]|nohup)' "$SCRIPT"

echo
echo "결과: 통과 $PASS, 실패 $FAIL"
[ "$FAIL" = 0 ]
