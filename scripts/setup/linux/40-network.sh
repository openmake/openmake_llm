# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_linux.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_linux.sh 단계 — DGX 연결 네트워크 (Tailscale 선택 시) · 기본 접속 주소
# ==============================================================================
# tailscaled 는 공식 설치 스크립트가 systemd 서비스로 등록한다(부팅 시 자동). DGX 포트 허용은 Tailscale
# ACL 콘솔에서 사람이 한다(호스트 방화벽이 아니다).

setup_tailscale() {
    [[ "$LLM_MODE" == "dgx" && "$DGX_VIA" == "tailscale" ]] || return 0
    log_step "Tailscale"
    if ! has tailscale; then
        curl -fsSL https://tailscale.com/install.sh | sh || die "Tailscale 설치 실패"
    fi
    sudo systemctl enable --now tailscaled >/dev/null 2>&1 || true
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

# 사내 PC 가 이 서버를 부를 기본 주소 — 서버 배포판은 mDNS(.local)가 없을 수 있어 LAN IP 를 쓴다.
# 공유기에서 DHCP 예약으로 고정할 것을 요약 화면이 안내한다.
default_access_host() { hostname -I 2>/dev/null | awk '{print $1}'; }
