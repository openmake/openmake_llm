#!/bin/bash
echo "=== env.ts OLLAMA_MODEL ==="
grep -n -C 10 "OLLAMA_MODEL" backend/api/src/config/env.ts

echo -e "\n=== env.ts ollamaModels ==="
grep -n -C 5 "ollamaModels" backend/api/src/config/env.ts

echo -e "\n=== api-key-manager.test.ts structure ==="
grep -n -E "^\s*(describe|it)\(" backend/api/src/__tests__/api-key-manager.test.ts

echo -e "\n=== api-key-manager.test.ts findKeyIndexForModel ==="
grep -n -A 25 "findKeyIndexForModel" backend/api/src/__tests__/api-key-manager.test.ts

echo -e "\n=== api-key-manager.test.ts findAlternateKeyForModel ==="
grep -n -A 25 "findAlternateKeyForModel" backend/api/src/__tests__/api-key-manager.test.ts

echo -e "\n=== ollama-client.test.ts keys/mocks ==="
grep -n -i -C 5 "key" backend/api/src/__tests__/ollama-client.test.ts
