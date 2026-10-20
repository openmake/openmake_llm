#!/usr/bin/env bash
# 대역 전역은 source 한 mac-host-repair.sh 가 읽는다.
# shellcheck disable=SC2034
# mac-host-repair.sh 시험 — 가짜 Homebrew·Colima·launchctl 로 임시 HOME 만 바꾼다.
# 실제 launchd·Docker·키체인·sudo·brew 는 호출하지 않는다. plist 검사(plutil)가 macOS 전용이라 macOS 에서만 돈다.
#   bash scripts/setup/mac-host-repair.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(uname -s)" != Darwin ]] || ! command -v plutil >/dev/null 2>&1; then echo "SKIP mac-host-repair.test (macOS 전용)"; exit 0; fi
command -v node >/dev/null 2>&1 || { echo "SKIP mac-host-repair.test (node 없음)"; exit 0; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "${LCTL_STATE:-}"' EXIT

HOME="$TMP/home with space"; mkdir -p "$HOME"; unset DOCKER_CONFIG
OMK_ROOT="$HOME/.openmake"
export COLIMA_HOME="$TMP/Ext & 'Colima'"
BREW="$TMP/brew"; BB="$BREW/bin"; mkdir -p "$BB" "$TMP/node24/bin"
ln -s "$(command -v node)" "$TMP/node24/bin/node"
for t in docker colima; do printf '#!/bin/sh\necho fake-%s\n' "$t" > "$BB/$t"; chmod +x "$BB/$t"; done
# Desktop 헬퍼: 레지스트리 하나. 키체인 헬퍼는 brew install 이 만든다 (파일에 저장).
cat > "$BB/docker-credential-desktop" <<'H'
#!/bin/sh
case "$1" in list) echo '{"reg.example":"u"}' ;; get) echo '{"ServerURL":"reg.example","Username":"u","Secret":"s3cret"}' ;; *) exit 1 ;; esac
H
chmod +x "$BB/docker-credential-desktop"
KEYCHAIN_HELPER="#!/bin/sh
KC='$TMP/keychain.json'
[ -f '$TMP/locked' ] && { echo 'keychain locked'; exit 1; }
case \"\$1\" in
  list) [ -f \"\$KC\" ] && echo '{\"reg.example\":\"u\"}' || echo '{}' ;;
  get) [ -f \"\$KC\" ] && cat \"\$KC\" || { echo 'credentials not found in native keychain'; exit 1; } ;;
  store) cat > \"\$KC\" ;;
  *) exit 1 ;;
