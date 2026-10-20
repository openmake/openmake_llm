#!/usr/bin/env bash
# ==============================================================================
# macOS PM2 부팅 복구 등록 — 로그인 때 저장된 PM2 앱(dump)을 의존성이 준비된 뒤 되살린다.
#
#   bash scripts/setup/mac-pm2-boot.sh --check               # 읽기만 — 바꿀 항목·근거를 보여 준다
#   bash scripts/setup/mac-pm2-boot.sh --apply               # 명시적으로 적용 (install_mac.sh 의 80-finish 도 이것을 부른다)
#   ... [--no-docker]                                        # 전용 Docker 없이 설치한 호스트 (DB/Redis 를 기다리지 않는다)
#
# OpenMake 를 설치한 사용자로 실행한다 (root·sudo 를 쓰지 않는다). PM2_HOME·COLIMA_HOME 은 지금 값을 그대로 쓴다.
# 하는 일:
#   1) 저장된 dump($PM2_HOME/dump.pm2)가 있고 유효하며, 그 경로(작업 폴더·실행 파일·절대 경로 인터프리터)가 지금 있어야 한다.
#      없으면 아무것도 바꾸지 않는다.
#   2) 다른 PM2 부팅 등록(사용자·/Library LaunchAgents·LaunchDaemons 파일, 로드된 작업)을 찾는다.
#      사용자 본인의 건강한 `pm2 startup` 에이전트(pm2.<user>, 같은 PM2_HOME, 로드됨)면 그대로 두고 끝낸다.
#      그 밖의 것(root·시스템·다른 PM2_HOME·로드 안 된 파일·알 수 없는 작업)이면 거부한다 — 이중 등록을 만들지 않는다.
#   3) 전용 Colima 의 DB/Redis 컨테이너(openmake[-<env>]-postgres|redis, 재시작 정책 있음)를 부팅 때 기다릴 대상으로 고른다.
#   4) --apply: dump 를 본인만 읽는 백업으로 남기고, 가드(pm2-boot-guard.sh)를 저장소 밖(~/.local/share/openmake)에 두고,
#      LaunchAgent com.openmake.pm2 를 쓰고 등록한 뒤 launchd 가 들고 있는 정의를 확인한다.
#      등록하면(RunAtLoad) 가드가 곧바로 한 번 돈다 — 이미 실행 중인 앱은 pm2 resurrect 가 건너뛴다.
# 하지 않는 일: pm2 save·dump 쓰기·환경 변경·빌드·마이그레이션·업데이트·VM/컨테이너 생성·root 파일 변경.
#
# 종료 코드: 0 남은 항목 없음 / 1 바꿀 항목(--check)·보류 항목 남음 / 2 오류·거부
# ==============================================================================
PM2_BOOT_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034  # source 한 30-toolchain.sh 가 읽는다
SCRIPT_DIR="$(cd "$PM2_BOOT_HERE/../.." && pwd)"
OMK_ROOT="${OMK_ROOT:-$HOME/.openmake}"

PENDING=0; ERRORS=0
say() { printf '%s: %s\n' "$1" "$2"; }
pending() { PENDING=$((PENDING + 1)); say pending "$*"; }
failure() { ERRORS=$((ERRORS + 1)); say error "$*"; }
# 30-toolchain.sh 가 쓰는 install_mac.sh 도우미의 대역
log_info() { say info "$*"; }; log_ok() { say ok "$*"; }; log_warn() { say warn "$*"; }; log_step() { :; }
add_todo() { pending "$*"; }
die() { say error "$*"; exit 2; }

# xml_escape · Colima 경로 · launchd 정의 비교 도우미를 Colima 에이전트와 같이 쓴다.
# shellcheck source=mac/30-toolchain.sh
. "$PM2_BOOT_HERE/mac/30-toolchain.sh"

readonly PM2_BOOT_AGENT="com.openmake.pm2"
PM2_BOOT_PLIST="$HOME/Library/LaunchAgents/$PM2_BOOT_AGENT.plist"
PM2_BOOT_GUARD_SRC="$PM2_BOOT_HERE/pm2-boot-guard.sh"
PM2_BOOT_GUARD="$HOME/.local/share/openmake/pm2-boot-guard.sh"
PM2_BOOT_LOG="$OMK_ROOT/logs/pm2-boot.log"
PM2_BOOT_BACKUP_DIR="$OMK_ROOT/backups/pm2"
PM2_BOOT_SCAN_DIRS=("$HOME/Library/LaunchAgents" /Library/LaunchAgents /Library/LaunchDaemons)

