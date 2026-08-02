#!/usr/bin/env bash
# ============================================================
# 재부팅 드릴 검증 (2026-08-01) — 부팅 복구 경로 실증
# ============================================================
# 재부팅 후 이 스크립트를 실행하면 합격/불합격이 한 화면에 나온다.
#   bash /Volumes/MAC_APP/openmake_llm/reboot-drill-verify.sh
#
# 합격 기준:
#   1) com.PM2 LaunchDaemon 이 running (로그인 없이 부팅 단계 복구)
#   2) PM2 앱 4종 online (litellm·openmake-llm·openmake-next·openmake-discord)
#      + 스케줄 2종(gateway-probe·db-backup)은 stopped 가 정상(cron_restart 대기)
#   3) LiteLLM 게이트웨이 liveliness 200
#   4) 앱 API 200
#   5) 게이트웨이→DGX 실추론 200 (Tailscale 경로까지 복구)
set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── 재부팅 드릴 검증 ($(date '+%F %T')) ──"
echo "[가동 시간] $(uptime | sed -E 's/.*up ([^,]+),.*/\1/')"

echo "[1] com.PM2 LaunchDaemon"
# 데몬은 부팅 시 resurrect 를 1회 실행하고 종료한다(one-shot) — "state = running" 은
# 순간에만 참이라 오판(2026-08-01 실드릴에서 확인). 판정은 ① plist 등록 + ② 이번 부팅
# 이후 실행 흔적(/tmp/com.PM2.out 이 부팅 시각 이후 갱신)으로 한다.
BOOT_EPOCH=$(sysctl -n kern.boottime | sed -E 's/.*sec = ([0-9]+).*/\1/')
OUT_EPOCH=$(stat -f %m /tmp/com.PM2.out 2>/dev/null || echo 0)
if [ ! -f /Library/LaunchDaemons/com.PM2.plist ]; then
  bad "LaunchDaemon plist 없음 (/Library/LaunchDaemons/com.PM2.plist)"
elif [ "$OUT_EPOCH" -ge "$BOOT_EPOCH" ]; then
  ok "LaunchDaemon 부팅 실행 확인 (resurrect 로그가 부팅 이후 갱신)"
else
  bad "LaunchDaemon 이번 부팅에 실행 흔적 없음 — /tmp/com.PM2.out 미갱신"
fi

echo "[2] PM2 프로세스"
for app in litellm openmake-llm openmake-next openmake-discord; do
  if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$app\",\"pm2_env\":{[^}]*\"status\":\"online\"" \
     || pm2 describe "$app" 2>/dev/null | grep -q "online"; then
    ok "$app online"
  else
    bad "$app 미가동"
  fi
done
for app in gateway-probe db-backup; do
  pm2 describe "$app" >/dev/null 2>&1 && ok "$app 등록됨(스케줄 대기)" || bad "$app 미등록"
done

echo "[3] LiteLLM 게이트웨이"
[ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:13401/health/liveliness)" = "200" ] \
  && ok "liveliness 200" || bad "게이트웨이 응답 없음"

echo "[4] 앱 API"
[ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:52416/api/models)" = "200" ] \
  && ok "GET /api/models 200" || bad "앱 API 응답 없음"

echo "[5] 게이트웨이→DGX 실추론 (Tailscale)"
KEY="$(grep '^LITELLM_MASTER_KEY=' /Volumes/MAC_APP/litellm/litellm.env | cut -d= -f2-)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 60 http://127.0.0.1:13401/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.6-35b-a3b","messages":[{"role":"user","content":"1"}],"max_tokens":1,"chat_template_kwargs":{"enable_thinking":false}}')
[ "$CODE" = "200" ] && ok "로컬 모델 실추론 200" || bad "실추론 실패 (HTTP $CODE)"

echo
echo "── 결과: 통과 $PASS / 실패 $FAIL ──"
[ "$FAIL" -eq 0 ] && echo "🎉 재부팅 드릴 합격 — 부팅 복구 경로 실증 완료" \
  || echo "⚠️  실패 항목 확인 필요. 수동 복구: pm2 resurrect"
