# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 스택 설치 (omk env install 위임)
# ==============================================================================
# omk 가 소스(이 디렉터리)를 재사용해 ./install.sh --minimal(앱 본체)을 부른 뒤 게이트웨이·검색·샌드박스
# 이미지·운영 프로필·DGX·내부망 HTTPS·선택 기능을 붙인다. 설치 답변은 전부 omk 옵션으로 넘긴다.

readonly LITELLM_VERSION="1.100.1"   # 1.102 는 /v1/models 지연 회귀로 운영이 롤백한 버전

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
