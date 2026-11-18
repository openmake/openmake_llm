#!/bin/bash
# 후속 앱 교체 스크립트 (plan-pr2.4 D-143·D-147·D-151·D-152, §3.2.1·§3.2.2) — 옛 정체성 앱(OpenMake Companion)을
# 같은 폴더의 후속 앱(OpenMake Code)으로 바꾼다. build.sh 가 앱 Contents/Resources/ 에 넣고, Updater 가 /bin/bash 로 띄운다.
# 값은 전부 환경 변수로 받는다(Swift 문자열에 끼워 넣지 않는다 — 셸 테스트가 이 바이트를 그대로 돈다).
#   OMK_SUCC_APP 옛 앱 경로 · OMK_SUCC_DMG 받은 dmg · OMK_SUCC_NAME 후속 앱 이름(<이름>.app)
#   OMK_SUCC_BUNDLE_ID·OMK_SUCC_VERSION dmg 안 앱이 가져야 할 번들 ID·버전 · OMK_SUCC_LOG 로그
#   OMK_SUCC_PENDING 교체 진행 표식 · OMK_KH 키 넘겨주기 FIFO(D-119)
#   OMK_SUCC_DEFAULTS_DOMAIN·OMK_SUCC_FAILED_KEY 실패 버전을 적는 곳(D-145) · OMK_UPD_*·OMK_SUCC_MSG_* 문구(앱이 다국어로 만든다)
# 키는 stdin 한 줄로만 받는다. 로그에 찍지 않는다(set -x·echo 금지).
#
# 교체 진행 표식(§3.2.2 — 다리가 나간 뒤에는 형식을 못 바꾼다): 내용은 `<이 스크립트의 PID> <그 프로세스의 시작 시각 epoch 초>`
# 한 줄. 소유자는 이 둘로만 식별한다 — 이 스크립트는 표식 파일의 시각 정보를 읽지도 맞추지도 않는다.
# 표식을 만든 뒤 확정·되돌리기가 끝날 때까지 이 셸(같은 PID)이 살아 있어야 하므로 그 뒤의 일을 다른 프로세스로 넘기지 않는다.
set -u

# 판정 시간(§3.2.1 단계 3·4). 첫 실행이 느린 장비에서 모자라면 이 두 줄을 고친다.
APPEAR_SECONDS="${OMK_SUCC_APPEAR_SECONDS:-15}"
SURVIVE_SECONDS="${OMK_SUCC_SURVIVE_SECONDS:-5}"
# 옛 앱이 끝날 시간(종전 교체 스크립트와 같다).
START_DELAY="${OMK_SUCC_START_DELAY:-2}"

exec >>"$OMK_SUCC_LOG" 2>&1
IFS= read -r -t 5 OMK_KEY || OMK_KEY=""

APP="$OMK_SUCC_APP"
DMG="$OMK_SUCC_DMG"
PENDING="$OMK_SUCC_PENDING"
KH="${OMK_KH:-}"
MNT=""
NEW=""
NEW_EXEC=""
STAGE=""
BACKUP=""
BACKED_UP=0
SWAPPED=0
LAUNCHED=0
KH_MADE=0
KH_PID=""
KH_REAPER=""

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) $*"; }

alert() {
  /usr/bin/env osascript -e "display alert \"$OMK_UPD_FAIL_TITLE\" message \"$1\n\n$OMK_UPD_LOG: $OMK_SUCC_LOG\" as critical" || true
}

record_failed() {
  defaults write "$OMK_SUCC_DEFAULTS_DOMAIN" "$OMK_SUCC_FAILED_KEY" -string "$OMK_SUCC_VERSION" || log "실패 버전 기록 실패"
}

reopen_old() { [ -d "$APP" ] && open -a "$APP" || true; }

