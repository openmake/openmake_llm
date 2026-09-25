# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — DGX 연결 네트워크 (Tailscale 선택 시)
# ==============================================================================
# DGX 가 같은 LAN 이면 할 일이 없다. 다른 네트워크면 이 Mac 을 Tailscale 에 붙인다 — tailscaled 는 root
# 데몬이라 `sudo brew services` 로 등록해 부팅 때(로그인 전에도) 올라온다. DGX 포트 허용은 Tailscale ACL
# 콘솔에서 사람이 한다(호스트 방화벽이 아니다).

readonly DGX_CHAT_PORT=8002
readonly DGX_PORTS_TEXT="8002(채팅)·8003(임베딩)·8005(음악)"

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

# 설치 끝에 DGX 채팅 모델 연결을 다시 확인해, 실패하면 연결 방식에 맞는 할 일을 남긴다.
dgx_followup() {
    [[ "$LLM_MODE" == "dgx" ]] || return 0
    local auth=() code
    [[ -n "$VLLM_API_KEY" ]] && auth=(-H "Authorization: Bearer $VLLM_API_KEY")
    code="$(curl -s -m 6 -o /dev/null -w '%{http_code}' ${auth[@]+"${auth[@]}"} "http://$DGX_HOST:$DGX_CHAT_PORT/v1/models" 2>/dev/null || true)"
    case "$code" in
        200) return 0 ;;
        401) add_todo "DGX vLLM API 키 불일치(401) — $OMK_ROOT/$(omk_env_name)/litellm/litellm.env 의 VLLM_API_KEY 와 .env 의 LLM_TOKENIZE_API_KEY 수정 후 'omk env start $(omk_env_name)'" ;;
        *)
            if [[ "$DGX_VIA" == "tailscale" ]]; then
                add_todo "DGX 에 연결되지 않습니다(HTTP $code) — Tailscale ACL 콘솔(https://login.tailscale.com/admin/acls)에서 이 Mac 이 DGX 의 $DGX_PORTS_TEXT 에 접근하도록 허용한 뒤 확인: curl http://$DGX_HOST:$DGX_CHAT_PORT/v1/models"
            else
                add_todo "DGX 에 연결되지 않습니다(HTTP $code) — DGX vLLM 을 LAN 주소로 열고(compose 바인딩·방화벽, $DGX_PORTS_TEXT) 확인: curl http://$DGX_HOST:$DGX_CHAT_PORT/v1/models"
            fi ;;
    esac
}