esac"
BREW_CALLS="$TMP/brew-calls"; : > "$BREW_CALLS"
brew() {
    case "$1" in
        --prefix) printf '%s\n' "$BREW" ;;
        *) echo "$*" >> "$BREW_CALLS"
           if [[ "$*" == "install docker-credential-helper" ]]; then printf '%s\n' "$KEYCHAIN_HELPER" > "$BB/docker-credential-osxkeychain"; chmod +x "$BB/docker-credential-osxkeychain"; fi ;;
    esac
}
sudo() { echo "sudo $*" >> "$BREW_CALLS"; return 1; }
# shellcheck source=/dev/null
. "$HERE/fake-launchctl.test-lib.sh"
# shellcheck source=/dev/null
. "$HERE/mac-host-repair.sh"
desktop_root_artifacts() { :; }

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }
ORIG_PATH_FOR_TEST="$TMP/node24/bin:/usr/bin:/bin:/usr/sbin:/sbin"
OUT="$TMP/out"
run() { # $1=--check|--apply → 종료 코드 (출력은 $OUT)
    local rc=0
    (PATH="$ORIG_PATH_FOR_TEST"; SHELL=/bin/zsh; DOCKER_CONTEXT=colima; DOCKER_HOST=unix:///buzz.sock; export DOCKER_CONTEXT DOCKER_HOST; main "$1") > "$OUT" 2>&1 || rc=$?
    printf '%s' "$rc"
}
snapshot() { (cd "$HOME" && find . -print0 | sort -z | xargs -0 ls -ld 2>/dev/null | awk '{print $1, $NF}'; cat .docker/config.json 2>/dev/null; cat .zshrc 2>/dev/null); }
mkdir -p "$HOME/.docker"
printf '{"credsStore":"desktop","currentContext":"colima","auths":{"reg.example":{}}}' > "$HOME/.docker/config.json"
printf '# mine\nexport KEEP=1\n' > "$HOME/.zshrc"
# 실제 로그인 셸(env -i zsh -l -i)이 읽는 사용자 설정 — node 선택과 다른 Docker 작업의 컨텍스트
printf 'export PATH="%s/node24/bin:$PATH"\nexport DOCKER_CONTEXT=colima\n' "$TMP" > "$HOME/.zprofile"

# ── 외장 Colima 경로가 없으면(미마운트 등) 새 VM 을 만들지 않고 아무것도 바꾸지 않는다 ──
BEFORE="$(snapshot)"
eq "프로필 없음: 오류" "$(run --apply)" "2"
ok "프로필 없음: 대체 VM 을 만들지 않는다고 알림" 'grep -q "no replacement" "$OUT"'
eq "프로필 없음: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "프로필 없음: brew·sudo 호출 없음" "$(cat "$BREW_CALLS")" ""
eq "프로필 없음: launchctl 변경 없음" "$(fake_lctl_log)" ""
mkdir -p "$COLIMA_HOME/openmake"; : > "$COLIMA_HOME/openmake/colima.yaml"

# ── --check: 읽기만 한다 ──
BEFORE="$(snapshot)"
eq "check: 남은 항목 → 1" "$(run --check)" "1"
eq "check: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "check: brew·sudo 호출 없음" "$(cat "$BREW_CALLS")" ""
eq "check: launchctl 변경 없음" "$(fake_lctl_log)" ""
ok "check: 원래 node 근거" 'grep -qF "evidence: node $TMP/node24/bin/node" "$OUT"'
ok "check: 원래 docker 근거 (없음)" 'grep -qF "evidence: docker (none)" "$OUT"'
ok "check: 키체인 헬퍼 설치 예고" 'grep -q "docker-credential-helper" "$OUT"'
ok "check: 비밀값 미출력" '! grep -q s3cret "$OUT"'
ok "check: 로그인 셸 node 근거" 'grep -qF "evidence: login shell node $TMP/node24/bin/node" "$OUT"'
ok "check: 로그인 셸 Docker 환경 근거" 'grep -qF "evidence: login shell DOCKER_CONTEXT=colima DOCKER_HOST=(unset) COLIMA_HOME=(unset)" "$OUT"'

# ── 자격 증명 충돌·잠긴 키체인: 오류로 멈추고 PATH·launchd 는 바꾸지 않는다 ──
printf '%s\n' "$KEYCHAIN_HELPER" > "$BB/docker-credential-osxkeychain"; chmod +x "$BB/docker-credential-osxkeychain"
for case_name in collision locked; do
    if [[ $case_name == collision ]]; then printf '{"ServerURL":"reg.example","Username":"u","Secret":"other"}' > "$TMP/keychain.json"; else : > "$TMP/locked"; fi
    BEFORE="$(snapshot)"
    eq "$case_name: 오류 → 2" "$(run --apply)" "2"
    eq "$case_name: 파일 변경 없음" "$(snapshot)" "$BEFORE"
    eq "$case_name: launchctl 변경 없음" "$(fake_lctl_log)" ""
    ok "$case_name: 이후 단계(PATH·자동 시작) 없음" '! grep -qE "docker-bin|LaunchAgent|자동 시작" "$OUT"'
    ok "$case_name: 비밀값 미출력" '! grep -qE "s3cret|other" "$OUT"'
    rm -f "$TMP/keychain.json" "$TMP/locked"
done
rm -f "$BB/docker-credential-osxkeychain"; : > "$BREW_CALLS"

# ── --apply ──
eq "apply: 성공" "$(run --apply)" "0"
eq "apply: 없는 키체인 헬퍼만 설치, upgrade 없음" "$(cat "$BREW_CALLS")" "install docker-credential-helper"
ok "apply: 자격 증명 이전" 'grep -q s3cret "$TMP/keychain.json"'
ok "apply: 비밀값 미출력" '! grep -q s3cret "$OUT"'
eq "apply: credsStore" "$(node -p 'require(process.argv[1]).credsStore' "$HOME/.docker/config.json")" "osxkeychain"
eq "apply: 기본 컨텍스트 유지" "$(node -p 'require(process.argv[1]).currentContext' "$HOME/.docker/config.json")" "colima"
eq "apply: shim 은 docker·키체인 헬퍼만" "$(ls "$HOME/.local/share/openmake/docker-bin" | tr '\n' ' ')" "docker docker-credential-osxkeychain "
ok "apply: .zshrc 기존 내용 보존" '[[ "$(head -2 "$HOME/.zshrc")" == "# mine"$'"'"'\n'"'"'"export KEEP=1" ]]'
ok "apply: 로그인 셸에서도 같은 node" 'grep -qF "ok: login shell keeps node $TMP/node24/bin/node" "$OUT"'
ok "apply: 로그인 셸의 docker 는 shim" 'grep -qF "ok: login shell docker $HOME/.local/share/openmake/docker-bin/docker" "$OUT"'
ok "apply: 로그인 셸의 Docker 환경 보존" 'grep -qF "ok: login shell keeps DOCKER_CONTEXT=colima DOCKER_HOST=(unset) COLIMA_HOME=(unset)" "$OUT"'
ok "apply: 등록이 기존 프로필을 시작함을 알림" 'grep -q "기존 프로필 openmake 을 시작" "$OUT"'
ok "apply: 외장 COLIMA_HOME 을 자동 시작에 보존" 'grep -qF "<string>$TMP/Ext &amp; &apos;Colima&apos;</string>" "$HOME/Library/LaunchAgents/com.openmake.colima.plist"'
ok "apply: 자동 시작 plist 문법" 'plutil -lint "$HOME/Library/LaunchAgents/com.openmake.colima.plist" >/dev/null'
eq "apply: 등록" "$(fake_lctl_log)" "bootstrap"
ok "apply: 등록 확인과 재부팅 증명은 구분" 'grep -q "reboot" "$OUT"'

# ── 두 번째 --apply: 아무것도 바꾸지 않는다 ──
BEFORE="$(snapshot)"; : > "$BREW_CALLS"; : > "$LCTL_STATE/log"
eq "repeat: 성공" "$(run --apply)" "0"
eq "repeat: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "repeat: 건강한 등록은 그대로" "$(fake_lctl_log)" ""
eq "repeat: brew 호출 없음" "$(cat "$BREW_CALLS")" ""
eq "repeat: check 도 깨끗" "$(run --check)" "0"

# ── GUI 세션 없음(SSH 전용): 등록 보류로 보고, sudo 로 우회하지 않는다 ──
rm "$HOME/Library/LaunchAgents/com.openmake.colima.plist"; fake_lctl_reset 0
eq "no GUI: 보류 → 1" "$(run --apply)" "1"
ok "no GUI: 보류 안내" 'grep -q "^pending:" "$OUT"'
eq "no GUI: sudo·bootstrap 없음" "$(cat "$BREW_CALLS")|$(fake_lctl_log)" "|"
ok "no GUI: 정의는 기록" '[[ -f "$HOME/Library/LaunchAgents/com.openmake.colima.plist" ]]'
fake_lctl_reset 1; run --apply >/dev/null

# ── 사용자가 고친 LaunchAgent 는 건드리지 않고 수동 항목으로 알린다 ──
P="$HOME/Library/LaunchAgents/com.openmake.colima.plist"
sed 's|<key>RunAtLoad</key>|<key>KeepAlive</key><true/><key>RunAtLoad</key>|' "$P" > "$TMP/custom.plist"; cat "$TMP/custom.plist" > "$P"
: > "$LCTL_STATE/log"
eq "custom agent: 수동 → 1" "$(run --apply)" "1"
ok "custom agent: 수동 안내" 'grep -q "^manual:.*KeepAlive" "$OUT"'
ok "custom agent: 파일 그대로" 'cmp -s "$TMP/custom.plist" "$P"'
eq "custom agent: launchctl 변경 없음" "$(fake_lctl_log)" ""

# ── Desktop 의 root 헬퍼는 sudo 없이 보류로만 알린다 ──
cat "$P" > /dev/null; write_colima_agent "$P" "$BB/colima" "$OMK_ROOT/logs/colima.log" "$BB"
desktop_root_artifacts() { printf '%s\n' "$TMP"; }
: > "$BREW_CALLS"
eq "root 헬퍼: 보류 → 1" "$(run --apply)" "1"
ok "root 헬퍼: 보류 안내" 'grep -qF "pending: Docker Desktop root helper remains: $TMP" "$OUT"'
eq "root 헬퍼: sudo 없음" "$(cat "$BREW_CALLS")" ""
desktop_root_artifacts() { :; }

# ── 알려진 예전 손수 만든 에이전트: --save-config=false·소유자 HOME·외장 COLIMA_HOME·두 로그를 지키며 guard 로 바꾼다 ──
desktop_root_artifacts() { :; }
P="$HOME/Library/LaunchAgents/com.openmake.colima.plist"; LOGS="$HOME/Library/Logs"
legacy_agent() { # [$1=추가 인자]
    cat > "$P" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openmake.colima</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BB/colima</string>
        <string>start</string>
        <string>openmake</string>
        <string>--save-config=false</string>${1:-}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$(xml_escape "$HOME")</string>
        <key>COLIMA_HOME</key>
        <string>$(xml_escape "$COLIMA_HOME")</string>
        <key>PATH</key>
        <string>$BB:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$(xml_escape "$LOGS/colima-openmake.log")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "$LOGS/colima-openmake.error.log")</string>
</dict>
</plist>
EOF
}
legacy_agent; fake_lctl_reset; fake_lctl_load "$P"
eq "legacy: check → 1" "$(run --check)" "1"
ok "legacy: check 가 이어받을 설정을 알림" 'grep -q "save-config=false (kept" "$OUT"'
eq "legacy: apply → 0" "$(run --apply)" "0"
LA=(); LE=""; LK=""; LC=""; LO=""; LR=""
while IFS=$'\t' read -r tag v; do
    case "$tag" in A) LA+=("$v") ;; K) LK="$v" ;; V) [[ $LK == HOME ]] && LE="$v"; [[ $LK == COLIMA_HOME ]] && LC="$v" ;; O) LO="$v" ;; E) LR="$v" ;; esac