# 에이전트 PATH — 선택된 node 의 디렉터리가 먼저다 (pm2 의 #!/usr/bin/env node 와 앱의 "node" 인터프리터).
pm2_boot_path() { printf '%s' "$(dirname "$PM2_NODE"):/usr/bin:/bin:/usr/sbin:/sbin"; }

# ProgramArguments (한 줄에 하나)
pm2_boot_args() {
    printf '%s\n' /bin/bash "$PM2_BOOT_GUARD" run "$PM2_NODE" "$PM2_BIN" "${PM2_DOCKER:--}" "${PM2_DOCKER_HOST:--}"
    [[ -z "$PM2_CONTAINERS" ]] || printf '%s\n' "$PM2_CONTAINERS"
}

write_pm2_boot_agent() { # $1=plist
    local a args="" nl=$'\n'
    while IFS= read -r a; do args="$args$nl        <string>$(xml_escape "$a")</string>"; done < <(pm2_boot_args)
    cat > "$1" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PM2_BOOT_AGENT</string>
    <key>ProgramArguments</key>
    <array>$args
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$(xml_escape "$HOME")</string>
        <key>OMK_PM2_BACKUP_DIR</key>
        <string>$(xml_escape "$PM2_BOOT_BACKUP_DIR")</string>
        <key>PATH</key>
        <string>$(xml_escape "$(pm2_boot_path)")</string>
        <key>PM2_HOME</key>
        <string>$(xml_escape "$PM2_HOME_DIR")</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>AbandonProcessGroup</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$(xml_escape "$PM2_BOOT_LOG")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "$PM2_BOOT_LOG")</string>
</dict>
</plist>
EOF
}

pm2_boot_expected_print() {
    local a
    printf '%s\n' "path = $PM2_BOOT_PLIST" "program = /bin/bash"
    while IFS= read -r a; do printf 'arg=%s\n' "$a"; done < <(pm2_boot_args)
    printf '%s\n' "stdout path = $PM2_BOOT_LOG" "stderr path = $PM2_BOOT_LOG" \
        "env=HOME => $HOME" "env=OMK_PM2_BACKUP_DIR => $PM2_BOOT_BACKUP_DIR" "env=PATH => $(pm2_boot_path)" "env=PM2_HOME => $PM2_HOME_DIR"
}

pm2_boot_loaded_matches() {
    local out
    out="$(launchctl print "$(colima_gui_domain)/$PM2_BOOT_AGENT" 2>/dev/null)" || return 1
    [[ "$(printf '%s\n' "$out" | colima_agent_print_canonical)" == "$(pm2_boot_expected_print)" ]]
}

# 로드된 우리 작업의 마지막 실행이 실패로 끝났으면 그 설명을 출력한다 (실행 중·성공·아직 끝난 적 없음 = 빈 출력).
pm2_boot_last_failure() {
    launchctl print "$(colima_gui_domain)/$PM2_BOOT_AGENT" 2>/dev/null | awk '
        { sub(/^[[:space:]]+/, "") }
        /^state = / && st == "" { st = substr($0, 9) }
        /^last exit code = / && code == "" { code = substr($0, 18) }
        END { if (st != "running" && code ~ /^-?[0-9]+/ && code !~ /^0([^0-9]|$)/) print "last exit code " code }'
}

