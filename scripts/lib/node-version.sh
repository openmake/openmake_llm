# shellcheck shell=bash
# ==============================================================================
# Node 버전 검사 — source 해서 쓰는 함수 모음 (bash 3.2 호환)
#
# 유일한 기준은 저장소 루트의 .node-version 이다. 설치·배포·빌드는 지금 node 가 그 값과
# **정확히 같아야** 진행한다 — 메이저만 맞추면 장비마다 24.x 의 다른 판·26.x 가 섞인다.
#   . "$ROOT/scripts/lib/node-version.sh"
#   require_node_version "$ROOT" || exit 1
# ==============================================================================

# <repo_root>/.node-version 의 버전(앞 v·공백·개행 제거). 파일이 없으면 return 1.
node_version_pinned() {
    local file="$1/.node-version"
    [[ -f "$file" ]] || return 1
    sed -e 's/[[:space:]]//g' -e 's/^v//' "$file" | tr -d '\n'
}

# 지금 PATH 의 node 버전 (node 가 없으면 빈 문자열).
node_version_current() {
    command -v node >/dev/null 2>&1 || return 0
    node -p 'process.versions.node' 2>/dev/null || true
}

# PM2 데몬이 돌고 있는 node 버전 — `pm2 report` 의 "--- Daemon ---" 구역 값만 읽는다
# (같은 출력의 "--- CLI ---" 구역은 지금 셸의 node 라 데몬과 다를 수 있다).
# pm2 가 없거나 데몬이 꺼져 있으면 빈 문자열 — `pm2 report` 는 꺼진 데몬을 띄우므로 pid 파일을 먼저 본다.
pm2_daemon_node_version() {
    command -v pm2 >/dev/null 2>&1 || return 0
    local pid_file="${PM2_HOME:-$HOME/.pm2}/pm2.pid" pid
    [[ -f "$pid_file" ]] || return 0
    pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null)"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
    pm2 report 2>/dev/null | awk '
        /^--- Daemon -/ { d = 1; next }
        /^--- /         { d = 0 }
        d && /^node version/ { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/[[:space:]]/, ""); sub(/^v/, ""); print; exit }
    ' || true
}

# 고치는 방법 안내 (stderr). $1=기준 버전
_node_version_fix_hint() {
    local pinned="$1" major="${1%%.*}"
    {
        echo "  고치는 방법 (기준: .node-version = $pinned)"
        echo "    Homebrew: brew install node@$major"
        echo "              brew link --force --overwrite node@$major"
        echo "              brew pin node@$major          # brew upgrade 가 다른 판으로 올리지 않게"
        echo "              (brew 의 node@$major 가 $pinned 와 다른 판이면 mise 로 정확한 판을 준비한다)"
        echo "    mise:     mise install node@$pinned"
        echo "  버전을 올리려면 .node-version·mise.toml·관련 Dockerfile 을 한 PR 로 함께 바꾼다."
    } >&2
}

# 지금 node 가 .node-version 과 정확히 같으면 0, 다르면 안내를 stderr 에 내고 1.
require_node_version() {
    local pinned current
    if ! pinned="$(node_version_pinned "$1")" || [[ -z "$pinned" ]]; then
        echo "[ERR]   $1/.node-version 을 읽을 수 없습니다." >&2
        return 1
    fi
    current="$(node_version_current)"
    [[ "$current" == "$pinned" ]] && return 0
    echo "[ERR]   node 버전이 기준과 다릅니다 — 지금 ${current:-없음}, 기준(.node-version) $pinned" >&2
    _node_version_fix_hint "$pinned"
    return 1
}

# PM2 데몬의 node 가 .node-version 과 다르면 안내 후 1. 데몬 버전을 읽을 수 없으면(pm2 없음·데몬 꺼짐) 0.
# 데몬은 처음 띄운 node 를 계속 쓴다 — node 를 바꿔도 `pm2 restart` 만으로는 앱이 옛 node 로 뜬다.
require_pm2_daemon_node_version() {
    local pinned daemon
    if ! pinned="$(node_version_pinned "$1")" || [[ -z "$pinned" ]]; then
        echo "[ERR]   $1/.node-version 을 읽을 수 없습니다." >&2
        return 1
    fi
    daemon="$(pm2_daemon_node_version)"
    [[ -z "$daemon" || "$daemon" == "$pinned" ]] && return 0
    {
        echo "[ERR]   PM2 데몬의 node 버전이 기준과 다릅니다 — 데몬 $daemon, 기준(.node-version) $pinned"
        echo "  지금 셸의 node 를 기준 버전으로 맞춘 뒤 'pm2 update' 를 실행한다"
        echo "  (지금 node 로 데몬을 다시 띄우고 저장된 앱을 되살린다)."
    } >&2
    return 1
}
