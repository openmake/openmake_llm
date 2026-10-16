#!/usr/bin/env bash
# ============================================================
# Knowledge 수집 worker 모드 전환·롤백 훈련 (설계 §5 C4, 2026-10-16)
# ============================================================
#   scripts/knowledge-worker-rollback-drill.sh to-inprocess   external → inprocess (롤백)
#   scripts/knowledge-worker-rollback-drill.sh to-external    inprocess → external (전환)
#
# 순서(두 방향 같다 — "옛 소비자"·"새 소비자"만 바뀐다):
#   ① DB 모드 변경 + generation+1 — 옛 소비자의 새 claim 이 즉시 막힌다(claim 이 모드 행을 FOR SHARE 로 읽는다)
#   ② 옛 소비자 정지(SIGTERM → drain): to-inprocess 는 별도 worker, to-external 은 API 재시작(KNOWLEDGE_WORKER_MODE=external)
#   ③ 살아 있는 lease 가 0 이 될 때까지 기다리고 generation 이 ① 의 값인지 확인
#   ④ 새 소비자 기동: to-inprocess 는 API 재시작(KNOWLEDGE_WORKER_MODE=inprocess), to-external 은 별도 worker 기동
#   끝으로 /api/health 의 knowledge(mode·generation·현재 모드 소비자 heartbeat)를 확인한다.
#
# 환경변수(서버 이름은 쓰지 않는다):
#   DATABASE_URL 또는 KNOWLEDGE_PSQL     scripts/knowledge-worker-mode.sh 와 같다(둘 중 하나 필수)
#   KNOWLEDGE_API_APP                    API PM2 앱 이름(기본 openmake-llm)
#   KNOWLEDGE_WORKER_APP                 별도 worker PM2 앱 이름(기본 openmake-knowledge-worker)
#   KNOWLEDGE_API_HEALTH_URL             API 헬스 주소(기본 http://127.0.0.1:52416/api/health)
#   KNOWLEDGE_LEASE_WAIT_SEC             ③ 대기 상한(초, 기본 180 — 기본 lease 120초보다 길게)
#   KNOWLEDGE_HEALTH_WAIT_SEC            ④ 뒤 헬스 확인 상한(초, 기본 120)
#   KNOWLEDGE_HEARTBEAT_STALE_MS         헬스 확인에서 소비자가 살아 있다고 볼 heartbeat 나이 상한(ms, 기본 15000)
#   KNOWLEDGE_DRILL_RESTART_API_CMD      API 재시작 명령(기본 pm2 restart "<API 앱>" --update-env) — KNOWLEDGE_WORKER_MODE 가 export 된 채 실행된다
#   KNOWLEDGE_DRILL_STOP_WORKER_CMD      별도 worker 정지 명령(기본 pm2 stop "<worker 앱>" — SIGTERM 뒤 PM2 kill_timeout 까지 drain)
#   KNOWLEDGE_DRILL_START_WORKER_CMD     별도 worker 기동 명령(기본 저장소 루트에서 pm2 start ecosystem.config.js --only "<worker 앱>")
#   KNOWLEDGE_DRILL_DELETE_WORKER_CMD    롤백 끝에 worker 등록을 지우는 명령(기본 pm2 delete "<worker 앱>", ':' 이면 아무것도 안 함)
#   DRILL_DRY_RUN=1                      실행하지 않고 순서·명령만 출력(DB·pm2·curl 없이 돈다)
#
# ⚠️ 순서는 언제나 DB 모드 전환 → 설정(KNOWLEDGE_WORKER_MODE) 변경 → API 재시작이다. 설정이 external 인 채 떠 있는 API 는
#    DB 모드만 inprocess 로 되돌려도 재시작 전까지 poller 를 띄우지 않는다(작업이 쌓인다) — 그래서 ④ 가 API 를 다시 띄운다.
#    API 재시작은 셸의 KNOWLEDGE_WORKER_MODE 를 넘긴다(pm2 --update-env). 영구 반영은 .env 의 KNOWLEDGE_WORKER_MODE 를
#    같은 값으로 바꾸는 것까지다 — 그러지 않으면 다음 배포가 .env 값으로 되돌린다(④ 전에 바꿔 두거나, 끝의 안내대로 바로 바꾼다).
# 헬스 확인은 현재 DB 모드와 같은 종류의 소비자 heartbeat 만 본다. 관리자 정지된 API 안 worker 는 heartbeat 를 갱신하지 않으므로
#    add-on 이 꺼져 있으면 ④ 뒤 헬스 확인이 6 으로 끝난다(살아 있다고 오판하지 않는다).
# 종료 코드: 0 성공 · 2 사용법·도구 없음 · 3 DB 오류 · 4 lease 대기 초과 · 5 generation 불일치 · 6 헬스 확인 실패
set -euo pipefail

