#!/usr/bin/env bash
# macOS OpenMake commands select only the dedicated Colima profile.
openmake_colima_home() { # [$1=user home]; context inspection does not contact a daemon.
    local user_home="${1:-$HOME}" root="${COLIMA_HOME:-}" endpoint
    if [[ -z "$root" ]] && command -v docker >/dev/null 2>&1; then
        endpoint="$(docker context inspect colima-openmake --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
        if [[ "$endpoint" == unix:///*/openmake/docker.sock ]]; then
            root="${endpoint#unix://}"; root="${root%/openmake/docker.sock}"
        fi
    fi
    [[ -n "$root" ]] || root="$user_home/.colima"
    [[ "$root" == /* ]] || { printf 'COLIMA_HOME must be an absolute path\n' >&2; return 1; }
    printf '%s' "${root%/}"
}

openmake_select_docker() { # [$1=platform] [$2=user home]
    [[ "${1:-$(uname -s)}" == Darwin ]] || return 0
    local root
    root="$(openmake_colima_home "${2:-$HOME}")" || return 1
    export COLIMA_HOME="$root"
    export DOCKER_HOST="unix://$root/openmake/docker.sock"
    unset DOCKER_CONTEXT
}
