# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 앱 본체: 의존성 · PostgreSQL/Redis(빈 DB) · 마이그레이션 · 빌드 · PM2 기동
# (--minimal · omk 가 부른다. SearXNG·샌드박스 이미지·게이트웨이는 omk 가 붙인다)
# ==============================================================================

install_deps() {
    log_step "npm 의존성 설치 (workspaces)"
    ( cd "$SCRIPT_DIR" && npm install --no-audit --no-fund ) || die "npm install 실패"
    log_ok "의존성 설치 완료"
    if ! ( cd "$SCRIPT_DIR" && npm audit --omit=dev --audit-level=critical >/dev/null 2>&1 ); then
        log_warn "운영 의존성에 critical 보안 권고가 있습니다 — 'npm audit --omit=dev' 로 확인하세요(설치는 계속합니다)"
    fi
}

compose_up() {
    log_step "PostgreSQL / Redis"
    if [[ $SKIP_DOCKER -eq 1 ]]; then
        log_info "--skip-docker — 컨테이너 기동을 건너뜁니다."
        return 0
    fi
    # compose 파일이 infra/ 에 있어 루트 .env 를 --env-file 로 명시해야 POSTGRES_PASSWORD 가 들어간다.
    $DOCKER_COMPOSE --env-file "$ENV_FILE" -f "$SCRIPT_DIR/infra/docker-compose.yml" up -d postgres redis \
        || die "PostgreSQL/Redis 기동 실패 — 포트 충돌이면 --postgres-port / --redis-port 로 지정하세요."
    local i
    for ((i = 1; i <= HEALTH_RETRIES; i++)); do
        if docker exec "$PG_CONTAINER" pg_isready -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" >/dev/null 2>&1; then
            log_ok "PostgreSQL 준비 완료 (~$((i * HEALTH_INTERVAL))s)"
            break
        fi
        [[ $i -eq $HEALTH_RETRIES ]] && die "PostgreSQL 기동 실패 — docker logs $PG_CONTAINER 확인"
        sleep "$HEALTH_INTERVAL"
    done
    docker exec "$RD_CONTAINER" redis-cli ping >/dev/null 2>&1 \
        && log_ok "Redis 준비 완료" || log_warn "Redis ping 실패 — docker logs $RD_CONTAINER 확인"
}

run_migrations() {
    log_step "DB 마이그레이션 (빈 DB)"
    # 마이그레이션 CLI(ts-node)가 워크스페이스 패키지 dist 를 import 한다 — 먼저 빌드.
    if [[ ! -f "$SCRIPT_DIR/packages/shared-types/dist/index.js" ]]; then
        ( cd "$SCRIPT_DIR" && npm run build:packages ) || die "워크스페이스 패키지 빌드 실패"
    fi
    ( cd "$SCRIPT_DIR/apps/api" && npx ts-node src/data/migrations/cli.ts migrate ) \
        || die "마이그레이션 실패 — DATABASE_URL 과 POSTGRES_PASSWORD 가 일치하는지 확인하세요."
    log_ok "마이그레이션 완료"
}

build_app() {
    log_step "빌드"
    if [[ $SKIP_BUILD -eq 1 ]]; then
        log_info "--skip-build — 빌드를 건너뜁니다."
        return 0
    fi
    log_info "npm run build (백엔드 + 프론트) — 수 분 걸릴 수 있습니다"
    ( cd "$SCRIPT_DIR" && NEXT_PUBLIC_WEB_PORT="$WEB_PORT" NEXT_PUBLIC_WS_PORT="$APP_PORT" npm run build ) \
        || die "빌드 실패"
    log_ok "빌드 완료"
}

start_app() {
    log_step "PM2 기동"
    if [[ $NO_START -eq 1 ]]; then
        log_info "--no-start — './openmake_llm.sh start' 로 직접 기동하세요."
        return 0
    fi
    ( cd "$SCRIPT_DIR" && PORT="$APP_PORT" OMK_WEB_PORT="$WEB_PORT" \
        API_PROXY_TARGET="http://localhost:$APP_PORT" \
        pm2 start ecosystem.config.js --update-env ) || die "PM2 기동 실패"
    local i
    for ((i = 1; i <= HEALTH_RETRIES; i++)); do
        if curl -fsS --max-time 3 "http://localhost:$APP_PORT/health" >/dev/null 2>&1; then
            log_ok "API health check 성공 (~$((i * HEALTH_INTERVAL))s)"
            return 0
        fi
        sleep "$HEALTH_INTERVAL"
    done
    log_err "health check 실패 — 최근 로그 50줄:"
    pm2 logs "$APP_NAME" --lines 50 --nostream 2>/dev/null || true
    exit 3
}
