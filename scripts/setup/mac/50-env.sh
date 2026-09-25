# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 앱 .env 생성 (--minimal · omk 가 부르는 앱 본체 설치)
# ==============================================================================
# 운영 .env 를 복사하지 않고 새로 만든다 — gen-env.mjs 가 부팅 필수 키와 비밀값을 채운다.
# 운영 기능 프로필·웹 푸시 키·DGX 파생값·게이트웨이 주소·내부망 HTTPS 는 omk 가 이어서 채운다.

# 쉼표 목록에 값이 없으면 덧붙인다.
append_csv_env() {
    local key="$1" val="$2" cur
    cur="$(env_value "$key")"
    if [[ -z "$cur" ]]; then
        set_env "$key" "$val"
    elif ! printf '%s' "$cur" | tr ',' '\n' | grep -qxF "$val"; then
        set_env "$key" "$cur,$val"
    fi
}

# --public-url — 공개 주소를 OMK_APP_URL/CORS 에 반영하고 https 면 secure cookie.
apply_public_url() {
    local url="${1%/}"
    [[ "$url" =~ ^https?://[^/[:space:]]+$ ]] || die "--public-url 은 스킴+호스트[:포트] 형식이어야 합니다: $url"
    set_env OMK_APP_URL "$url"
    append_csv_env CORS_ORIGINS "$url"
    set_env OMK_WEB_PORT "$WEB_PORT"
    if [[ "$url" == https://* ]]; then
        set_env COOKIE_SECURE true
        set_env ALLOW_INSECURE_COOKIES false
    fi
    log_ok "공개 주소 $url 반영"
}

setup_env() {
    log_step ".env 생성"
    # 서브셸에서 export — 빈 값은 내보내지 않아야 gen-env.mjs 의 기본값이 살아난다.
    (
        export OMK_PORT="$APP_PORT" OMK_WEB_PORT="$WEB_PORT"
        export OMK_POSTGRES_PORT="$PG_PORT" OMK_REDIS_PORT="$RD_PORT"
        [[ -n "$LLM_BASE_URL" ]] && export OMK_LLM_BASE_URL="$LLM_BASE_URL"
        [[ -n "$LLM_API_KEY" ]]  && export OMK_LLM_API_KEY="$LLM_API_KEY"
        [[ -n "$LLM_MODEL" ]]    && export OMK_LLM_MODEL="$LLM_MODEL"
        [[ -n "$INSTANCE" ]]     && export OMK_INSTANCE="$INSTANCE"
        if [[ $FORCE_ENV -eq 1 ]]; then
            node "$SCRIPT_DIR/scripts/setup/gen-env.mjs" --force >/dev/null
        else
            node "$SCRIPT_DIR/scripts/setup/gen-env.mjs" >/dev/null
        fi
    ) || die ".env 생성 실패"
    if [[ -n "$INSTANCE" ]]; then
        grep -qE '^OMK_INSTANCE=' "$ENV_FILE" || set_env OMK_INSTANCE "$INSTANCE"
        grep -qE '^COMPOSE_PROJECT_NAME=' "$ENV_FILE" || set_env COMPOSE_PROJECT_NAME "openmake-$INSTANCE"
    fi
    [[ -z "$PUBLIC_URL" ]] || apply_public_url "$PUBLIC_URL"
    log_ok ".env 준비 완료 ($ENV_FILE)"
}
