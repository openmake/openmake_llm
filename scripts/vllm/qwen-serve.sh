#!/usr/bin/env bash
# ============================================================
# qwen3.6-35b-a3b — 기본 채팅 (262K context) @ :8002
# ============================================================
# 운영 서버(rockyhan) 실측 serve 명령 기준 (2026-05-29 동기화).
# venv: /home/smith/vllm/rebuild/vllm_env (qwen3.6 지원 rebuild)
# 가중치: 로컬 fp8 모델 디렉토리.
set -euo pipefail

MODEL_DIR="${QWEN_MODEL_DIR:-/home/smith/models/qwen3.6-35b-a3b-fp8}"

exec vllm serve "$MODEL_DIR" \
  --port 8002 \
  --host 127.0.0.1 \
  --served-model-name qwen3.6-35b-a3b \
  --tensor-parallel-size 1 \
  --dtype auto \
  --max-model-len 262144 \
  --gpu-memory-utilization 0.42 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --language-model-only \
  --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}' \
  --kv-cache-dtype fp8 \
  --api-key "${VLLM_API_KEY:-sk-vllm}"
