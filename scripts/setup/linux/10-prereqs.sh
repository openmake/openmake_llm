# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_linux.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_linux.sh 단계 — 사전 점검 · 호스트 패키지 · uv · 절전 해제
# ==============================================================================

# 서버로 쓰기 위한 점검 — systemd 가 있어야 재부팅 자동 시작(PM2·Docker·Tailscale)이 된다.
preflight_checks() {
    log_step "사전 점검"
    if [[ -d /run/systemd/system ]]; then
        log_ok "systemd 사용 — 재부팅 후 로그인 없이 서비스가 올라온다"
    else
        log_warn "systemd 가 없습니다 — 재부팅 자동 시작을 등록할 수 없습니다(WSL 은 /etc/wsl.conf 에 [boot] systemd=true)."
        add_todo "systemd 를 켜고(WSL: /etc/wsl.conf 의 [boot] systemd=true 후 wsl --shutdown) 설치를 다시 실행 — 재부팅 자동 시작 등록"
    fi
    local free_gb
    free_gb="$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')"
    if [[ -n "$free_gb" && "$free_gb" -lt 40 ]]; then
        log_warn "여유 디스크 ${free_gb}GB — 이미지·빌드에 40GB 이상을 권장합니다."
    fi
    return 0
}

# 호스트 도구 — poppler(pdftoppm·pdftotext)·tesseract(+kor): 스캔 PDF OCR·PDF 비전·Knowledge PDF,
# python3-venv: LiteLLM·스크래퍼 가상환경 폴백, setcap(libcap): 프록시의 :443 바인딩 권한.
ensure_host_packages() {
    log_step "호스트 패키지 ($PKG)"
    local pkgs=""
    case "$PKG" in
        apt)    pkgs="curl git ca-certificates poppler-utils tesseract-ocr tesseract-ocr-kor python3 python3-venv libcap2-bin"
                sudo apt-get update -qq || die "apt-get update 실패" ;;
        dnf)    pkgs="curl git ca-certificates poppler-utils tesseract tesseract-langpack-kor python3 libcap" ;;
        yum)    pkgs="curl git ca-certificates poppler-utils tesseract python3 libcap" ;;
        pacman) pkgs="curl git ca-certificates poppler tesseract tesseract-data-kor python libcap" ;;
        zypper) pkgs="curl git ca-certificates poppler-tools tesseract-ocr python3 libcap-progs" ;;
        *) log_warn "패키지 관리자를 찾지 못했습니다 — git·poppler·tesseract·python3·setcap 을 직접 설치하세요."; return 0 ;;
    esac
    # 단어 분할이 의도다 — 패키지 이름 목록.
    # shellcheck disable=SC2086
    case "$PKG" in
        apt)    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $pkgs ;;
        dnf)    sudo dnf install -y -q $pkgs ;;
        yum)    sudo yum install -y -q $pkgs ;;
        pacman) sudo pacman -Sy --noconfirm --needed $pkgs ;;
        zypper) sudo zypper install -y $pkgs ;;
    esac || log_warn "일부 패키지 설치 실패 — PDF OCR·스크래퍼 등 해당 기능만 제한됩니다."
    log_ok "호스트 패키지 준비"
}

# uv — omk 가 LiteLLM·스크래퍼 가상환경을 만들 때 쓴다(파이썬 버전까지 받아 온다).
ensure_uv() {
    has uv && { log_ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"; return 0; }
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null 2>&1 \
        || { log_warn "uv 설치 실패 — omk 가 python3 -m venv 로 대신합니다."; return 0; }
    export PATH="$HOME/.local/bin:$PATH"; persist_path "$HOME/.local/bin"
    log_ok "uv 설치 ($HOME/.local/bin)"
}

# 데스크톱 배포판의 자동 절전을 막는다 (서버 배포판은 원래 없다 — 무해).
configure_power() {
    [[ $IS_WSL -eq 1 || ! -d /run/systemd/system ]] && return 0
    sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 \
        && log_ok "자동 절전 끔 (sleep/suspend/hibernate target mask)" \
        || log_warn "절전 설정 실패 — 전원 관리에서 자동 절전을 직접 끄세요."
}
