#!/usr/bin/env bash
# ============================================================
# ChatTiming 분석 — TTFT 분해 로그를 분포로 집계 (2026-08-02)
# ============================================================
#   bash scripts/analyze-chat-timing.sh [로그경로]
#
# 2026-08-02 작업에서 남긴 질문들을 표본이 쌓인 뒤 데이터로 답하기 위한 도구다.
#   1) 병목이 정말 모델 prefill(ttfc)인가 — 전처리(prep)는 1~2% 였다(표본 12건)
#   2) DGX --enable-prefix-caching 이 ttfc 를 줄였는가 — 당시 4건으로는 미확정
#   3) agent-resolver 의 A형 LLM 라우팅 발동률 — prep>1s 인 요청의 비율로 근사
#   4) 도구 반복 가드가 turns 를 눌렀는가 — 적용 전 검색질의의 50%가 5턴 소진
#
# 로그 형식(message-pipeline.ts):
#   [ChatTiming] prep=23ms ttfc=5676ms tool=2955ms turns=4 total=27135ms model=...
set -euo pipefail

# 로그 위치는 pm2 의 OMK_LOG_DIR 을 따른다(#650 으로 /tmp 에서 영속 볼륨으로 이전).
# 기본값을 /tmp 로 고정해 두면 이전 이후 매일 "로그 없음" 으로 집계가 조용히 실패한다.
LOG="${1:-${OMK_LOG_DIR:-/tmp}/openmake-llm-out.log}"
[ -f "$LOG" ] || { echo "로그 없음: $LOG"; exit 1; }

echo "로그: $LOG"
# 숫자만 5컬럼(prep ttfc tool turns total)으로 뽑는다.
# ⚠️ `tr -d 'ms'` 를 쓰면 "turns" 의 s 까지 지워져 필드가 깨진다(2026-08-02 실수) — 캡처 그룹으로 추출한다.
grep -a "ChatTiming" "$LOG" \
  | sed 's/.*\[ChatTiming\] //; s/\\n".*//' \
  | sed -nE 's/^prep=([0-9]+)ms ttfc=(-?[0-9]+)ms tool=([0-9]+)ms turns=([0-9]+) total=([0-9]+)ms.*/\1 \2 \3 \4 \5/p' \
  > /tmp/_chat_timing.txt

N=$(wc -l < /tmp/_chat_timing.txt | tr -d ' ')
[ "$N" -gt 0 ] || { echo "표본 없음 — 채팅이 실행된 뒤 다시 시도하세요."; exit 0; }
echo "표본: ${N}건"
echo

# 컬럼: 1=prep 2=ttfc 3=tool 4=turns 5=total
pct() {  # $1=컬럼 $2=라벨
  sort -n -k"$1" /tmp/_chat_timing.txt | awk -v c="$1" -v label="$2" '
    { v[NR]=$c; s+=$c }
    END {
      if (NR==0) exit
      p50=v[int(NR*0.5)+0]; p90=v[int(NR*0.9)+0]
      printf "  %-6s  p50=%-8d p90=%-8d max=%-8d 평균=%d\n", label, p50, p90, v[NR], s/NR
    }'
}

echo "구간별 분포 (ms)"
pct 1 prep
pct 2 ttfc
pct 3 tool
pct 5 total
echo

echo "turns 분포"
awk '{print $4}' /tmp/_chat_timing.txt | sort -n | uniq -c \
  | awk -v n="$N" '{printf "  turns=%-3s %4d건 (%d%%)\n", $2, $1, $1*100/n}'
echo

# ① 병목 판정 — 전체 대비 각 구간 비중
awk -v n="$N" '{p+=$1; t+=$2; o+=$3; tot+=$5}
  END { printf "구간 비중:  prep %.1f%%  |  ttfc %.1f%%  |  tool %.1f%%\n",
        p*100/tot, t*100/tot, o*100/tot }' /tmp/_chat_timing.txt

# ② A형 라우팅 근사 — prep 이 1초를 넘으면 agent-resolver LLM 라우팅이 돈 것으로 본다
#    (키워드 선분류로 스킵되면 수십 ms 다)
awk -v n="$N" '$1>1000 {c++} END { printf "A형 라우팅 발동 추정: %d/%d (%.1f%%)\n", c+0, n, (c+0)*100/n }' \
  /tmp/_chat_timing.txt

# ③ 도구 루프 상한 소진 — 5턴은 MAX_TOOL_TURNS 도달을 뜻한다
awk -v n="$N" '$4>=5 {c++} END { printf "최대 턴(5) 소진: %d/%d (%.1f%%)\n", c+0, n, (c+0)*100/n }' \
  /tmp/_chat_timing.txt

echo
echo "참고: 2026-08-02 기준선(표본 12건) — prep 18~74ms, ttfc p50 약 1.8s(단순)~15s(검색),"
echo "      turns=5 가 검색질의의 50%. 위 수치와 비교해 판정하세요."
