#!/usr/bin/env bash
# ============================================================
# URL 단독 스킵(PR #567) 효과 비교 — 배포 전후 일일 집계 대조 (2026-08-22)
# ============================================================
# 등록(일회성, 배포 다음날 09:25):
#   pm2 start scripts/compare-routing-effect.sh --name routing-effect \
#       --cron "25 9 23 8 *" --no-autorestart && pm2 save
# 해제:
#   pm2 delete routing-effect && pm2 save
#
# 목적: daily-routing-report.sh 가 매일 남기는 집계를 읽어, URL 단독 질의 스킵
# 배포(2026-08-22) 전후의 LLM 라우팅 발동 변화를 **LLM 없이 산술로만** 비교한다.
# 세션·대화형 환경과 무관하게 결과가 파일로 남는 것이 요점 — 채팅 세션이 끊겨도
# 다음날 수치가 보존된다.
#
# 보는 지표:
#   · LLM 라우팅 발동 건수/비중  — URL 단독분이 빠지면 내려가야 한다
#   · URL 단독 케이스 수          — 0 이어야 스킵이 걸린 것
#   · 순수 낭비율 / 무매칭 발동률 — 임계 0.35 효과가 유지되는지(회귀 감시)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IN_DIR="$REPO/logs/routing-reports"
TODAY="$(date +%Y-%m-%d)"
OUT="$IN_DIR/effect-$TODAY.txt"

# 멱등 가드 — pm2 cron 을 날짜 한정(25 9 23 8 *) 대신 매일(25 9 * * *)로 걸 수 있게 한다.
# 날짜 한정 일회성은 그 시각에 머신이 절전이면 보충 실행 기회가 없다(미실행과 정상완료를
# 파일 유무로만 구분하게 됨 — orchestration-shadow-report 선례).
if [[ -f "$OUT" ]]; then
    echo "[routing-effect] 오늘 결과 이미 존재 — 종료: $OUT"
    exit 0
fi
# 배포일 — 이 날짜 이전 파일이 기준선, 이후가 적용본
DEPLOY_DATE="${ROUTING_EFFECT_DEPLOY_DATE:-2026-08-22}"

# 집계 파일 1개에서 지표 추출 → "총계 발동 낭비 무매칭 URL단독" 한 줄로 반환
extract() {
    local f="$1"
    local total fired waste unmatched urlonly
    total=$(grep -oE '^라우팅 총 [0-9]+' "$f" 2>/dev/null | grep -oE '[0-9]+' | head -1)
    fired=$(grep -oE '^LLM 라우팅 발동 [0-9]+' "$f" 2>/dev/null | grep -oE '[0-9]+' | head -1)
    waste=$(grep -oE '같은 답 [0-9]+건\([0-9]+%' "$f" 2>/dev/null | grep -oE '[0-9]+%' | head -1)
    unmatched=$(grep -oE '무매칭\(≤0\.3\)에서 발동 [0-9]+건\([0-9]+%' "$f" 2>/dev/null | grep -oE '[0-9]+%' | head -1)
    # 케이스 목록에서 "URL 하나만" 질의 — 질의 미리보기가 http(s) 로 시작하고 공백이 없다
    urlonly=$(grep -cE '\| https?://[^ ]*$' "$f" 2>/dev/null || true)
    echo "${total:-0} ${fired:-0} ${waste:-n/a} ${unmatched:-n/a} ${urlonly:-0}"
}

{
    echo "# URL 단독 스킵 효과 비교 (PR #567)"
    date "+측정: %Y-%m-%d %H:%M"
    echo "배포일: $DEPLOY_DATE (그 이전 = 기준선, 이후 = 적용본)"
    echo

    # 상류 의존: 09:17 daily-routing-report 가 만든 당일 집계. 실패·지연 시 전날까지
    # 데이터로 "정상처럼" 판정되는 것을 막는다 — 경고를 본문 최상단에 남긴다.
    if [[ ! -f "$IN_DIR/$TODAY.txt" ]]; then
        echo "⚠️  경고: 당일 집계($TODAY.txt)가 없습니다 — daily-routing-report(09:17) 실패/지연."
        echo "    아래 표는 전일까지의 데이터만 반영하며, 배포 효과 판정에 쓰지 마세요."
        echo
    fi

    shopt -s nullglob
    files=("$IN_DIR"/2[0-9]*.txt)   # effect-*.txt 자기 출력은 제외(파일명이 숫자로 시작하는 집계만)
    if [[ ${#files[@]} -eq 0 ]]; then
        echo "집계 파일 없음 — daily-routing-report.sh 실행 여부를 확인하세요."
        exit 0
    fi

    printf "%-12s %8s %8s %8s %10s %10s %s\n" \
        "날짜" "라우팅" "LLM발동" "발동률" "순수낭비" "무매칭" "URL단독"
    echo "──────────────────────────────────────────────────────────────────────────"
    for f in "${files[@]}"; do
        day=$(basename "$f" .txt)
        read -r total fired waste unmatched urlonly <<<"$(extract "$f")"
        rate="n/a"
        [[ "$total" -gt 0 ]] && rate="$(( fired * 100 / total ))%"
        mark=" "
        [[ "$day" > "$DEPLOY_DATE" ]] && mark="*"
        printf "%-12s %8s %8s %8s %10s %10s %7s %s\n" \
            "$day" "$total" "$fired" "$rate" "$waste" "$unmatched" "$urlonly" "$mark"
    done
    echo "  (* = 배포 이후)"
    echo

    echo "## 운영 로그의 실제 스킵 발동"
    LOG=/tmp/openmake-llm-out.log
    if [[ -f "$LOG" ]]; then
        skip=$(grep -c 'URL 단독 직행' "$LOG" 2>/dev/null || true)
        hint=$(grep -c 'URL 단독 직행.*도메인 힌트' "$LOG" 2>/dev/null || true)
        echo "  'URL 단독 직행' 로그 ${skip:-0}건 (그중 도메인 힌트 ${hint:-0}건)"
        echo "  ※ pm2 로그는 로테이션되므로 보존 구간만 반영됩니다."
    else
        echo "  로그 파일 없음: $LOG"
    fi
    echo

    echo "## 판정 기준"
    echo "  · URL단독 열이 0 으로 떨어졌으면 스킵이 걸린 것"
    echo "  · LLM발동/발동률이 내려갔으면 의도한 절감 (건당 ~2s)"
    echo "  · 순수낭비·무매칭 열은 임계 0.35 효과의 회귀 감시용 — 크게 흔들리면 확인 필요"
    echo "  · 배포 당일(2026-08-22)은 배포 전후가 섞이므로 다음날부터가 온전한 비교"
} > "$OUT"

echo "[routing-effect] 저장: $OUT"
cat "$OUT"
