# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 설치 질문 (처음에 한 번에 받고 이후 무인 진행)
# 플래그로 받은 값은 다시 묻지 않는다. --yes 면 묻지 않고 기본값·플래그만 쓴다.
# ==============================================================================

readonly EXTERNAL_PROVIDERS="openrouter ollama-cloud nvidia hasa bai orcarouter custom"
# 모델 ID 는 LiteLLM YAML 에 따옴표로 들어간다 — 따옴표·공백·제어문자를 막는다.
readonly MODEL_ID_PATTERN='^[A-Za-z0-9._:/@+-]+$'

# 외부 provider → OpenAI 호환 주소. omk 는 이 주소를 게이트웨이 뒤 업스트림으로 둔다(--llm-base-url).
# logfare 는 모든 요청을 기록하는 무료 게이트웨이라 서버 공용 기본 모델로 두지 않는다.
provider_base_url() {
    case "$1" in
        openrouter)   echo "https://openrouter.ai/api/v1" ;;
        ollama-cloud) echo "https://ollama.com/v1" ;;
        nvidia)       echo "https://integrate.api.nvidia.com/v1" ;;
        hasa)         echo "https://open.hasa.re.kr/v1" ;;
        bai)          echo "https://api.b.ai/v1" ;;
        orcarouter)   echo "https://api.orcarouter.ai/v1" ;;
        custom)       echo "$LLM_BASE_URL" ;;
        *) return 1 ;;
    esac
}

# omk 가 이 환경에 만든 게이트웨이 설정 — 재실행 때 유지를 제안한다.
omk_litellm_env() { printf '%s/%s/litellm/litellm.env' "$OMK_ROOT" "$(omk_env_name)"; }

ask_questions() {
    if [[ $MINIMAL -eq 1 ]]; then
        ask_minimal_llm
        return 0
    fi
    log_step "설치 질문"
    ask_llm_backend
    ask_access
    ask_optional_features
    print_answers
    if interactive; then
        confirm "이 설정으로 설치를 시작할까요? (이후는 사람 손 없이 진행됩니다)" y || exit 1
    fi
}

# --minimal — 앱에 OpenAI 호환 주소를 직접 넣는다(omk 가 뒤에서 게이트웨이로 바꾼다).
ask_minimal_llm() {
    LLM_MODE="direct"
    [[ -n "$LLM_BASE_URL" ]] && return 0
    if interactive; then
        echo "  OpenAI 호환 엔드포인트 (비워 두면 자리표시자 — 나중에 .env 에서 설정)"
        ask LLM_BASE_URL "Base URL" ""
        [[ -n "$LLM_BASE_URL" ]] && { ask_secret LLM_API_KEY "API 키 (없으면 엔터)"; ask LLM_MODEL "모델 ID" ""; }
    fi
    return 0
}

ask_llm_backend() {
    if [[ -z "$LLM_MODE" && -f "$(omk_litellm_env)" ]]; then
        if confirm "기존 LiteLLM 게이트웨이 설정($(omk_litellm_env))을 그대로 쓸까요?" y; then
            LLM_MODE="keep"; return 0
        fi
    fi
    if [[ -z "$LLM_MODE" ]]; then
        interactive || die "--yes 에서는 --dgx-host(DGX vLLM) 또는 --llm-provider(외부 모델) 가 필요합니다."
        echo ""
        echo "  LLM 백엔드를 고르세요."
        echo "    1) DGX vLLM  — 내부 GPU 서버의 로컬 모델 (qwen3.8-27b)"
        echo "    2) 외부 provider — OpenRouter 등 API 키로 쓰는 모델"
        local choice=""
        ask choice "선택 [1-2]" "1"
        case "$choice" in 2) LLM_MODE="external" ;; *) LLM_MODE="dgx" ;; esac
    fi
    if [[ "$LLM_MODE" == "dgx" ]]; then ask_dgx; else ask_external; fi
}

