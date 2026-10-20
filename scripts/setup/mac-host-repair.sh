#!/usr/bin/env bash
# ==============================================================================
# macOS 호스트 정리 — OpenMake 의 Docker 사용에서 Docker Desktop 의존을 걷어낸다.
#
#   bash scripts/setup/mac-host-repair.sh --check   # 읽기만 — 바꿀 항목을 보여 준다
#   bash scripts/setup/mac-host-repair.sh --apply   # 명시적으로 적용 (install_mac.sh 도 이것을 부른다)
#
# 하는 일 (OpenMake 를 설치한 사용자로 실행 — root·sudo 를 쓰지 않는다):
#   1) ~/.docker/config.json (DOCKER_CONFIG 존중): Desktop 자격 증명을 키체인으로 옮겨 검증한 뒤
#      credsStore/credHelpers 를 바꾸고, Desktop 이 준 플러그인 디렉터리·링크·훅만 걷어낸다.
#      이전에 필요할 때만 없는 docker-credential-helper 를 설치한다 (brew upgrade 없음).
#   2) 새 터미널: ~/.local/share/openmake/docker-bin (Homebrew docker·키체인 헬퍼 링크만)을 PATH 앞에 둔다.
#      node 등 다른 도구·기본 Docker 컨텍스트·DOCKER_HOST/DOCKER_CONTEXT/COLIMA_HOME 은 건드리지 않는다.
#   3) LaunchAgent com.openmake.colima: 기존 Colima 위치(외장 디스크 포함)로 정의·등록을 맞춘다.
#      건강하게 로드돼 있으면 그대로 둔다. GUI 세션이 없으면 등록을 보류로 알린다.
#      LaunchAgent 는 기존 프로필이 있을 때만 시작한다. 새로 등록하면(RunAtLoad) 멈춰 있던 기존 프로필이 시작된다.
# --apply 는 한 단계라도 오류면 그 자리에서 멈춘다 — 자격 증명 오류 뒤에 PATH·launchd 를 바꾸지 않는다.
# 검증은 실제 로그인 셸(env -i <셸> -l -i)로 한다: 적용 전후 node 실행 파일·버전과 Docker 환경변수가 같아야 한다.
# 하지 않는 일: 버전 변경·재부팅·VM 생성·PM2 조작·Docker Desktop 엔진 정지·이미지/볼륨 삭제·root 파일 변경.
#
# 종료 코드: 0 남은 항목 없음 / 1 바꿀 항목(--check)·수동·보류 항목 남음 / 2 오류·거부
# ==============================================================================
REPAIR_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(cd "$REPAIR_HERE/../.." && pwd)"
OMK_ROOT="${OMK_ROOT:-$HOME/.openmake}"
RECONCILER="$REPAIR_HERE/docker-config-reconcile.cjs"
readonly DOCKER_SHIM_DIR_RELATIVE=".local/share/openmake/docker-bin"
readonly KEYCHAIN_HELPER_FORMULA="docker-credential-helper"

PENDING=0; ERRORS=0
say() { printf '%s: %s\n' "$1" "$2"; }
pending() { PENDING=$((PENDING + 1)); say pending "$*"; }
manual() { PENDING=$((PENDING + 1)); say manual "$*"; }
failure() { ERRORS=$((ERRORS + 1)); say error "$*"; }
# 30-toolchain.sh 가 쓰는 install_mac.sh 도우미의 대역
log_info() { say info "$*"; }; log_ok() { say ok "$*"; }; log_warn() { say warn "$*"; }; log_step() { :; }
add_todo() { pending "$*"; }
die() { say error "$*"; exit 2; }

# shellcheck source=mac/30-toolchain.sh
. "$REPAIR_HERE/mac/30-toolchain.sh"

