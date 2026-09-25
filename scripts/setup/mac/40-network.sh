# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — DGX 연결 네트워크 (Tailscale 선택 시)
# ==============================================================================
# DGX 가 같은 LAN 이면 할 일이 없다. 다른 네트워크면 이 Mac 을 Tailscale 에 붙인다 — tailscaled 는 root
# 데몬이라 `sudo brew services` 로 등록해 부팅 때(로그인 전에도) 올라온다. DGX 포트 허용은 Tailscale ACL
# 콘솔에서 사람이 한다(호스트 방화벽이 아니다).


setup_tailscale() {
    [[ "$LLM_MODE" == "dgx" && "$DGX_VIA" == "tailscale" ]] || return 0
    log_step "Tailscale"
    has tailscale || die "tailscale 이 설치되지 않았습니다 (brew install tailscale)"
    sudo brew services start tailscale >/dev/null 2>&1 || true
    local i
    for ((i = 1; i <= 15; i++)); do
        sudo tailscale version >/dev/null 2>&1 && break
        sleep 2
    done
    if ! sudo tailscale ip -4 >/dev/null 2>&1; then
        if [[ -n "$TAILSCALE_AUTHKEY" ]]; then
            sudo tailscale up --authkey="$TAILSCALE_AUTHKEY" || die "tailscale up 실패"
        else
            log_info "Tailscale 로그인 — 아래에 표시되는 URL 을 브라우저에서 열어 승인하세요."
            sudo tailscale up || die "tailscale up 실패"
        fi
    fi
    log_ok "Tailscale 연결됨 ($(sudo tailscale ip -4 | head -1))"
}

# 사내 PC 가 이 Mac 을 부를 기본 이름 — macOS 는 Bonjour(mDNS)로 <로컬 호스트 이름>.local 이 항상 풀린다.
default_access_host() { printf '%s.local' "$(scutil --get LocalHostName 2>/dev/null || hostname -s)"; }
