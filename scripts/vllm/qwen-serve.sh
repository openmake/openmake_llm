#!/usr/bin/env bash
# ============================================================
# qwen3.8-27b — 기본 채팅 (262K context) @ :8002
# ============================================================
# ⚠️ 2026-09-02 동기화: DGX :8002 실체가 qwen3.8-27b-fp8(dense, MTP) 로 교체됐고(DGX 측 2026-08-31)
#   `--served-model-name qwen3.8-27b qwen3.6-35b-a3b` 로 구 이름을 호환 alias 로 함께 서빙한다.
#   실행 주체도 바뀜 — PM2 가 아니라 DGX `/home/smith/vllm`(git: openmake/openmake_vllm) 의
#   docker compose (`vllm-chat` 컨테이너, `bin/vllm-launch.sh chat` + `env/chat.env`, 2026-08-20 컷오버).
#   이 파일은 레포 참조본이며 실제 SoT 는 openmake_vllm 의 env/chat.env 다.
# DGX 실측 serve 명령 기준 (2026-08-19 동기화 — --limit-mm-per-prompt image 4→8:
# 채팅 PDF 하이브리드(pdf-vision 페이지 주입, PDF_VISION_TOTAL_IMAGE_CAP=8 페어) 지원.
# 2026-08-02 prefix caching 추가).
#
# --enable-prefix-caching (2026-08-02 추가):
#   앱은 이 기능을 전제로 프롬프트를 배치한다 — external-system-prompt.ts 가 정적 헌법을
#   맨 앞(CACHE PREFIX)에 두는 이유가 그것인데, 서버에서 꺼져 있어 설계 의도가 무효였다.
#   도구 루프 N턴이면 시스템 프롬프트를 N번 재계산하므로 지연에 직결된다.
#   ⚠️ 이 모델은 Mamba 하이브리드(Qwen3_5MoeForConditionalGeneration)라 vLLM 이
#   Mamba cache 'align' 모드로 전환하며 "experimental" 경고를 낸다. 활성화 후에도
#   `Prefix cache hit rate` 지표는 0.0% 로 표시된다(SSM 레이어는 KV 캐시가 없음).
#   앱 실측(표본 4건)은 3건 개선·1건 악화로 유의성 미확보 — [ChatTiming] 로그 축적 후 재판단.
#   문제 시 이 플래그만 제거하면 종전 동작으로 복귀한다.
# 실행 주체: (구) DGX PM2 vllm-chat → (현) docker compose `vllm-chat` — 위 2026-09-02 주석 참고.
# venv: /home/smith/vllm_data/rebuild/vllm_env.0271 (vLLM 0.27.1 — Qwen3.8 dense+MTP 레지스트리 포함)
#
# 보안:
# - API key 는 CLI 인자 금지(ps 노출) — 0600 env 파일의 VLLM_API_KEY 를 vLLM 이 직접 인식
# - 운영은 VLLM_BIND_HOST 에 DGX Tailscale IPv4 주입 (공인망·LAN 비노출).
#   tailscaled 기동 전 부팅 경쟁은 아래 대기 루프로 방어.
set -euo pipefail

MODEL_DIR="${QWEN_MODEL_DIR:-/home/smith/models/qwen3.8-27b-fp8}"

# vLLM API key — env 파일(0600) 주입 (VLLM_API_KEY)
set -a; [ -f /home/smith/vllm/vllm.env ] && . /home/smith/vllm/vllm.env; set +a

VLLM_BIND_HOST="${VLLM_BIND_HOST:-127.0.0.1}"
if [ "$VLLM_BIND_HOST" != "127.0.0.1" ] && [ "$VLLM_BIND_HOST" != "0.0.0.0" ]; then
  for i in $(seq 1 60); do
    ip -4 addr show 2>/dev/null | grep -q "inet ${VLLM_BIND_HOST}/" && break
    echo "[bind-wait] waiting for ${VLLM_BIND_HOST} ($i/60)"; sleep 2
  done
fi

exec vllm serve "$MODEL_DIR" \
  --port 8002 \
  --host "$VLLM_BIND_HOST" \
  --tensor-parallel-size 1 \
  --dtype auto \
  --served-model-name qwen3.8-27b qwen3.6-35b-a3b \
  --max-model-len 262144 \
  --gpu-memory-utilization 0.47 \
  --max-num-batched-tokens 8192 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --limit-mm-per-prompt '{"image": 8}' \
  --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}' \
  --kv-cache-dtype fp8 \
  --enable-prefix-caching \
  --override-generation-config '{"repetition_penalty": 1.05}'
