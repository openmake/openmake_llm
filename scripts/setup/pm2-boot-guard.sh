#!/bin/bash
# ==============================================================================
# PM2 부팅 복구 가드 — LaunchAgent com.openmake.pm2 가 로그인 때 실행한다 (mac-pm2-boot.sh 가 설치·등록).
# 저장소가 외장 디스크에 있을 수 있어 이 파일은 ~/.local/share/openmake 에 복사돼 실행된다 — 다른 파일을 읽지 않는다.
# macOS 시스템 bash 3.2 에서 돈다.
#
#   pm2-boot-guard.sh inspect <node>                                   # dump 검사: app=… · path=… 를 출력
#   pm2-boot-guard.sh run <node> <pm2> <docker|-> <docker_host|-> [컨테이너…]
#
# run: 저장된 dump($PM2_HOME/dump.pm2)가 가리키는 경로(작업 폴더·실행 파일·절대 경로 인터프리터)가 생기고
#      지정한 전용 DB/Redis 컨테이너가 running(+healthy)일 때까지 정해진 시간만 기다린 뒤 `pm2 resurrect` 한다.
#      resurrect 뒤 dump 의 모든 앱이 PM2 목록에 있는지 확인한다.
# 하지 않는 일: dump 쓰기(pm2 save)·환경 변경·빌드·마이그레이션·업데이트·VM/컨테이너 생성·시작.
# Docker 는 이 프로세스의 docker 명령에만 전용 소켓을 준다 — PM2 에는 넘기지 않는다.
#
# 종료 코드: 0 복구 확인 / 1 복구 후 빠진 앱·pm2 오류 / 75 시간 안에 경로·DB 준비 안 됨 / 78 dump 없음·깨짐·설정 오류
# ==============================================================================
set -u