# Desktop 이 남기는 root 소유 파일 — 이 명령은 지우지 않는다 (sudo 를 쓰지 않는다).
desktop_root_artifacts() {
    printf '%s\n' /Library/PrivilegedHelperTools/com.docker.vmnetd \
        /Library/LaunchDaemons/com.docker.vmnetd.plist /Library/LaunchDaemons/com.docker.socket.plist
}

# 새 터미널과 같은 조건의 실제 로그인 셸 — 사용자 설정 파일만 읽고 이 프로세스의 환경은 넘기지 않는다.
# 출력: node=… · node_version=… · docker=… · docker_env=…
login_shell_probe() {
    local shell="${SHELL:-/bin/zsh}"
    case "$shell" in */zsh|*/bash) ;; *) shell=/bin/zsh ;; esac
    # shellcheck disable=SC2016  # 로그인 셸 안에서 펼친다
    env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" SHELL="$shell" TERM=dumb "$shell" -l -i -c '
        n="$(command -v node 2>/dev/null)"
        printf "OMKPROBE:node=%s\n" "$n"
        printf "OMKPROBE:node_version=%s\n" "$([ -n "$n" ] && "$n" -v 2>/dev/null)"
        printf "OMKPROBE:docker=%s\n" "$(command -v docker 2>/dev/null)"
        printf "OMKPROBE:docker_env=DOCKER_CONTEXT=%s DOCKER_HOST=%s COLIMA_HOME=%s\n" "${DOCKER_CONTEXT-(unset)}" "${DOCKER_HOST-(unset)}" "${COLIMA_HOME-(unset)}"
    ' </dev/null 2>/dev/null | sed -n 's/^OMKPROBE://p'
}
probe_field() { printf '%s\n' "$1" | sed -n "s/^$2=//p"; }

# PATH 를 바꾸기 전의 근거 — 뒤의 로그인 셸 검증이 이 값과 비교한다.
capture_evidence() {
    ORIG_NODE="$(command -v node 2>/dev/null || true)"
    ORIG_DOCKER="$(command -v docker 2>/dev/null || true)"
    say evidence "node ${ORIG_NODE:-(none)}${ORIG_NODE:+ $("$ORIG_NODE" -v 2>/dev/null)}"
    say evidence "docker ${ORIG_DOCKER:-(none)}${ORIG_DOCKER:+ -> $(readlink "$ORIG_DOCKER" 2>/dev/null || echo "$ORIG_DOCKER")}"
    say evidence "DOCKER_CONTEXT=${DOCKER_CONTEXT-(unset)} DOCKER_HOST=${DOCKER_HOST-(unset)} (left unchanged)"
    LOGIN_BEFORE="$(login_shell_probe)"
    say evidence "login shell node $(probe_field "$LOGIN_BEFORE" node) $(probe_field "$LOGIN_BEFORE" node_version)"
    say evidence "login shell docker $(probe_field "$LOGIN_BEFORE" docker)"
    say evidence "login shell $(probe_field "$LOGIN_BEFORE" docker_env)"
}

resolve_brew() {
    local brew
    brew="$(command -v brew 2>/dev/null || true)"
    [[ -n "$brew" ]] || for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$brew" ]] && break; done
    BREW_PREFIX="$("$brew" --prefix 2>/dev/null)" && [[ -n "$BREW_PREFIX" ]] || { say error "Homebrew not found"; exit 2; }
    BREW_BIN="$BREW_PREFIX/bin"; BREW_CMD="$brew"
    local major; major="$(node_version_pinned "$SCRIPT_DIR" | cut -d. -f1)"
    NODE_BIN="${ORIG_NODE:-$BREW_PREFIX/opt/node@$major/bin/node}"
    [[ -x "$NODE_BIN" ]] || { say error "node not found (expected node@$major); nothing was changed"; exit 2; }
}

