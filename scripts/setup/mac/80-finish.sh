# shellcheck shell=bash
# 이 파일의 전역은 다른 단계 파일·install_mac.sh 가 읽는다 (파일 간 사용).
# shellcheck disable=SC2034
# ==============================================================================
# install_mac.sh 단계 — 호스트 마무리 (인증서 신뢰 · 자동 시작) — 요약은 common/stack.sh
# ==============================================================================
# 자동 시작 구성:
#   PM2(앱·게이트웨이·프록시·백업) → LaunchAgent com.openmake.pm2 (mac-pm2-boot.sh, 로그인 시 외장 경로·DB/Redis 준비 후 resurrect)
#                                    + 저장된 앱을 잃지 않을 때만 pm2 save
#   Colima(전용 Docker)            → 로그인 시 자동 시작 (30-toolchain 의 LaunchAgent)
#   Tailscale                      → sudo brew services (LaunchDaemon, 부팅 시)
# 사용자 로그인이 전제라 FileVault 끄기 + 자동 로그인이 필요하다(10-prereqs 안내).

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

# 지금 실행 중인 PM2 앱을 부팅 복구 목록(dump)에 저장한다 — 저장된 앱을 잃지 않을 때만.
# 실행 중 앱이 없거나, dump 에 있는 앱이 지금 목록에 없으면 저장하지 않는다 (빈·부분 목록이 dump 를 덮지 않게).
pm2_save_guarded() {
    local dump="${PM2_HOME:-$HOME/.pm2}/dump.pm2" current lost backup
    current="$(pm2 jlist 2>/dev/null | node -e '
        let l = []; try { l = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch {}
        for (const p of l) if (p && p.name && !(p.pm2_env && p.pm2_env.pmx_module)) console.log(p.name);')"
    if [[ -z "$current" ]]; then
        log_warn "실행 중인 PM2 앱이 없습니다 — 부팅 복구 목록(dump)을 저장하지 않았습니다."; return 1
    fi
    if [[ -f "$dump" ]]; then
        lost="$(node -e '
            const cur = new Set(process.argv[2].split("\n")); let l;
            try { l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
            process.stdout.write((Array.isArray(l) ? l : []).map(p => p && p.name).filter(n => n && !cur.has(n)).join(" "));' "$dump" "$current")" \
            || { log_warn "$dump 을 읽을 수 없습니다 — 저장하지 않았습니다 (원본 보존)."; return 1; }
        if [[ -n "$lost" ]]; then
            log_warn "저장된 PM2 앱이 지금 실행 중이 아닙니다: $lost — 부팅 복구 목록(dump)을 덮지 않았습니다."; return 1
        fi
        backup="$OMK_ROOT/backups/pm2/dump.pm2.before-save-$(date +%Y%m%d%H%M%S)-$$"
        (umask 077; mkdir -p "$(dirname "$backup")" && cp "$dump" "$backup" && chmod 600 "$backup") \
            || { log_warn "dump 백업 실패 ($backup) — 저장하지 않았습니다."; return 1; }
    fi
    pm2 save >/dev/null || { log_warn "pm2 save 실패"; return 1; }
}

# PM2 부팅 복구 등록 — sudo pm2 startup 대신 사용자 LaunchAgent(com.openmake.pm2)를 mac-pm2-boot.sh 로 맞춘다.
run_pm2_boot_repair() {
    OMK_ROOT="$OMK_ROOT" COLIMA_HOME="${OPENMAKE_COLIMA_HOME:-${COLIMA_HOME:-}}" bash "$SCRIPT_DIR/scripts/setup/mac-pm2-boot.sh" "$@"
}

setup_autostart() {
    [[ $NO_START -eq 1 ]] && return 0
    local args=(--apply) ok=1
    [[ $SKIP_DOCKER -ne 1 ]] || args+=(--no-docker)
    pm2_save_guarded || { ok=0; add_todo "PM2 부팅 복구 목록 확인 후 저장: pm2 ls → pm2 save"; }
    if ! run_pm2_boot_repair "${args[@]}"; then
        ok=0
        log_warn "PM2 부팅 복구 등록이 끝나지 않았습니다 (위 출력)."
        add_todo "PM2 부팅 복구 등록: bash $SCRIPT_DIR/scripts/setup/mac-pm2-boot.sh --check 후 --apply"
    fi
    [[ $ok -eq 1 ]] && log_ok "재부팅 자동 시작 (PM2 · Docker$([[ "$DGX_VIA" == "tailscale" ]] && echo ' · Tailscale'))"
    return 0
}

host_finalize() {
    log_step "호스트 마무리"
    trust_root_ca
    omk_cmd env backup "$(omk_env_name)" --schedule "$BACKUP_CRON" || log_warn "DB 백업 예약 실패 — 'omk env backup $(omk_env_name) --schedule'"
    setup_logrotate
    setup_autostart
    dgx_followup
}

# --minimal — omk 가 이어서 스택을 붙이므로 짧게 끝낸다.
summary_minimal() {
    log_ok "앱 본체 설치 완료 — API http://localhost:$APP_PORT · 웹 http://localhost:$WEB_PORT"
}
