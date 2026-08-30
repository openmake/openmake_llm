#!/usr/bin/env bash
# ============================================================
# 에이전트 라우팅 경로 분석 — A형 LLM 라우팅의 값어치 판정 (2026-08-02)
# ============================================================
#   bash scripts/analyze-agent-routing.sh [로그경로]
#
# routing-config.ts 가 "유지/제거는 실측으로 결정한다"고 표시한 앞단 LLM 라우팅을
# 운영 로그로 재판정하기 위한 도구다. 임계(OMK_AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE)를
# 0.7 → 0.35 로 낮춘 뒤 효과를 확인하는 데 쓴다.
#
# 볼 지표 셋:
#   1) LLM 라우팅 경로 비율 — 2026-08-02 기준 13%. 임계 조정 후 얼마로 떨어졌는가
#   2) LLM 발동 케이스에서 키워드가 이미 같은 답을 냈는가 — 같으면 순수 낭비(건당 약 2초)
#   3) 여전히 발동하는 케이스가 무매칭(키워드 신뢰도 0.3) 위주인가 — 그렇다면 임계가 제대로 걸린 것
#
# 2026-08-02 기준선(라우팅 106회): 短문장 58% · 키워드 15% · LLM 13% · 캐시 13%.
#   LLM 발동 14건 = 키워드와 동일 5건(낭비) / 개선 4건 / 헛짚음 5건 → 64%가 무익.
set -euo pipefail

# 로그 위치는 pm2 의 OMK_LOG_DIR 을 따른다(#650 으로 /tmp 에서 영속 볼륨으로 이전).
# 기본값을 /tmp 로 고정해 두면 이전 이후 매일 "로그 없음" 으로 집계가 조용히 실패한다.
LOG="${1:-${OMK_LOG_DIR:-/tmp}/openmake-llm-out.log}"
[ -f "$LOG" ] || { echo "로그 없음: $LOG"; exit 1; }
echo "로그: $LOG"

python3 - "$LOG" <<'PY'
import re, sys
from collections import Counter

txt = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
# pm2 JSON 로그의 message 필드만 평문화
lines = []
for m in re.finditer(r'"message":"(.*?)","timestamp"', txt, re.S):
    lines.extend(m.group(1).replace('\\n', '\n').split('\n'))
lines = [re.sub(r'\\u001b\[[0-9;]*m', '', l) for l in lines]

msg_re   = re.compile(r'\[AgentRouter\] 메시지: \\?"(.*?)\.\.\.')
pick_re  = re.compile(r'\[AgentRouter\] 선택: (\S+) \(점수: [\d.]+, 신뢰도: ([\d.]+)\)')
llm_re   = re.compile(r'LLM 라우팅 성공: (\S+) \(신뢰도: ([\d.]+)\)')
kw_re    = re.compile(r'키워드 선분류 채택: (\S+)')
short_re = re.compile(r'短문장 직행: general')
cache_re = re.compile(r'캐시 라우팅 재사용:')
fallb_re = re.compile(r'키워드 폴백 라우팅:')

paths, cases = Counter(), []
cur_msg = cur_pick = None
for l in lines:
    if (m := msg_re.search(l)):  cur_msg = m.group(1); continue
    if (p := pick_re.search(l)): cur_pick = (p.group(1), float(p.group(2))); continue
    if kw_re.search(l):    paths['키워드 선분류'] += 1; continue
    if short_re.search(l): paths['短문장 직행'] += 1; continue
    if cache_re.search(l): paths['캐시'] += 1; continue
    if fallb_re.search(l): paths['키워드 폴백'] += 1; continue
    if (g := llm_re.search(l)):
        paths['LLM 라우팅'] += 1
        cases.append({'msg': cur_msg, 'kw': cur_pick[0] if cur_pick else None,
                      'conf': cur_pick[1] if cur_pick else None, 'llm': g.group(1)})

tot = sum(paths.values())
if tot == 0:
    print('라우팅 로그 없음 — 채팅이 실행된 뒤 다시 시도하세요.'); raise SystemExit

print(f'\n라우팅 총 {tot}회')
for k, v in paths.most_common():
    print(f'  {k:<12} {v:>4}회 ({v*100//tot}%)')

n = len(cases)
print(f'\nLLM 라우팅 발동 {n}건', end='')
if n == 0:
    print(' — 임계 조정이 완전히 걸렸다(또는 표본 부족).'); raise SystemExit
same = sum(1 for c in cases if c['kw'] == c['llm'])
nomatch = sum(1 for c in cases if (c['conf'] or 0) <= 0.3)
print(f' | 키워드와 같은 답 {same}건({same*100//n}%, 순수 낭비) | 무매칭(≤0.3)에서 발동 {nomatch}건({nomatch*100//n}%)')
print('\n케이스 (= 키워드와 동일 / ≠ 다름):')
for c in cases[-20:]:
    mark = '=' if c['kw'] == c['llm'] else '≠'
    print(f"  {mark} kw={str(c['kw'])[:22]:<22}({c['conf']}) → llm={str(c['llm'])[:22]:<22} | {str(c['msg'])[:36]}")
print('\n판정 기준: "같은 답" 비율이 높으면 임계를 더 낮출 여지, 무매칭 비율이 높으면 임계가 제대로 걸린 것.')
PY
