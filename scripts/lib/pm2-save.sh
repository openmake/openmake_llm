# shellcheck shell=bash
# ==============================================================================
# PM2 부팅 복구 목록(dump) 저장 — source 해서 쓰는 함수 (bash 3.2 호환)
#
# install_mac.sh(scripts/setup/mac/80-finish.sh)와 openmake_llm.sh deploy(모델 이름을 바꾼 배포)가 함께 쓴다.
# 호출자가 log_warn 을 정의한다. pm2·node 가 PATH 에 있어야 한다.
# ==============================================================================

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
        backup="${OMK_ROOT:-$HOME/.openmake}/backups/pm2/dump.pm2.before-save-$(date +%Y%m%d%H%M%S)-$$"
        (umask 077; mkdir -p "$(dirname "$backup")" && cp "$dump" "$backup" && chmod 600 "$backup") \
            || { log_warn "dump 백업 실패 ($backup) — 저장하지 않았습니다."; return 1; }
    fi
    pm2 save >/dev/null || { log_warn "pm2 save 실패"; return 1; }
}