done < <(fake_plist_fields "$P")
eq "legacy: guard + 이어받은 플래그" "$(printf '%s|' "${LA[@]}")" "/bin/sh|-c|$COLIMA_AGENT_GUARD_WITH_FLAGS|$BB/colima|openmake|--save-config=false|"
eq "legacy: HOME·외장 COLIMA_HOME·두 로그 보존" "$LE|$LC|$LO|$LR" "$HOME|$COLIMA_HOME|$LOGS/colima-openmake.log|$LOGS/colima-openmake.error.log"
ok "legacy: plist 문법" 'plutil -lint "$P" >/dev/null'
ok "legacy: 이전 정의 백업" 'grep -l -- "<string>--save-config=false</string>" "$OMK_ROOT/backups/launchd/"*.before-colima-* >/dev/null'
eq "legacy: 다시 등록" "$(fake_lctl_log)" "bootout bootstrap"
BEFORE="$(snapshot)"; : > "$LCTL_STATE/log"
eq "legacy repeat: 성공" "$(run --apply)" "0"
eq "legacy repeat: 파일 변경 없음" "$(snapshot)" "$BEFORE"
eq "legacy repeat: 등록 그대로" "$(fake_lctl_log)" ""
# 비슷하지만 다른 정의(추가 인자)는 수동 항목으로 남기고 건드리지 않는다
legacy_agent "
        <string>--cpu</string>
        <string>4</string>"
fake_lctl_reset; fake_lctl_load "$P"; cp "$P" "$TMP/near-miss.plist"
eq "near-miss: 수동 → 1" "$(run --apply)" "1"
ok "near-miss: 수동 안내" 'grep -q "^manual:.*custom arguments" "$OUT"'
ok "near-miss: 파일 그대로" 'cmp -s "$TMP/near-miss.plist" "$P"'
eq "near-miss: launchctl 변경 없음" "$(fake_lctl_log)" ""

# ── 사용법 ──
eq "usage: 인자 없음" "$(run '')" "2"

echo ""; echo "mac-host-repair.test: $PASS passed, $FAIL failed (bash $BASH_VERSION)"
[[ $FAIL -eq 0 ]]
