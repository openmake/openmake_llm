# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# 공통 단계 (install_mac.sh · install_linux.sh) — 스택 설치(omk 위임) · DGX 확인 · 로그 회전 · 요약
# ==============================================================================
# omk 가 소스(이 디렉터리)를 재사용해 ./install.sh --minimal(앱 본체)을 부른 뒤 게이트웨이·검색·샌드박스
# 이미지·운영 프로필·DGX·내부망 HTTPS·선택 기능을 붙인다. 설치 답변은 전부 omk 옵션으로 넘긴다.

readonly LITELLM_VERSION="1.100.1"   # 1.102 는 /v1/models 지연 회귀로 운영이 롤백한 버전
readonly DGX_CHAT_PORT=8002
readonly BACKUP_CRON="30 4 * * *"      # omk env backup --schedule (DB 덤프 → $OMK_ROOT/backups/<env>)
readonly DGX_PORTS_TEXT="8002(채팅)·8003(임베딩)·8005(음악)"

omk_cmd() { OMK_ROOT="$OMK_ROOT" bash "$SCRIPT_DIR/scripts/env/omk.sh" "$@"; }

# 지금 소스의 ref — omk 가 이 클론을 다른 ref 로 옮기지 않게 그대로 넘긴다.
current_ref() {
    local ref
    ref="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ -z "$ref" || "$ref" == "HEAD" ]]; then
        ref="$(git -C "$SCRIPT_DIR" describe --tags --exact-match 2>/dev/null || echo main)"
    fi
    printf '%s' "$ref"
}

run_omk_install() {
    local env args=()
    env="$(omk_env_name)"
    log_step "스택 설치 — omk env install $env"
    # bench(평가 도구)는 운영 복제 범위 밖이다 — 필요하면 'omk env install <env>' 를 --no-bench 없이 다시.
    args=(env install "$env" --yes --ref "$(current_ref)" --no-bench --ops-profile)
    case "$LLM_MODE" in
        dgx)
            args+=(--dgx-host "$DGX_HOST")
            [[ -z "$VLLM_API_KEY" ]] || args+=(--vllm-api-key "$VLLM_API_KEY") ;;
        external)
            args+=(--no-default-model --llm-base-url "$LLM_BASE_URL" --llm-model "$LLM_MODEL")
            [[ -z "$LLM_API_KEY" ]] || args+=(--llm-api-key "$LLM_API_KEY") ;;
    esac
    if [[ "$HTTPS_MODE" == "1" ]]; then
        args+=(--https-host "$APP_HOST")
    else
        args+=(--host "$APP_HOST")
    fi
    [[ "$WITH_VIEWER" == "1" ]] && args+=(--artifact-viewer)
    [[ "$WITH_DISCORD" == "1" && -n "$DISCORD_TOKEN" ]] && args+=(--discord-token "$DISCORD_TOKEN")
    [[ $SANDBOX_IMAGES -eq 0 ]] && args+=(--no-runtime-images)

    OMK_LITELLM_SPEC="litellm[proxy]==$LITELLM_VERSION" omk_cmd "${args[@]}" || die "omk 설치 실패 — 위 로그를 확인하세요"

    # HTTP 모드는 프록시 포트가 접속 주소다 (omk expose 는 CORS 만 채운다).
    if [[ "$HTTPS_MODE" != "1" ]]; then
        local pport; pport="$(env_value OMK_PROXY_PORT)"
        if [[ -n "$pport" && "$(env_value OMK_APP_URL)" != "http://$APP_HOST:$pport" ]]; then
            set_env OMK_APP_URL "http://$APP_HOST:$pport"
            ( cd "$SCRIPT_DIR" && ./openmake_llm.sh restart < /dev/null | cat ) >/dev/null || log_warn "API 재시작 실패 — 'omk env start $env'"
        fi
    fi
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

summary() {
    local url
    url="$(env_value OMK_APP_URL)"
    add_todo "첫 로그인 후 관리자 비밀번호 변경 (초기 비밀번호는 .env 에 평문 저장)"
    [[ "$LLM_MODE" == "dgx" ]] && add_todo "관리자 → 모델 배정 → text.embed = bge-m3 (Knowledge Space 사용에 필요)"
    add_todo "(선택) 관리자 → 시스템 설정에서 검색 API 키 입력 — EXA·Tavily·Naver·Kakao 등, 서버마다 새로 발급"

    printf "\n%s══════════════════════════════════════════════════════%s\n" "$C_OK" "$C_RESET"
    printf "%s  OpenMake LLM 설치 완료 (%s · 내부망)%s\n" "$C_OK" "$OS_LABEL" "$C_RESET"
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