log() { printf '%s pm2-boot: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
fail() { log "error: $2; PM2 apps were not restored by this run"; exit "$1"; }

# dump 를 읽기만 한다. pm2 resurrect 는 깨진 dump 를 지우므로, 여기서 먼저 걸러 부르지 않는다.
inspect_dump() { # $1=node
    "$1" -e '
        const fs = require("fs"), f = process.argv[1];
        let l;
        try { l = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.error(`dump ${f} is missing or unreadable: ${e.message}`); process.exit(2); }
        if (!Array.isArray(l) || l.length === 0) { console.error(`dump ${f} has no saved apps`); process.exit(2); }
        const out = new Set();
        for (const p of l) {
            if (!p || typeof p.name !== "string" || !p.name) { console.error(`dump ${f} has an app without a name`); process.exit(2); }
            out.add(`app=${p.name}`);
            for (const k of ["pm_cwd", "pm_exec_path", "exec_interpreter"]) {
                const v = p[k];
                if (typeof v === "string" && v.startsWith("/")) out.add(`path=${v}`);
            }
        }
        process.stdout.write([...out].join("\n") + "\n");
    ' "$PM2_HOME/dump.pm2"
}

# docker 호출 하나 — 응답이 없으면 OMK_PM2_BOOT_DOCKER_TIMEOUT(초) 뒤 SIGKILL 로 끊는다 (전체 기한을 넘기지 않게).
# 전용 소켓은 이 호출에만 준다. 시간 초과는 stderr 에 "timed out" 을 남기고 124.
docker_bounded() { # $1=node $2=docker $3=DOCKER_HOST [docker 인자…]
    local node="$1"
    shift
    "$node" -e '
        const [docker, host, ...args] = process.argv.slice(1);
        const env = { ...process.env, DOCKER_HOST: host }; delete env.DOCKER_CONTEXT;
        const ms = 1000 * Number(process.env.OMK_PM2_BOOT_DOCKER_TIMEOUT || 20);
        const r = require("child_process").spawnSync(docker, args, { env, timeout: ms, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
        if (r.error && r.error.code === "ETIMEDOUT") { console.error(`docker ${args[0]} timed out after ${ms / 1000}s (killed)`); process.exit(124); }
        if (r.error) { console.error(`docker ${args[0]}: ${r.error.message}`); process.exit(125); }
        process.stdout.write(r.stdout || ""); process.exit(r.status === null ? 125 : r.status);
    ' "$@"
}

container_ready() { # $1=node $2=docker $3=DOCKER_HOST $4=이름
    local s
    s="$(docker_bounded "$1" "$2" "$3" inspect -f '{{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}}' "$4")" || return 1
    [ "$s" = "running healthy" ] || [ "$s" = "running" ]
}

# 아직 준비 안 된 것 (한 줄에 하나). 빈 출력 = 모두 준비
not_ready() { # $1=node $2=dump 검사 결과 $3=pm2 $4=docker $5=DOCKER_HOST [컨테이너…]
    local node="$1" report="$2" pm2="$3" docker="$4" host="$5" p c
    shift 5
    { printf '%s\n' "$pm2"; printf '%s\n' "$report" | sed -n 's/^path=//p'; } | while IFS= read -r p; do
        [ -e "$p" ] || printf 'path %s\n' "$p"
    done
    [ $# -eq 0 ] || [ -x "$docker" ] || { printf 'path %s\n' "$docker"; return 0; }
    for c in "$@"; do
        container_ready "$node" "$docker" "$host" "$c" || printf 'container %s\n' "$c"
    done
}

run() { # $1=node $2=pm2 $3=docker|- $4=DOCKER_HOST|- [컨테이너…]
    [ $# -ge 4 ] || fail 78 "usage: run <node> <pm2> <docker|-> <docker_host|-> [container...]"
    local node="$1" pm2="$2" docker="$3" host="$4" report missing last="" deadline wait="${OMK_PM2_BOOT_WAIT_SECONDS:-900}" interval="${OMK_PM2_BOOT_INTERVAL:-5}"
    shift 4
    [ "$(id -u)" != 0 ] || fail 78 "must run as the user who owns PM2, not root"
    [ -n "${PM2_HOME:-}" ] || fail 78 "PM2_HOME is not set"
    [ -x "$node" ] || fail 78 "node $node not found"
    if [ $# -gt 0 ] && [ "$docker" = - ]; then fail 78 "containers given without docker"; fi
    report="$(inspect_dump "$node" 2>&1)" || fail 78 "$report"
    log "start (PM2_HOME=$PM2_HOME, node $node, $(printf '%s\n' "$report" | grep -c '^app=') saved app(s))"

    deadline=$(( $(date +%s) + wait ))
    while :; do
        missing="$(not_ready "$node" "$report" "$pm2" "$docker" "$host" "$@")"
        [ -n "$missing" ] || break
        if [ "$missing" != "$last" ]; then log "waiting for: $(printf '%s' "$missing" | paste -sd ';' -)"; last="$missing"; fi
        [ "$(date +%s)" -lt "$deadline" ] || fail 75 "still not ready after ${wait}s: $(printf '%s' "$missing" | paste -sd ';' -)"
        sleep "$interval"
    done
    log "paths and containers ready"

    # PM2 데몬이 종료 신호 때 목록을 dump 에 다시 쓰므로, 부팅 직전 dump 를 본인만 읽는 파일로 남긴다.
    local bdir="${OMK_PM2_BACKUP_DIR:-}"
    unset OMK_PM2_BACKUP_DIR OMK_PM2_BOOT_WAIT_SECONDS OMK_PM2_BOOT_INTERVAL OMK_PM2_BOOT_DOCKER_TIMEOUT   # PM2 데몬에 넘기지 않는다
    if [ -n "$bdir" ]; then
        ( umask 077; mkdir -p "$bdir" && cp "$PM2_HOME/dump.pm2" "$bdir/dump.pm2.last-boot.tmp" \
            && chmod 600 "$bdir/dump.pm2.last-boot.tmp" && mv "$bdir/dump.pm2.last-boot.tmp" "$bdir/dump.pm2.last-boot" ) \
            || fail 78 "could not back up dump to $bdir"
    fi

    # resurrect 는 이미 실행 중인 이름은 건너뛰고 없는 앱만 띄운다.
    "$node" "$pm2" resurrect || fail 1 "pm2 resurrect failed"
    local running absent
    running="$("$node" "$pm2" jlist 2>/dev/null | "$node" -e '
        let l = []; try { l = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch {}
        for (const p of l) console.log(`${p.name}\t${(p.pm2_env && p.pm2_env.status) || "?"}`);')"
    absent="$(printf '%s\n' "$report" | sed -n 's/^app=//p' | while IFS= read -r a; do
        printf '%s\n' "$running" | cut -f1 | grep -qxF "$a" || printf '%s\n' "$a"
    done)"
    [ -z "$absent" ] || fail 1 "not in PM2 after resurrect: $(printf '%s' "$absent" | paste -sd ' ' -)"
    log "ok: $(printf '%s' "$running" | tr '\t' '=' | paste -sd ' ' -)"
}

case "${1:-}" in
    inspect) [ $# -eq 2 ] || fail 78 "usage: inspect <node>"; [ -n "${PM2_HOME:-}" ] || fail 78 "PM2_HOME is not set"; inspect_dump "$2" || exit 2 ;;
    run) shift; run "$@" ;;
    *) printf 'usage: %s inspect <node> | run <node> <pm2> <docker|-> <docker_host|-> [container...]\n' "$0" >&2; exit 78 ;;
esac