resolve_tools() {
    PM2_HOME_DIR="${PM2_HOME:-$HOME/.pm2}"
    PM2_NODE="$(command -v node 2>/dev/null || true)"
    PM2_BIN="$(command -v pm2 2>/dev/null || true)"
    [[ -n "$PM2_NODE" && -x "$PM2_NODE" ]] || die "node not found in PATH; nothing was changed"
    [[ -n "$PM2_BIN" ]] || die "pm2 not found in PATH; nothing was changed"
    [[ "$PM2_HOME_DIR" == /* ]] || die "PM2_HOME must be an absolute path; nothing was changed"
    say evidence "PM2_HOME $PM2_HOME_DIR"
    say evidence "node $PM2_NODE $("$PM2_NODE" -v 2>/dev/null)"
    say evidence "pm2 $PM2_BIN"
}

# 저장된 dump 가 유효하고 그 경로가 지금 있어야 한다 — 부팅 가드가 같은 검사로 기다린다.
require_dump() {
    local report p missing=""
    report="$(PM2_HOME="$PM2_HOME_DIR" /bin/bash "$PM2_BOOT_GUARD_SRC" inspect "$PM2_NODE" 2>&1)" \
        || die "$report; no saved PM2 apps to restore, nothing was changed"
    while IFS= read -r p; do [[ -e "$p" ]] || missing="$missing $p"; done < <(printf '%s\n' "$report" | sed -n 's/^path=//p')
    [[ -z "$missing" ]] || die "saved PM2 apps refer to missing path(s):$missing (external disk not mounted?); nothing was changed"
    say evidence "saved apps $(printf '%s\n' "$report" | sed -n 's/^app=//p' | paste -sd ' ' -)"
}

# 부팅 때 기다릴 전용 DB/Redis — 지금 실행 중이고 VM 과 함께 다시 뜨는(unless-stopped·always) 것만.
resolve_containers() {
    PM2_DOCKER=""; PM2_DOCKER_HOST=""; PM2_CONTAINERS=""
    if [[ $NO_DOCKER -eq 1 ]]; then say info "--no-docker: boot does not wait for DB/Redis containers"; return 0; fi
    colima_profile_exists || die "Colima profile $COLIMA_PROFILE not found at $COLIMA_DIR (external disk not mounted?); nothing was changed"
    PM2_DOCKER="$(command -v docker 2>/dev/null || true)"
    [[ -n "$PM2_DOCKER" ]] || die "docker not found in PATH; nothing was changed"
    # OpenMake 명령과 같은 규칙으로 전용 소켓을 고른다 (이 프로세스 안에서만).
    openmake_select_docker Darwin "$HOME" || die "cannot select the dedicated Docker socket; nothing was changed"
    PM2_DOCKER_HOST="$DOCKER_HOST"
    local names c policy state pg=0 rd=0
    names="$("$PM2_DOCKER" ps -a --format '{{.Names}}' 2>/dev/null)" \
        || die "dedicated Docker ($PM2_DOCKER_HOST) is not reachable; start Colima profile $COLIMA_PROFILE first. Nothing was changed"
    while IFS= read -r c; do
        [[ "$c" =~ ^openmake(-[a-z0-9-]+)?-(postgres|redis)$ ]] || continue
        read -r policy state < <("$PM2_DOCKER" inspect -f '{{.HostConfig.RestartPolicy.Name}} {{.State.Status}}' "$c" 2>/dev/null)
        # 직접 멈춘 unless-stopped 컨테이너는 VM 과 함께 다시 뜨지 않는다 — 기다리면 복구가 막히므로 지금 실행 중인 것만.
        case "$policy/$state" in
            unless-stopped/running|always/running) ;;
            *) say info "container $c (restart ${policy:-none}, ${state:-unknown}) is not expected after reboot; boot does not wait for it"; continue ;;
        esac
        PM2_CONTAINERS="$PM2_CONTAINERS${PM2_CONTAINERS:+$'\n'}$c"
        case "$c" in *-postgres) pg=$((pg + 1)) ;; *) rd=$((rd + 1)) ;; esac
    done < <(printf '%s\n' "$names" | LC_ALL=C sort)
    [[ $pg -gt 0 && $rd -gt 0 ]] || die "no dedicated PostgreSQL and Redis containers found on $PM2_DOCKER_HOST; nothing was changed (use --no-docker only for installs without Docker)"
    say evidence "boot waits for $(printf '%s' "$PM2_CONTAINERS" | paste -sd ' ' -)"
}

plist_json() { plutil -convert json -o - "$1" 2>/dev/null; }

# 이 사용자의 표준 `pm2 startup` 에이전트가 건강한가: 본인 소유 · 라벨 pm2.<user> · resurrect · 같은 PM2_HOME · 그 파일로 로드됨
pm2_startup_agent_healthy() { # $1=plist
    local user json loaded
    user="$(id -un)"
    [[ "$1" == "$HOME/Library/LaunchAgents/pm2.$user.plist" ]] || return 1
    [[ "$(stat -f %u "$1" 2>/dev/null)" == "$(id -u)" ]] || return 1
    json="$(plist_json "$1")" || return 1
    "$PM2_NODE" -e '
        const j = JSON.parse(process.argv[1]), [label, home] = process.argv.slice(2);
        const args = (j.ProgramArguments || []).join(" ");
        process.exit(j.Label === label && /(^|[\s\/])pm2 resurrect$/.test(args) && (j.EnvironmentVariables || {}).PM2_HOME === home ? 0 : 1);
    ' "$json" "pm2.$user" "$PM2_HOME_DIR" || return 1
    loaded="$(launchctl print "$(colima_gui_domain)/pm2.$user" 2>/dev/null)" || return 1
    [[ "$(printf '%s\n' "$loaded" | sed -n 's/^[[:space:]]*path = //p' | head -1)" == "$1" ]]
}

# $1=plist — PM2 부팅 등록이면 그 Label 을 출력하고 0. 파일 이름, 또는 실제 정의(XML·바이너리)의
# Program/ProgramArguments 에 pm2 와 resurrect 가 있는지 본다 (인자가 <string> 하나씩 여러 줄이어도, 라벨이 무엇이든).
# 읽을 수 없는 정의는 원문에 pm2 가 있으면 등록으로 본다 (모르면 거부 쪽).
plist_pm2_label() {
    local json
    if ! json="$(plist_json "$1")"; then
        grep -qi pm2 "$1" 2>/dev/null || return 1
        basename "$1" .plist; return 0
    fi
    "$PM2_NODE" -e '
        const j = JSON.parse(process.argv[1]), named = /^(pm2\.|com\.pm2\.plist$)|\.pm2\.plist$/i.test(process.argv[2]);
        const args = [j.Program, ...(Array.isArray(j.ProgramArguments) ? j.ProgramArguments : [])].filter(a => typeof a === "string").join(" ");
        if (!named && !(/(^|[\s\/])pm2(\s|$)/i.test(args) && /(^|\s)resurrect(\s|$)/.test(args))) process.exit(1);
        process.stdout.write(typeof j.Label === "string" && j.Label ? j.Label : process.argv[2].replace(/\.plist$/, ""));
    ' "$json" "$(basename "$1")"
}

# 다른 PM2 부팅 등록 → "kept <파일>" 또는 "conflict <설명>" (한 줄에 하나)
scan_pm2_registrations() {
    local d f label seen=""
    for d in "${PM2_BOOT_SCAN_DIRS[@]}"; do
        [[ -d "$d" ]] || continue
        for f in "$d"/*.plist; do
            [[ -f "$f" && "$f" != "$PM2_BOOT_PLIST" ]] || continue
            label="$(plist_pm2_label "$f")" || continue
            seen="$seen${seen:+$'\n'}$label"
            if pm2_startup_agent_healthy "$f"; then printf 'kept %s\n' "$f"
            else printf 'conflict %s (owner uid %s)\n' "$f" "$(stat -f %u "$f" 2>/dev/null)"; fi
        done
    done
    # 파일 없이 로드된 작업 (다른 위치에서 load 한 것 등)
    for d in "$(colima_gui_domain)" system; do
        while IFS= read -r label; do
            [[ -n "$label" && "$label" != "$PM2_BOOT_AGENT" ]] || continue
            printf '%s\n' "$seen" | grep -qxF "$label" && continue
            printf 'conflict loaded job %s/%s\n' "$d" "$label"
        done < <(launchctl print "$d" 2>/dev/null | awk '/^[[:space:]]*services = \{/ { s = 1; next } s && /^[[:space:]]*\}/ { s = 0 } s { print $NF }' \
            | grep -iE '(^|\.)pm2(\.|$)')
    done
}

own_registration_present() { [[ -f "$PM2_BOOT_PLIST" || -f "$PM2_BOOT_GUARD" ]] || launchctl print "$(colima_gui_domain)/$PM2_BOOT_AGENT" >/dev/null 2>&1; }

check_other_registrations() { # → 0 계속 / 그 밖 = 끝냄 (종료 코드는 main 이 정한다)
    local found line kept=0
    found="$(scan_pm2_registrations)"
    [[ -n "$found" ]] || return 0
    while IFS= read -r line; do
        case "$line" in
            kept\ *) kept=$((kept + 1)); say ok "existing PM2 startup agent ${line#kept } is healthy (same PM2_HOME, loaded); left unchanged" ;;
            conflict\ *) failure "other PM2 boot registration: ${line#conflict }; left unchanged — remove it yourself (e.g. 'pm2 unstartup') and rerun" ;;
        esac
    done <<< "$found"
    if [[ $ERRORS -eq 0 && $kept -gt 0 ]] && own_registration_present; then
        failure "both an existing PM2 startup agent and $PM2_BOOT_AGENT are present (double restore); remove one"
    fi
    return 1
}

# 바꾸기 전 dump 백업 — 본인만 읽는다 (0600). dump 자체는 쓰지 않는다.
backup_dump() {
    local b
    b="$PM2_BOOT_BACKUP_DIR/dump.pm2.before-boot-agent-$(date +%Y%m%d%H%M%S)-$$"
    if (umask 077; mkdir -p "$PM2_BOOT_BACKUP_DIR" && cp "$PM2_HOME_DIR/dump.pm2" "$b" && chmod 600 "$b") \
        && [[ "$(stat -f %Lp "$b")" == 600 ]]; then
        say info "dump backup: $b"
    else
        failure "could not back up $PM2_HOME_DIR/dump.pm2 to $b; nothing else was changed"; return 1
    fi
}

install_guard() {
    cmp -s "$PM2_BOOT_GUARD_SRC" "$PM2_BOOT_GUARD" && [[ -x "$PM2_BOOT_GUARD" ]] && return 0
    local tmp
    mkdir -p "$(dirname "$PM2_BOOT_GUARD")" && tmp="$(mktemp "$PM2_BOOT_GUARD.XXXXXX")" \
        && cp "$PM2_BOOT_GUARD_SRC" "$tmp" && chmod 755 "$tmp" && mv "$tmp" "$PM2_BOOT_GUARD" \
        || { rm -f "${tmp:-}"; failure "could not install $PM2_BOOT_GUARD"; return 1; }
    say info "boot guard installed: $PM2_BOOT_GUARD"
}

write_agent_file() {
    local tmp backup
    tmp="$(mktemp)" || { failure "mktemp failed"; return 1; }
    if ! write_pm2_boot_agent "$tmp" || ! plutil -lint -s "$tmp" >/dev/null; then rm -f "$tmp"; failure "could not build $PM2_BOOT_AGENT definition"; return 1; fi
    if [[ -f "$PM2_BOOT_PLIST" ]] && cmp -s "$tmp" "$PM2_BOOT_PLIST"; then rm -f "$tmp"; return 0; fi
    if [[ -f "$PM2_BOOT_PLIST" ]]; then
        backup="$OMK_ROOT/backups/launchd/$PM2_BOOT_AGENT.plist.$(date +%Y%m%d%H%M%S)-$$"
        { mkdir -p "$(dirname "$backup")" && (umask 077; cp "$PM2_BOOT_PLIST" "$backup"); } \
            || { rm -f "$tmp"; failure "could not back up $PM2_BOOT_PLIST"; return 1; }
        say info "previous definition backup: $backup"
    fi
    { mkdir -p "$(dirname "$PM2_BOOT_PLIST")" "$(dirname "$PM2_BOOT_LOG")" && chmod 644 "$tmp" && mv "$tmp" "$PM2_BOOT_PLIST"; } \
        || { rm -f "$tmp"; failure "could not write $PM2_BOOT_PLIST"; return 1; }
}

register_agent() {
    local domain; domain="$(colima_gui_domain)"
    if ! colima_gui_domain_available; then
        pending "$domain session is not available (SSH only); $PM2_BOOT_PLIST is written and is read at the next GUI login — or run 'launchctl bootstrap $domain $PM2_BOOT_PLIST' in a GUI session"
        return 0
    fi
    if launchctl print "$domain/$PM2_BOOT_AGENT" >/dev/null 2>&1; then launchctl bootout "$domain/$PM2_BOOT_AGENT" 2>/dev/null || true; fi
    # RunAtLoad — 등록하면 가드가 곧바로 한 번 돈다 (실행 중인 앱은 resurrect 가 건너뛴다).
    launchctl bootstrap "$domain" "$PM2_BOOT_PLIST" 2>/dev/null || { failure "launchctl bootstrap $domain $PM2_BOOT_PLIST failed"; return 1; }
    if pm2_boot_loaded_matches; then say ok "LaunchAgent $PM2_BOOT_AGENT registered and verified (proof of restore after reboot needs a reboot; log $PM2_BOOT_LOG)"
    else failure "LaunchAgent $PM2_BOOT_AGENT was registered but launchd holds a different definition"; fi
}

main() {
    NO_DOCKER=0; MODE=""
    local a
    for a in "$@"; do
        case "$a" in
            --check) MODE=check ;; --apply) MODE=apply ;; --no-docker) NO_DOCKER=1 ;;
            *) MODE=""; break ;;
        esac
    done
    [[ -n "$MODE" ]] || { printf 'usage: %s --check|--apply [--no-docker]\n' "${BASH_SOURCE[0]}" >&2; exit 2; }
    [[ "$(uname -s)" == Darwin ]] || { say error "macOS only"; exit 2; }
    [[ "$(id -u)" != 0 ]] || { say error "run as the user who owns PM2, not root"; exit 2; }
    PENDING=0; ERRORS=0
    resolve_tools
    require_dump
    if ! check_other_registrations; then
        if [[ $ERRORS -gt 0 ]]; then say result "refused ($ERRORS); nothing was changed"; exit 2; fi
        say result "ok"; exit 0
    fi
    resolve_containers
    local tmp same=0
    tmp="$(mktemp)"; write_pm2_boot_agent "$tmp"
    cmp -s "$tmp" "$PM2_BOOT_PLIST" && cmp -s "$PM2_BOOT_GUARD_SRC" "$PM2_BOOT_GUARD" && [[ -x "$PM2_BOOT_GUARD" ]] && pm2_boot_loaded_matches && same=1
    rm -f "$tmp"
    if [[ $same -eq 1 ]]; then
        # 등록은 같아도 마지막 가드 실행이 실패로 끝났을 수 있다 (KeepAlive 없음 — 로그인당 한 번).
        local last
        last="$(pm2_boot_last_failure)"
        if [[ -z "$last" ]]; then
            say ok "LaunchAgent $PM2_BOOT_AGENT defined and loaded as expected (proof of restore after reboot needs a reboot)"; say result "ok"; exit 0
        fi
        if [[ $MODE == check ]]; then
            failure "last $PM2_BOOT_AGENT guard run failed ($last); PM2 apps were not restored by it — see $PM2_BOOT_LOG, then rerun with --apply"
            say result "error ($ERRORS)"; exit 2
        fi
        # 끝난(실행 중이 아닌) 우리 작업만 다시 실행한다 — 가드가 다시 기다린 뒤 resurrect 한다 (실행 중인 앱은 건너뛴다).
        launchctl kickstart "$(colima_gui_domain)/$PM2_BOOT_AGENT" >/dev/null 2>&1 \
            || { failure "launchctl kickstart $(colima_gui_domain)/$PM2_BOOT_AGENT failed (last run: $last)"; say result "error ($ERRORS)"; exit 2; }
        pending "last guard run failed ($last); started $PM2_BOOT_AGENT again — result is in $PM2_BOOT_LOG ('--check' reports it when finished)"
        say result "$PENDING item(s) pending"; exit 1
    fi
    if [[ $MODE == check ]]; then
        say fix "install $PM2_BOOT_GUARD and write/register LaunchAgent $PM2_BOOT_AGENT; registering runs the guard once (running apps are skipped by pm2 resurrect)"
        say result "1 item(s) pending"; exit 1
    fi
    backup_dump && install_guard && write_agent_file && register_agent
    if [[ $ERRORS -gt 0 ]]; then say result "error ($ERRORS)"; exit 2; fi
    if [[ $PENDING -gt 0 ]]; then say result "$PENDING item(s) pending"; exit 1; fi
    say result "ok"; exit 0
}

[[ "${BASH_SOURCE[0]}" != "$0" ]] || { set -uo pipefail; main "$@"; }