# FIFO 정리(D-152 공통 1) — 쓰는 쪽을 끝내고 FIFO 를 지운다. 어느 종료 경로에서도 돈다(trap EXIT).
fifo_cleanup() {
  [ "$KH_MADE" = 1 ] || return 0
  [ -n "$KH_PID" ] && kill "$KH_PID" 2>/dev/null
  [ -n "$KH_REAPER" ] && kill "$KH_REAPER" 2>/dev/null
  rm -f "$KH"
  KH_MADE=0
}
trap fifo_cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

detach() { [ -n "$MNT" ] && hdiutil detach "$MNT" -quiet; MNT=""; }

# 자리 바꿈 이전 실패(마운트·검증·복사) — 새 프로세스도 FIFO 도 표식도 아직 없다.
fail_early() {
  log "FAIL: $1"
  detach
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  record_failed
  alert "$1"
  reopen_old
  rm -f "$DMG"
  exit 1
}

# "그 경로의 프로세스" — ps 의 comm 이 실행 파일 경로와 글자 그대로 같은 줄(정규식·명령줄 부분 일치를 쓰지 않는다).
pids_of() {
  ps -axo pid=,comm= | while read -r pid comm; do
    [ "$comm" = "$1" ] && echo "$pid"
  done
}

# 자기 시작 시각(epoch 초) — 커널이 프로세스를 만들 때 적은 값. 로캘·시간대에 흔들리지 않게 UTC·C 로 고정한다.
self_start() {
  local l
  l="$(TZ=UTC LC_ALL=C ps -o lstart= -p $$)" || return 1
  l="${l%"${l##*[! ]}"}"
  [ -n "$l" ] || return 1
  TZ=UTC LC_ALL=C date -j -f '%a %b %d %T %Y' "$l" +%s
}

# 되돌리기(§3.2.1 — 자리 바꿈 뒤 공통). 순서: FIFO 정리 → 새 프로세스 종료·확인 → 실패 버전 → 갈래 A/B.
rollback() {
  log "FAIL: $1 — 되돌리기"
  fifo_cleanup
  local left=""
  if [ "$LAUNCHED" = 1 ]; then
    local p i
    for p in $(pids_of "$NEW_EXEC"); do env kill -TERM "$p" 2>/dev/null; done
    for i in 1 2 3 4; do [ -z "$(pids_of "$NEW_EXEC")" ] && break; sleep 0.5; done
    for p in $(pids_of "$NEW_EXEC"); do env kill -KILL "$p" 2>/dev/null; done
    for i in 1 2; do [ -z "$(pids_of "$NEW_EXEC")" ] && break; sleep 0.5; done
    left="$(pids_of "$NEW_EXEC")"
  fi
  record_failed
  if [ -n "$left" ]; then
    # 갈래 B — 끝내지 못했다: 도는 앱의 번들을 지우지 않고, 표식을 남기고, 옛 앱을 다시 열지 않는다.
    log "종료 미확인: $(echo $left) — 새 앱·표식을 그대로 둔다. 남은 이전 앱: $BACKUP"
    alert "$OMK_SUCC_MSG_KILL_FAILED"
  else
    # 갈래 A — 새 앱을 지우고 같은 이름 앱이 있었으면 제자리로, 표식을 지우고 옛 앱을 다시 연다.
    [ "$SWAPPED" = 1 ] && rm -rf "$NEW"
    [ "$BACKED_UP" = 1 ] && { mv "$BACKUP" "$NEW" || log "이전 앱 복원 실패: $BACKUP"; }
    [ -n "$STAGE" ] && rm -rf "$STAGE"
    rm -f "$PENDING"
    alert "$1"
    reopen_old
  fi
  rm -f "$DMG"
  exit 1
}

sleep "$START_DELAY"

# ─── 받은 dmg 확인 ───
MNT="$(hdiutil attach -nobrowse -readonly "$DMG" | grep -o '/Volumes/.*' | tail -1)"
[ -n "$MNT" ] || fail_early "$OMK_SUCC_MSG_MOUNT"
SRC="$MNT/$OMK_SUCC_NAME.app"
[ -d "$SRC" ] || fail_early "$OMK_SUCC_MSG_NO_APP"
PLIST="$SRC/Contents/Info.plist"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null)" = "$OMK_SUCC_BUNDLE_ID" ] || fail_early "$OMK_SUCC_MSG_BUNDLE_ID"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null)" = "$OMK_SUCC_VERSION" ] || fail_early "$OMK_SUCC_MSG_VERSION"
EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST" 2>/dev/null)"
case "$EXE" in ""|*/*) fail_early "$OMK_SUCC_MSG_NO_APP" ;; esac

# 실행 파일 경로는 ps 의 comm 과 글자로 견주므로 실제 경로로 푼다(LaunchServices 는 실제 경로로 띄운다).
APP_DIR="$(cd "$(dirname "$APP")" && pwd -P)" || fail_early "$OMK_SUCC_MSG_COPY"
NEW="$APP_DIR/$OMK_SUCC_NAME.app"
NEW_EXEC="$NEW/Contents/MacOS/$EXE"
STAGE="$NEW.new"
BACKUP="$NEW.old"
# 앞선 갈래 B 가 남긴 .old 에는 사용자가 원래 가지고 있던 앱이 있을 수 있다 — 지우지 않고 멈춘다.
if [ -e "$BACKUP" ]; then
  log "남은 이전 앱: $BACKUP"
  fail_early "$OMK_SUCC_MSG_BACKUP_LEFT"
fi

rm -rf "$STAGE"
if ! ditto "$SRC" "$STAGE"; then
  rm -rf "$STAGE"
  fail_early "$OMK_SUCC_MSG_COPY"
fi
detach

# ─── 단계 1: 새 앱 경로의 프로세스가 없어야 한다(받는 동안 켜졌을 수 있다) ───
# 같은 자리에 이미 있던 앱의 실행 파일 이름이 다르면 그 경로도 본다.
OLD_NEW_EXEC=""
if [ -f "$NEW/Contents/Info.plist" ]; then
  E="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$NEW/Contents/Info.plist" 2>/dev/null)"
  [ -n "$E" ] && OLD_NEW_EXEC="$NEW/Contents/MacOS/$E"
fi
if [ -n "$(pids_of "$NEW_EXEC")" ] || { [ -n "$OLD_NEW_EXEC" ] && [ -n "$(pids_of "$OLD_NEW_EXEC")" ]; }; then
  # 실패가 아니다 — 교체 전부터 돌던 앱이다. 아무것도 옮기지 않고, 실패 버전을 적지 않고, 옛 앱을 다시 연다.
  log "새 앱이 이미 실행 중 — 아무것도 옮기지 않는다"
  rm -rf "$STAGE"
  alert "$OMK_SUCC_MSG_RUNNING"
  reopen_old
  rm -f "$DMG"
  exit 0
fi

# ─── 단계 2: 교체 진행 표식 → 자리 바꿈 → 격리 속성 제거 → FIFO → 열기 ───
# 표식은 같은 폴더의 임시 이름에 쓴 뒤 mv 로 바꿔 넣는다(반쯤 쓰인 표식을 보이지 않는다).
# 시작 시각을 읽지 못하면 소유자를 식별할 수 없는 표식이 되므로 만들지 않는다(종료 2 — 문구가 다르다).
make_pending() {
  local st tmp
  st="$(self_start)" || return 2
  case "$st" in ""|*[!0-9]*) return 2 ;; esac
  mkdir -p "$(dirname "$PENDING")" || return 1
  tmp="$PENDING.tmp.$$"
  ( umask 077 && printf '%s %s\n' "$$" "$st" > "$tmp" ) || { rm -f "$tmp"; return 1; }
  chmod 600 "$tmp" && mv -f "$tmp" "$PENDING" || { rm -f "$tmp"; return 1; }
}
make_pending
PENDING_RC=$?
if [ "$PENDING_RC" != 0 ]; then
  # 옮긴 것이 없다 — 되돌리기 A 에서 남는 것은 실패 버전·경고·옛 앱 다시 열기뿐이다.
  rm -rf "$STAGE"
  STAGE=""
  if [ "$PENDING_RC" = 2 ]; then rollback "$OMK_SUCC_MSG_START_TIME"; fi
  rollback "$OMK_SUCC_MSG_PREPARE"
fi

if [ -e "$NEW" ]; then
  mv "$NEW" "$BACKUP" || rollback "$OMK_SUCC_MSG_REPLACE"
  BACKED_UP=1
fi
mv "$STAGE" "$NEW" || rollback "$OMK_SUCC_MSG_REPLACE"
SWAPPED=1
STAGE=""
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null

# 키 넘겨주기(D-119·D-146): FIFO 는 디스크에 내용을 쓰지 않는다. 30초 정리는 이 스크립트가 강제 종료된 경우의 뒷문이다.
# 키가 있는데 FIFO 를 준비하지 못하면 되돌리기 A 로 간다 — 키 없이 옛 앱을 지우는 경로를 두지 않는다(D-146).
if [ -n "$OMK_KEY" ]; then
  if [ -n "$KH" ] && mkdir -p "$(dirname "$KH")" 2>/dev/null && rm -f "$KH" 2>/dev/null && mkfifo -m 600 "$KH" 2>/dev/null; then
    KH_MADE=1
    ( printf '%s' "$OMK_KEY" > "$KH" ) 2>/dev/null &
    KH_PID=$!
    ( sleep 30; kill "$KH_PID" 2>/dev/null; rm -f "$KH" ) >/dev/null 2>&1 &
    KH_REAPER=$!
    log "key-handoff writer $KH_PID"
  else
    OMK_KEY=""
    rollback "$OMK_SUCC_MSG_PREPARE"
  fi
fi
OMK_KEY=""

LAUNCHED=1
open "$NEW" || rollback "$OMK_SUCC_MSG_LAUNCH"

# ─── 단계 3: 새로 뜬 프로세스 하나를 잡는다 — 단계 1 에서 없음을 확인했으므로 여기서 보이는 것은 이번에 뜬 것이다 ───
PID=""
i=0
while [ "$i" -lt $((APPEAR_SECONDS * 2)) ]; do
  PID="$(pids_of "$NEW_EXEC" | head -1)"
  [ -n "$PID" ] && break
  sleep 0.5
  i=$((i + 1))
done
[ -n "$PID" ] || rollback "$OMK_SUCC_MSG_LAUNCH"
log "새 앱 프로세스 $PID"

# ─── 단계 4: 그 PID 가 생존 구간 내내 살아 있고, 끝에도 같은 실행 파일이다 ───
i=0
while [ "$i" -lt $((SURVIVE_SECONDS * 2)) ]; do
  kill -0 "$PID" 2>/dev/null || rollback "$OMK_SUCC_MSG_LAUNCH"
  sleep 0.5
  i=$((i + 1))
done
kill -0 "$PID" 2>/dev/null || rollback "$OMK_SUCC_MSG_LAUNCH"
[ "$(ps -p "$PID" -o comm= 2>/dev/null)" = "$NEW_EXEC" ] || rollback "$OMK_SUCC_MSG_LAUNCH"

# ─── 단계 5: 확정 — 옛 앱 삭제 → 표식 삭제 → .old·dmg·FIFO 정리 ───
# 옛 앱 삭제가 실패해도 새 앱이 살아 있으므로 교체는 확정이다(남은 옛 번들은 새 앱의 다음 기동이 다룬다).
rm -rf "$APP" || log "옛 앱 삭제 실패: $APP"
rm -f "$PENDING"
rm -rf "$BACKUP"
rm -f "$DMG"
fifo_cleanup
log "OK: $APP → $NEW"
exit 0