ask_dgx() {
    if [[ -z "$DGX_VIA" ]]; then
        if interactive; then
            echo ""
            echo "  DGX 에 어떻게 연결하나요?"
            echo "    1) 같은 LAN 에서 직접   — DGX 의 LAN IP (DGX vLLM 이 LAN 주소로 열려 있어야 함)"
            echo "    2) Tailscale            — DGX 가 다른 네트워크에 있을 때 (이 Mac 에 Tailscale 설치)"
            local choice=""
            ask choice "선택 [1-2]" "1"
            case "$choice" in 2) DGX_VIA="tailscale" ;; *) DGX_VIA="lan" ;; esac
        else
            DGX_VIA="lan"
        fi
    fi
    [[ -n "$DGX_HOST" ]] || ask DGX_HOST "DGX 주소 (${DGX_VIA} — IP 또는 호스트 이름)" ""
    [[ -n "$DGX_HOST" ]] || die "DGX 주소가 필요합니다 (--dgx-host)."
    [[ "$DGX_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "DGX 주소 형식이 올바르지 않습니다: $DGX_HOST"
    [[ -n "$VLLM_API_KEY" ]] || ask_secret VLLM_API_KEY "DGX vLLM API 키 (DGX vllm.env 의 VLLM_API_KEY, 없으면 엔터)"
    [[ -n "$VLLM_API_KEY" ]] || log_warn "vLLM API 키 없이 진행합니다 — DGX 가 키를 요구하면 모델 호출이 401 로 실패합니다."
    return 0
}

ask_external() {
    if [[ -z "$LLM_PROVIDER" ]]; then
        interactive || die "--llm-provider 가 필요합니다 ($EXTERNAL_PROVIDERS)."
        echo ""
        echo "  외부 provider: $EXTERNAL_PROVIDERS"
        ask LLM_PROVIDER "provider" "openrouter"
    fi
    case " $EXTERNAL_PROVIDERS " in *" $LLM_PROVIDER "*) ;; *) die "지원하지 않는 provider: $LLM_PROVIDER ($EXTERNAL_PROVIDERS)" ;; esac
    if [[ "$LLM_PROVIDER" == "custom" && -z "$LLM_BASE_URL" ]]; then
        ask LLM_BASE_URL "OpenAI 호환 Base URL (예: http://192.168.0.60:8000/v1)" ""
        [[ -n "$LLM_BASE_URL" ]] || die "custom provider 는 Base URL 이 필요합니다 (--llm-base-url)."
    fi
    LLM_BASE_URL="$(provider_base_url "$LLM_PROVIDER")"
    [[ -n "$LLM_MODEL" ]] || ask LLM_MODEL "기본 채팅 모델 ID (provider 가 쓰는 이름 그대로)" ""
    [[ "$LLM_MODEL" =~ $MODEL_ID_PATTERN ]] || die "모델 ID 형식이 올바르지 않습니다: '$LLM_MODEL'"
    [[ -n "$LLM_API_KEY" ]] || ask_secret LLM_API_KEY "$LLM_PROVIDER API 키"
    [[ -n "$LLM_API_KEY" || "$LLM_PROVIDER" == "custom" ]] || die "API 키가 필요합니다 (--llm-api-key)."
    return 0
}

ask_access() {
    local default_host
    default_host="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
    [[ -n "$APP_HOST" ]] || ask APP_HOST "접속 주소 (사내 PC 에서 이 Mac 을 부를 이름 또는 고정 IP)" "$default_host"
    [[ "$APP_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "접속 주소 형식이 올바르지 않습니다: $APP_HOST"
    if [[ -z "$HTTPS_MODE" ]]; then
        if confirm "HTTPS 로 접속하게 할까요? (권장 — HTTP 는 복사 버튼·웹 푸시 알림이 동작하지 않음)" y; then
            HTTPS_MODE=1
        else
            HTTPS_MODE=0
        fi
    fi
}

ask_optional_features() {
    if [[ -z "$WITH_VIEWER" ]]; then
        if confirm "artifact-viewer(아티팩트 공유 링크용 별도 뷰어)를 설치할까요?" n; then WITH_VIEWER=1; else WITH_VIEWER=0; fi
    fi
    if [[ -z "$WITH_DISCORD" ]]; then
        if confirm "Discord 봇을 설치할까요? (이 서버 전용 새 봇 토큰 필요)" n; then WITH_DISCORD=1; else WITH_DISCORD=0; fi
    fi
    if [[ "$WITH_DISCORD" == "1" && -z "$DISCORD_TOKEN" ]]; then
        log_warn "운영 서버의 봇 토큰을 재사용하면 두 서버가 같은 봇으로 접속해 충돌합니다 — 새 봇을 만드세요."
        ask_secret DISCORD_TOKEN "Discord 봇 토큰"
    fi
    if [[ "$WITH_DISCORD" == "1" && -z "$DISCORD_TOKEN" ]]; then
        log_warn "토큰이 없어 Discord 봇을 건너뜁니다."
        WITH_DISCORD=0
    fi
    return 0
}

print_answers() {
    echo ""
    echo "  ── 설치 설정 ──"
    echo "  환경       $(omk_env_name)  (소스 $SCRIPT_DIR)"
    case "$LLM_MODE" in
        keep)     echo "  LLM        기존 LiteLLM 설정 유지" ;;
        dgx)      echo "  LLM        DGX vLLM ($DGX_VIA · $DGX_HOST)" ;;
        external) echo "  LLM        외부 provider $LLM_PROVIDER · 기본 모델 $LLM_MODEL" ;;
    esac
    if [[ "$HTTPS_MODE" == "1" ]]; then
        echo "  접속       https://$APP_HOST  (내부 인증서)"
    else
        echo "  접속       http://$APP_HOST:<프록시 포트>"
    fi
    echo "  선택 항목  artifact-viewer=$([[ "$WITH_VIEWER" == "1" ]] && echo 사용 || echo 안함) · Discord=$([[ "$WITH_DISCORD" == "1" ]] && echo 사용 || echo 안함) · 샌드박스 이미지=$([[ $SANDBOX_IMAGES -eq 1 ]] && echo 빌드 || echo 생략)"
    echo ""
}
