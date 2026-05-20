#!/usr/bin/env bash
set -euo pipefail
PLUGIN_PATH="$(cd "$(dirname "$0")/../vllm-plugins" && pwd)/exaone_tool_parser.py"
exec vllm serve LGAI-EXAONE/EXAONE-4.5-33B-AWQ \
  --port 8002 \
  --api-key "${VLLM_API_KEY:-sk-vllm}" \
  --enable-auto-tool-choice \
  --tool-call-parser-plugin "$PLUGIN_PATH" \
  --tool-call-parser exaone_xml \
  --max-model-len 32768
