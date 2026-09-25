# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_linux.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_linux.sh 단계 — :443 권한 · 인증서 신뢰 · 자동 시작 — 요약은 common/stack.sh
# ==============================================================================
# 자동 시작 구성 (systemd — 로그인하지 않아도 부팅 시 올라온다):
#   PM2(앱·게이트웨이·프록시·백업) → pm2 startup systemd + pm2 save
#   Docker Engine                  → systemctl enable docker
#   Tailscale                      → tailscaled.service (공식 설치 스크립트가 등록)

# 프록시(Caddy)는 PM2 아래 일반 사용자로 돈다 — Linux 는 1024 미만 포트를 막으므로 :443 바인딩 권한을
# 그 실행 파일에만 준다(전역 sysctl 대신). omk 가 쓸 caddy 를 omk 의 함수로 확보해 같은 파일에 준다.
prepare_https_proxy() {
    [[ "$HTTPS_MODE" == "1" ]] || return 0
    local bin
    bin="$(OMK_ROOT="$OMK_ROOT" OMK_SOURCE_ONLY=1 bash -c '. "$1"; proxy_ensure_binary >&2; printf "%s" "$CADDY_BIN"' _ "$SCRIPT_DIR/scripts/env/omk.sh")" \
        || { log_warn "caddy 를 준비하지 못했습니다 — 내부망 HTTPS 가 :443 에서 뜨지 않을 수 있습니다."; return 0; }
    bin="$(readlink -f "$bin" 2>/dev/null || printf '%s' "$bin")"
    if sudo setcap 'cap_net_bind_service=+ep' "$bin" 2>/dev/null; then
        log_ok ":443 바인딩 권한 → $bin"
    else
        log_warn "setcap 실패 — 프록시가 :443 에 붙지 못할 수 있습니다 (libcap 패키지 확인)."
    fi
}

# omk 가 내보낸 내부 루트 인증서를 이 서버의 신뢰 저장소에 등록한다.
trust_root_ca() {
    [[ "$HTTPS_MODE" == "1" ]] || return 0
    local crt="$OMK_ROOT/https/openmake-internal-root.crt"
    if [[ ! -f "$crt" ]]; then
        add_todo "내부 HTTPS 루트 인증서가 없습니다 — 'omk proxy status' 로 프록시 상태를 확인하세요"
        return 0
    fi
    if has update-ca-certificates; then
        sudo cp "$crt" /usr/local/share/ca-certificates/openmake-internal-root.crt && sudo update-ca-certificates >/dev/null
    elif has update-ca-trust; then
        sudo cp "$crt" /etc/pki/ca-trust/source/anchors/openmake-internal-root.crt && sudo update-ca-trust
    else
        false
    fi && log_ok "이 서버에 내부 루트 인증서 신뢰 등록" \
       || log_warn "인증서 신뢰 등록 실패 — 배포판의 CA 저장소에 $crt 를 직접 추가하세요."
    add_todo "사용자 기기마다 내부 루트 인증서 신뢰 등록(1회): $crt — macOS 는 더블클릭 후 키체인에서 '항상 신뢰', Windows 는 '신뢰할 수 있는 루트 인증 기관'에 가져오기, iOS 는 프로파일 설치 후 설정 → 일반 → 정보 → 인증서 신뢰 설정"
}

setup_autostart() {
    [[ $NO_START -eq 1 ]] && return 0
    [[ -d /run/systemd/system ]] || return 0   # preflight_checks 가 할 일로 남겼다
    sudo systemctl enable docker >/dev/null 2>&1 || true
    if ! systemctl list-unit-files 2>/dev/null | grep -q "^pm2-$USER\.service"; then
        # pm2 startup 은 sudo 로 실행할 명령을 출력만 한다 — 같은 명령을 직접 실행한다.
        sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null \
            || log_warn "pm2 startup 등록 실패 — 'pm2 startup' 이 안내하는 명령을 직접 실행하세요."
    fi
    pm2 save >/dev/null || log_warn "pm2 save 실패"
    log_ok "재부팅 자동 시작 (systemd: PM2 · Docker$([[ "$DGX_VIA" == "tailscale" ]] && echo ' · Tailscale'))"
}

host_finalize() {
    log_step "호스트 마무리"
    trust_root_ca
    omk_cmd env backup "$(omk_env_name)" --schedule "$BACKUP_CRON" || log_warn "DB 백업 예약 실패 — 'omk env backup $(omk_env_name) --schedule'"
    setup_logrotate
    setup_autostart
    dgx_followup
    if [[ "$APP_HOST" =~ ^[0-9.]+$ ]]; then
        add_todo "공유기에서 이 서버의 IP($APP_HOST)를 DHCP 예약으로 고정 — 접속 주소가 바뀌면 로그인이 깨집니다"
    fi
    return 0
}
