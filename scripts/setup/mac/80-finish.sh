# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 호스트 마무리 · 설치 요약
# ==============================================================================
# 자동 시작 구성:
#   PM2(앱·게이트웨이·프록시·백업) → pm2 startup(launchd, 로그인 시) + pm2 save
#   Docker Desktop                 → 로그인 시 자동 시작 (30-toolchain)
#   Tailscale                      → sudo brew services (LaunchDaemon, 부팅 시)
# 사용자 로그인이 전제라 FileVault 끄기 + 자동 로그인이 필요하다(10-prereqs 안내).

readonly BACKUP_CRON="30 4 * * *"

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

setup_logrotate() {
    if ! pm2 ls -m 2>/dev/null | grep -q "pm2-logrotate"; then
        pm2 install pm2-logrotate >/dev/null 2>&1 || { log_warn "pm2-logrotate 설치 실패 — 'pm2 install pm2-logrotate'"; return 0; }
    fi
    pm2 set pm2-logrotate:max_size 10M >/dev/null 2>&1 || true
    pm2 set pm2-logrotate:retain 30 >/dev/null 2>&1 || true
    pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true
    pm2 set pm2-logrotate:rotateInterval '0 0 * * *' >/dev/null 2>&1 || true
    log_ok "로그 회전: 10MB·30일·압축"
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

summary() {
    local url
    url="$(env_value OMK_APP_URL)"
    add_todo "첫 로그인 후 관리자 비밀번호 변경 (초기 비밀번호는 .env 에 평문 저장)"
    [[ "$LLM_MODE" == "dgx" ]] && add_todo "관리자 → 모델 배정 → text.embed = bge-m3 (Knowledge Space 사용에 필요)"
    add_todo "(선택) 관리자 → 시스템 설정에서 검색 API 키 입력 — EXA·Tavily·Naver·Kakao 등, 서버마다 새로 발급"

    printf "\n%s══════════════════════════════════════════════════════%s\n" "$C_OK" "$C_RESET"
    printf "%s  OpenMake LLM 설치 완료 (macOS · 내부망)%s\n" "$C_OK" "$C_RESET"
    printf "%s══════════════════════════════════════════════════════%s\n\n" "$C_OK" "$C_RESET"
    echo "  접속      ${url:-http://localhost:$WEB_PORT}"
    echo "  로그인    $(env_value DEFAULT_ADMIN_EMAIL)   ← 이메일로 로그인"
    echo "  비밀번호  $(env_value ADMIN_PASSWORD)"
    echo "  소스      $SCRIPT_DIR   (환경 $(omk_env_name))"
    echo ""
    if [[ -n "$TODO_LIST" ]]; then
        printf "  %s[할 일]%s\n" "$C_WARN" "$C_RESET"
        local n=0 line
        while IFS= read -r line; do
            n=$((n + 1))
            printf "   %2d. %s\n" "$n" "$line"
        done <<< "$TODO_LIST"
        echo ""
    fi
    echo "  관리 명령 (PATH 에 $OMK_ROOT/bin 추가 시 'omk' 로)"
    echo "    $OMK_ROOT/bin/omk env status $(omk_env_name)      상태"
    echo "    $OMK_ROOT/bin/omk env update $(omk_env_name)      코드 갱신 (빌드·마이그레이션·재시작)"
    echo "    $OMK_ROOT/bin/omk env logs $(omk_env_name)        로그"
    echo "    $OMK_ROOT/bin/omk env backup $(omk_env_name) --list   백업 목록"
    echo ""
}

# --minimal — omk 가 이어서 스택을 붙이므로 짧게 끝낸다.
summary_minimal() {
    log_ok "앱 본체 설치 완료 — API http://localhost:$APP_PORT · 웹 http://localhost:$WEB_PORT"
}