usage() {
    awk 'NR > 1 && /^#/ { print } /^set -euo pipefail/ { exit }' "$0" >&2
    exit 2
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE_SH="$SCRIPT_DIR/knowledge-worker-mode.sh"
API_APP="${KNOWLEDGE_API_APP:-openmake-llm}"
WORKER_APP="${KNOWLEDGE_WORKER_APP:-openmake-knowledge-worker}"
HEALTH_URL="${KNOWLEDGE_API_HEALTH_URL:-http://127.0.0.1:52416/api/health}"
LEASE_WAIT_SEC="${KNOWLEDGE_LEASE_WAIT_SEC:-180}"
HEALTH_WAIT_SEC="${KNOWLEDGE_HEALTH_WAIT_SEC:-120}"
HEARTBEAT_STALE_MS="${KNOWLEDGE_HEARTBEAT_STALE_MS:-15000}"
RESTART_API_CMD="${KNOWLEDGE_DRILL_RESTART_API_CMD:-pm2 restart \"$API_APP\" --update-env}"
STOP_WORKER_CMD="${KNOWLEDGE_DRILL_STOP_WORKER_CMD:-pm2 stop \"$WORKER_APP\"}"
START_WORKER_CMD="${KNOWLEDGE_DRILL_START_WORKER_CMD:-cd \"$REPO_DIR\" && pm2 start ecosystem.config.js --only \"$WORKER_APP\"}"
DELETE_WORKER_CMD="${KNOWLEDGE_DRILL_DELETE_WORKER_CMD:-pm2 delete \"$WORKER_APP\"}"
DRY="${DRILL_DRY_RUN:-0}"
POLL_SEC=2

step() { printf '\n━━ %s ━━\n' "$*"; }

# 명령 실행 — 대상 모드를 KNOWLEDGE_WORKER_MODE 로 export 한 채 bash -c 로 돈다(ecosystem 의 worker 등록 조건·API 설정 모드)
run_cmd() {
    local mode="$1" cmd="$2"
    if [[ "$DRY" == "1" ]]; then
        printf '[dry-run] KNOWLEDGE_WORKER_MODE=%s %s\n' "$mode" "$cmd"
        return 0
    fi
    KNOWLEDGE_WORKER_MODE="$mode" bash -c "$cmd"
}

mode_sh() {
    if [[ "$DRY" == "1" ]]; then
        printf '[dry-run] %s %s\n' "$MODE_SH" "$*"
        return 0
    fi
    "$MODE_SH" "$@"
}

current_generation() {
    if [[ "$DRY" == "1" ]]; then
        echo "?"
        return 0
    fi
    "$MODE_SH" generation
}

wait_leases() {
    if [[ "$DRY" == "1" ]]; then
        printf '[dry-run] %s running-leases 가 0 이 될 때까지 대기(최대 %ss)\n' "$MODE_SH" "$LEASE_WAIT_SEC"
        return 0
    fi
    local waited=0 n
    while :; do
        n="$("$MODE_SH" running-leases)"
        if [[ "$n" == "0" ]]; then
            echo "살아 있는 lease 0 (${waited}s)"
            return 0
        fi
        if (( waited >= LEASE_WAIT_SEC )); then
            echo "lease 대기 초과 — 살아 있는 lease ${n}건(${LEASE_WAIT_SEC}s). 옛 소비자가 아직 돌고 있는지 확인한다" >&2
            exit 4
        fi
        sleep "$POLL_SEC"
        waited=$((waited + POLL_SEC))
    done
}

check_generation() {
    [[ "$DRY" == "1" ]] && return 0
    local now
    now="$("$MODE_SH" generation)"
    if [[ "$now" != "$1" ]]; then
        echo "generation 불일치 — 기대 $1, 지금 $now (다른 전환이 끼어들었다)" >&2
        exit 5
    fi
    echo "generation $now 확인"
}

wait_health() {
    local want_mode="$1" want_gen="$2"
    if [[ "$DRY" == "1" ]]; then
        printf '[dry-run] %s 의 knowledge 가 mode=%s generation=%s 이고 소비자 heartbeat 가 %sms 안인지 확인(최대 %ss)\n' \
            "$HEALTH_URL" "$want_mode" "$want_gen" "$HEARTBEAT_STALE_MS" "$HEALTH_WAIT_SEC"
        return 0
    fi
    local waited=0 body
    while :; do
        body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null || true)"
        if [[ -n "$body" ]] && printf '%s' "$body" | node -e '
            let s = "";
            process.stdin.on("data", (d) => { s += d; }).on("end", () => {
                const k = (JSON.parse(s) || {}).knowledge || {};
                const age = k.workerHeartbeatAgeMs;
                const ok = k.mode === process.argv[1] && String(k.generation) === process.argv[2]
                    && typeof age === "number" && age < Number(process.argv[3]);
                process.exit(ok ? 0 : 1);
            });' "$want_mode" "$want_gen" "$HEARTBEAT_STALE_MS" 2>/dev/null; then
            echo "헬스 확인 — knowledge.mode=$want_mode generation=$want_gen, 소비자 heartbeat 살아 있음"
            return 0
        fi
        if (( waited >= HEALTH_WAIT_SEC )); then
            echo "헬스 확인 실패 — $HEALTH_URL 의 knowledge 가 mode=$want_mode generation=$want_gen(heartbeat < ${HEARTBEAT_STALE_MS}ms)이 아니다" >&2
            exit 6
        fi
        sleep "$POLL_SEC"
        waited=$((waited + POLL_SEC))
    done
}

