# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 호스트 마무리 (인증서 신뢰 · 자동 시작) — 요약은 common/stack.sh
# ==============================================================================
# 자동 시작 구성:
#   PM2(앱·게이트웨이·프록시·백업) → pm2 startup(launchd, 로그인 시) + pm2 save
#   Docker Desktop                 → 로그인 시 자동 시작 (30-toolchain)
#   Tailscale                      → sudo brew services (LaunchDaemon, 부팅 시)
# 사용자 로그인이 전제라 FileVault 끄기 + 자동 로그인이 필요하다(10-prereqs 안내).

# omk 가 내보낸 내부 루트 인증서를 이 Mac 의 시스템 키체인에 신뢰 등록한다.
trust_root_ca() {
    [[ "$HTTPS_MODE" == "1" ]] || return 0
    local crt="$OMK_ROOT/https/openmake-internal-root.crt"
    if [[ ! -f "$crt" ]]; then
        add_todo "내부 HTTPS 루트 인증서가 없습니다 — 'omk proxy status' 로 프록시 상태를 확인하세요"
        return 0
    fi
    sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$crt" >/dev/null 2>&1 \
        && log_ok "이 Mac 에 내부 루트 인증서 신뢰 등록" \
        || log_warn "인증서 신뢰 등록 실패 — 키체인 접근에서 $crt 를 '항상 신뢰'로 설정하세요."
    add_todo "사용자 기기마다 내부 루트 인증서 신뢰 등록(1회): $crt — macOS 는 더블클릭 후 키체인에서 '항상 신뢰', Windows 는 '신뢰할 수 있는 루트 인증 기관'에 가져오기, iOS 는 프로파일 설치 후 설정 → 일반 → 정보 → 인증서 신뢰 설정"
}

setup_autostart() {
    [[ $NO_START -eq 1 ]] && return 0
    if [[ ! -f "$HOME/Library/LaunchAgents/pm2.$USER.plist" ]]; then
        # pm2 startup 은 sudo 로 실행할 명령을 출력만 한다 — 같은 명령을 직접 실행한다.
        sudo env PATH="$PATH" "$(command -v pm2)" startup launchd -u "$USER" --hp "$HOME" >/dev/null \
            || log_warn "pm2 startup 등록 실패 — 'pm2 startup' 이 안내하는 명령을 직접 실행하세요."
    fi
    pm2 save >/dev/null || log_warn "pm2 save 실패"
    log_ok "재부팅 자동 시작 (PM2 · Docker Desktop$([[ "$DGX_VIA" == "tailscale" ]] && echo ' · Tailscale'))"
}

host_finalize() {
    log_step "호스트 마무리"
    trust_root_ca
    omk_cmd env backup "$(omk_env_name)" --schedule "$BACKUP_CRON" || log_warn "DB 백업 예약 실패 — 'omk env backup $(omk_env_name) --schedule'"
    setup_logrotate
    setup_autostart
    dgx_followup
}

# --minimal — omk 가 이어서 스택을 붙이므로 짧게 끝낸다.
summary_minimal() {
    log_ok "앱 본체 설치 완료 — API http://localhost:$APP_PORT · 웹 http://localhost:$WEB_PORT"
}
