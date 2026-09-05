#!/usr/bin/env bash
# ============================================================
# 라우팅/TTFT 일일 집계 — PM2 cron_restart 로 매일 1회 실행 (2026-08-02)
# ============================================================
# 등록(1회만):
#   pm2 start scripts/daily-routing-report.sh --name routing-report \
#       --cron "17 9 * * *" --no-autorestart && pm2 save
# 해제:
#   pm2 delete routing-report && pm2 save
#
# 목적: 임계(OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE) 0.7→0.35 조정 효과를
# 며칠에 걸쳐 추적한다. 대화형 세션 없이도 표본이 쌓이도록 파일로 남긴다.
#
# 볼 지표(기준선 2026-08-02, 임계 조정 직후):
#   · LLM 라우팅 경로 10%      → 떨어졌는가
#   · prep>1s(A형 발동) 18.2% → 떨어졌는가
#   · 남은 LLM 발동이 무매칭(키워드 신뢰도 ≤0.3) 위주인가 = 임계가 제대로 걸린 것
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 로그 디렉터리는 .env 의 OMK_LOG_DIR 을 따른다 — pm2 cron 은 앱 env 를 상속하지 않으므로
# 여기서 직접 읽는다(미설정이면 종전 /tmp).
OMK_LOG_DIR="${OMK_LOG_DIR:-$(grep -E "^OMK_LOG_DIR=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')}"
export OMK_LOG_DIR="${OMK_LOG_DIR:-/tmp}"
OUT_DIR="$REPO/logs/routing-reports"          # logs/ 는 .gitignore 대상
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$(date +%Y-%m-%d).txt"

{
    echo "# 라우팅/TTFT 일일 집계"
    date "+측정: %Y-%m-%d %H:%M"
    echo
    bash "$REPO/scripts/analyze-agent-routing.sh" 2>&1 || echo "(라우팅 집계 실패)"
    echo
    echo "────────────────────────────────────────────"
    echo
    bash "$REPO/scripts/analyze-chat-timing.sh" 2>&1 || echo "(TTFT 집계 실패)"
    echo
    echo "────────────────────────────────────────────"
    echo
    # 에이전트 작업 비용(2026-08-03 추가) — 이 파일은 이름만 routing 이고 실제로는 '일일 집계'다.
    # 파일명·PM2 등록명을 바꾸면 cron 재등록이 필요해 그대로 두고 섹션만 늘린다.
    bash "$REPO/scripts/agent-cost-report.sh" 2>&1 || echo "(에이전트 비용 집계 실패)"
    echo
    echo "────────────────────────────────────────────"
    echo
    # 사용자 메모리(2026-09-06 추가) — 검색·scope 도입 게이트(cap 발동·활성 p50) 관측.
    bash "$REPO/scripts/memory-report.sh" 2>&1 || echo "(메모리 집계 실패)"
} > "$OUT"

# 보관 30일 — 무한 증가 방지
find "$OUT_DIR" -name '*.txt' -mtime +30 -delete 2>/dev/null || true

echo "[routing-report] 저장: $OUT"