# 기존 VM 만 쓴다 — 경로가 없으면(외장 디스크 미마운트 등) 새 VM 을 만들지 않고 멈춘다.
require_colima_profile() {
    [[ -x "$BREW_BIN/colima" ]] || { say error "$BREW_BIN/colima not found; nothing was changed"; exit 2; }
    if ! colima_profile_exists; then
        say error "Colima profile $COLIMA_PROFILE not found at $COLIMA_DIR (external disk not mounted?); no replacement VM is created and nothing was changed"
        exit 2
    fi
    say evidence "COLIMA_HOME $OPENMAKE_COLIMA_HOME"
    if COLIMA_HOME="$OPENMAKE_COLIMA_HOME" "$BREW_BIN/colima" status --profile "$COLIMA_PROFILE" >/dev/null 2>&1; then
        say info "Colima $COLIMA_PROFILE is running"
    else
        say info "Colima $COLIMA_PROFILE is not running (not started by this command)"
    fi
}

reconciler() { "$NODE_BIN" "$RECONCILER" "$@" --brew-prefix "$BREW_PREFIX"; }

repair_docker_config() {
    local rc=0
    if [[ $MODE == apply ]] && reconciler needs-keychain-helper; then
        HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_UPGRADE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 \
            "$BREW_CMD" install "$KEYCHAIN_HELPER_FORMULA" >/dev/null \
            || { failure "brew install $KEYCHAIN_HELPER_FORMULA failed"; return 0; }
    fi
    reconciler config ${APPLY_FLAG:+"$APPLY_FLAG"} || rc=$?
    case $rc in 0) ;; 1) PENDING=$((PENDING + 1)) ;; *) ERRORS=$((ERRORS + 1)) ;; esac
}

repair_docker_shim() {
    local rc=0 after shim_docker
    reconciler shim --home "$HOME" ${APPLY_FLAG:+"$APPLY_FLAG"} || rc=$?
    case $rc in 0) ;; 1) PENDING=$((PENDING + 1)); return 0 ;; *) ERRORS=$((ERRORS + 1)); return 0 ;; esac
    [[ $MODE == apply ]] || return 0
    # 실제 로그인 셸에서: node 실행 파일·버전과 Docker 환경변수는 그대로, docker 만 shim 이어야 한다.
    after="$(login_shell_probe)"; shim_docker="$HOME/$DOCKER_SHIM_DIR_RELATIVE/docker"
    if [[ "$(probe_field "$after" node)|$(probe_field "$after" node_version)" == "$(probe_field "$LOGIN_BEFORE" node)|$(probe_field "$LOGIN_BEFORE" node_version)" ]]; then
        say ok "login shell keeps node $(probe_field "$after" node) $(probe_field "$after" node_version)"
    else
        failure "login shell node changed: $(probe_field "$LOGIN_BEFORE" node) $(probe_field "$LOGIN_BEFORE" node_version) -> $(probe_field "$after" node) $(probe_field "$after" node_version)"
    fi
    if [[ "$(probe_field "$after" docker_env)" == "$(probe_field "$LOGIN_BEFORE" docker_env)" ]]; then
        say ok "login shell keeps $(probe_field "$after" docker_env)"
    else
        failure "login shell Docker environment changed: $(probe_field "$LOGIN_BEFORE" docker_env) -> $(probe_field "$after" docker_env)"
    fi
    if [[ "$(probe_field "$after" docker)" == "$shim_docker" ]]; then say ok "login shell docker $shim_docker"
    else failure "login shell docker is $(probe_field "$after" docker) (expected $shim_docker; check the login shell startup files)"; fi
}

agent_field() { printf '%s\n' "$1" | sed -n "s/^$2=//p"; }

