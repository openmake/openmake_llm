#!/usr/bin/env bash
# ============================================================
# qwen3.6-35b-a3b-1m — 대용량 context (1M, YARN rope) @ :8004
# ============================================================
# 운영 서버(rockyhan) 실측 serve 명령 기준 (2026-05-29 동기화).
# qwen-serve.sh 와 동일 fp8 가중치를 1M context 로 서빙 (262K → 4x YARN 확장).
# venv: /home/smith/vllm/rebuild/vllm_env
# ModelPool 의 large(1M) 라우팅 대상 — 선택적 인스턴스.
set -euo pipefail

MODEL_DIR="${QWEN_MODEL_DIR:-/home/smith/models/qwen3.6-35b-a3b-fp8}"

exec vllm serve "$MODEL_DIR" \
  --port 8004 \
  --host 127.0.0.1 \
  --served-model-name qwen3.6-35b-a3b-1m \
  --tensor-parallel-size 1 \
  --dtype auto \
  --max-model-len 1048576 \
  --gpu-memory-utilization 0.45 \
  --max-num-seqs 1 \
  --max-num-batched-tokens 8192 \
  --generation-config vllm \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --language-model-only \
  --kv-cache-dtype fp8 \
  --hf-overrides '{"text_config":{"rope_parameters":{"mrope_interleaved":true,"mrope_section":[11,11,10],"rope_type":"yarn","rope_theta":10000000,"partial_rotary_factor":0.25,"factor":4.0,"original_max_position_embeddings":262144}}}' \
  --api-key "${VLLM_API_KEY:-sk-vllm}"
