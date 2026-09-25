# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 사전 점검 · sudo · Homebrew · 호스트 도구 · 전원 설정
# (install_mac.sh 가 source 한다. 전역 변수·도우미는 install_mac.sh 에 있다.)
# ==============================================================================

# 서버로 쓰기 위한 macOS 설정 점검 — 스크립트로 바꿀 수 없는 것만 안내한다.
preflight_checks() {
    log_step "사전 점검"
    if fdesetup status 2>/dev/null | grep -q "On"; then
        log_warn "FileVault 가 켜져 있습니다 — 재부팅 후 로그인 화면에서 멈춰, 로그인하기 전까지"
        log_warn "PM2·Docker Desktop 이 올라오지 않습니다(서비스 중단). 서버로 쓰려면"
        log_warn "시스템 설정 → 개인정보 보호 및 보안 → FileVault 끄기, 사용자 및 그룹 → 자동 로그인 켜기."
        add_todo "FileVault 끄기 + 자동 로그인 켜기 (재부팅 후 서비스 자동 복구에 필요)"
        confirm "그래도 설치를 계속할까요?" y || exit 1
    elif [[ -z "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)" ]]; then
        log_warn "자동 로그인이 꺼져 있습니다 — 재부팅 후 로그인하기 전까지 서비스가 올라오지 않습니다."
        add_todo "시스템 설정 → 사용자 및 그룹 → 자동 로그인 켜기 (재부팅 후 서비스 자동 복구에 필요)"
    else
        log_ok "FileVault 꺼짐 · 자동 로그인 켜짐"
    fi
    local free_gb
    free_gb="$(df -g "$HOME" | awk 'NR==2 {print $4}')"
    if [[ -n "$free_gb" && "$free_gb" -lt 40 ]]; then
        log_warn "여유 디스크 ${free_gb}GB — 이미지·빌드에 40GB 이상을 권장합니다."
    fi
}

brew_prefix_default() {
    if [[ "$ARCH" == "arm64" ]]; then echo "/opt/homebrew"; else echo "/usr/local"; fi
}

ensure_homebrew() {
    log_step "Homebrew"
    local prefix
    prefix="$(brew_prefix_default)"
    if [[ ! -x "$prefix/bin/brew" ]]; then
        log_info "Homebrew 설치 (공식 설치 스크립트)"
        sudo_begin
        # sudo 는 이미 유지 중이라 NONINTERACTIVE 로 확인 질문 없이 진행한다.
        NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
            || die "Homebrew 설치 실패"
    fi
    eval "$("$prefix/bin/brew" shellenv)"
    persist_path "$prefix/bin"
    # 이후 터미널에서도 brew 도구가 잡히게 (Homebrew 권장 설정)
    local line="eval \"\$($prefix/bin/brew shellenv)\""
    grep -qF "$line" "$HOME/.zprofile" 2>/dev/null || printf '\n%s\n' "$line" >> "$HOME/.zprofile"
    log_ok "$(brew --version | head -1)"
}

# 호스트 도구. --minimal 은 앱 본체에 필요한 것만.
#   poppler(pdftoppm·pdftotext) · tesseract(+kor) — 스캔 PDF OCR·PDF 비전·Knowledge PDF
#   uv — LiteLLM·스크래퍼 파이썬 가상환경 · caddy — 내부망 HTTPS
ensure_brew_tools() {
    log_step "호스트 도구 (brew)"
    local wanted="git node@$NODE_MAJOR" missing="" f
    [[ $MINIMAL -eq 0 ]] && wanted="$wanted uv poppler tesseract tesseract-lang caddy"
    [[ "$DGX_VIA" == "tailscale" ]] && wanted="$wanted tailscale"
    for f in $wanted; do
        brew list --formula "$f" >/dev/null 2>&1 || missing="$missing $f"
    done
    if [[ -n "$missing" ]]; then
        log_info "설치:$missing"
        # 단어 분할이 의도다 — formula 이름 목록.
        # shellcheck disable=SC2086
        brew install $missing || die "brew install 실패:$missing"
    fi
    log_ok "도구 준비 완료 ($wanted)"
}

# 서버 전원 설정 — 잠자기 끄기, 정전 후 자동 재시작, 네트워크로 깨우기.
configure_power() {
    [[ $MINIMAL -eq 1 ]] && return 0
    log_step "전원 설정"
    sudo_begin
    sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1 >/dev/null \
        && log_ok "잠자기 끔 · 정전 후 자동 재시작 · 네트워크로 깨우기" \
        || log_warn "pmset 설정 실패 — 시스템 설정 → 에너지에서 직접 잠자기를 끄세요."
}