repair_colima_agent() {
    local report state log err flag home reasons
    report="$(reconciler agent --plist "$COLIMA_AGENT_PLIST" --colima "$BREW_BIN/colima" --colima-home "$OPENMAKE_COLIMA_HOME" --owner-home "$HOME")"
    state="$(agent_field "$report" state)"; log="$(agent_field "$report" log)"; err="$(agent_field "$report" err)"
    # 알려진 예전 에이전트에서 이어받는 값 (그 밖의 정의는 conflict 로 손대지 않는다)
    flag="$(agent_field "$report" flags)"; home="$(agent_field "$report" home)"
    reasons="$(agent_field "$report" reason | paste -sd ';' -)"
    if [[ $state == conflict ]]; then
        manual "$COLIMA_AGENT_PLIST has custom settings ($reasons); left unchanged"
        return 0
    fi
    log="${log:-$OMK_ROOT/logs/colima.log}"
    err="${err:-$log}"
    if [[ $state == healthy ]] && colima_agent_loaded_matches "$BREW_BIN/colima" "$BREW_BIN" "$log" "$err" "$flag" "$home"; then
        say ok "LaunchAgent $COLIMA_AGENT defined and loaded as expected (proof of start after reboot needs a reboot)"
        return 0
    fi
    if [[ $MODE == check ]]; then
        PENDING=$((PENDING + 1)); say fix "write/register LaunchAgent $COLIMA_AGENT (${reasons:-definition not loaded}); registering starts the existing profile if it is stopped"
        return 0
    fi
    if ! PATH="$BREW_BIN:$PATH" enable_docker_autostart "$log" "$err" "$flag" "$home"; then
        failure "LaunchAgent $COLIMA_AGENT was not changed"
        return 0
    fi
    if colima_agent_loaded_matches "$BREW_BIN/colima" "$BREW_BIN" "$log" "$err" "$flag" "$home"; then
        say ok "LaunchAgent $COLIMA_AGENT registered and verified (proof of start after reboot needs a reboot)"
    elif colima_gui_domain_available; then
        pending "LaunchAgent $COLIMA_AGENT registration could not be verified"
    fi
}

report_desktop_leftovers() {
    local f
    while IFS= read -r f; do
        [[ -n "$f" && -e "$f" ]] && pending "Docker Desktop root helper remains: $f (remove with Docker Desktop's uninstaller once Desktop is retired; not removed here)"
    done < <(desktop_root_artifacts)
    for f in /usr/local/bin/docker /usr/local/bin/docker-compose /usr/local/bin/docker-credential-desktop; do
        [[ -L "$f" && "$(readlink "$f")" == *"/Docker.app/"* ]] && say info "$f links into Docker.app; managed shells use $HOME/$DOCKER_SHIM_DIR_RELATIVE first"
    done
    if pgrep -xq "com.docker.backend" 2>/dev/null; then say info "Docker Desktop engine is running; it was not stopped"; fi
    return 0
}

main() {
    case "${1:-}" in
        --check) MODE=check; APPLY_FLAG="" ;;
        --apply) MODE=apply; APPLY_FLAG="--apply" ;;
        *) printf 'usage: %s --check|--apply\n' "${BASH_SOURCE[0]}" >&2; exit 2 ;;
    esac
    [[ "$(uname -s)" == Darwin ]] || { say error "macOS only"; exit 2; }
    [[ "$(id -u)" != 0 ]] || { say error "run as the user who owns OpenMake, not root"; exit 2; }
    PENDING=0; ERRORS=0
    capture_evidence
    resolve_brew
    require_colima_profile
    local step
    for step in repair_docker_config repair_docker_shim repair_colima_agent; do
        "$step"
        # 적용 중 오류면 다음 단계(PATH·launchd)를 바꾸지 않는다.
        if [[ $MODE == apply && $ERRORS -gt 0 ]]; then say result "error ($ERRORS); later steps were not applied"; exit 2; fi
    done
    report_desktop_leftovers
    if [[ $ERRORS -gt 0 ]]; then say result "error ($ERRORS)"; exit 2; fi
    if [[ $PENDING -gt 0 ]]; then say result "$PENDING item(s) pending"; exit 1; fi
    say result "ok"; exit 0
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || { set -uo pipefail; main "$@"; }