remind() {
    printf '\n완료. 영구 반영: .env 의 KNOWLEDGE_WORKER_MODE=%s 로 맞춘다(다음 배포가 .env 값을 쓴다).\n' "$1"
}

to_inprocess() {
    step "① DB 모드 → inprocess (generation+1) — 별도 worker 의 새 claim 이 막힌다"
    mode_sh set inprocess
    local gen
    gen="$(current_generation)"
    step "② 별도 worker 정지(SIGTERM → drain)"
    run_cmd inprocess "$STOP_WORKER_CMD" || echo "정지 명령 실패 — 이미 내려가 있으면 ③ 의 lease 확인으로 넘어간다"
    step "③ 살아 있는 lease 0 대기 + generation 확인"
    wait_leases
    check_generation "$gen"
    step "④ API 재시작(KNOWLEDGE_WORKER_MODE=inprocess) — 설정 변경을 반영해 API 안 poller 재개(재시작 없이는 뜨지 않는다)"
    run_cmd inprocess "$RESTART_API_CMD"
    wait_health inprocess "$gen"
    run_cmd inprocess "$DELETE_WORKER_CMD" || echo "worker 등록 삭제 실패 — 'pm2 ls' 로 확인한다"
    remind inprocess
}

to_external() {
    step "① DB 모드 → external (generation+1) — API 안 poller 의 새 claim 이 막힌다"
    mode_sh set external
    local gen
    gen="$(current_generation)"
    step "② API 재시작(KNOWLEDGE_WORKER_MODE=external) — 진행 중 수집은 종료 drain 으로 마치거나 lease 를 반납하고, 다시 뜬 API 는 poller 를 띄우지 않는다"
    run_cmd external "$RESTART_API_CMD"
    step "③ 살아 있는 lease 0 대기 + generation 확인"
    wait_leases
    check_generation "$gen"
    step "④ 별도 worker 기동"
    run_cmd external "$START_WORKER_CMD"
    wait_health external "$gen"
    remind external
}

DIRECTION="${1:-}"
case "$DIRECTION" in
    to-inprocess|to-external) ;;
    *) usage ;;
esac

if [[ "$DRY" != "1" ]]; then
    for tool in curl node; do
        command -v "$tool" >/dev/null 2>&1 || { echo "$tool 이 필요하다" >&2; exit 2; }
    done
fi

case "$DIRECTION" in
    to-inprocess) to_inprocess ;;
    to-external) to_external ;;
esac
