#!/usr/bin/env bash
# OpenMakeKit 생성 코드 재생성 — SoT: packages/api-contracts (축 1 산출물)
#
#   ./apps/ios/scripts/generate-openmakekit.sh
#
# 산출물(커밋 대상 — 수기 편집 금지):
#   Packages/OpenMakeKit/Sources/OpenMakeKit/Generated/Types.swift     (swift-openapi-generator)
#   Packages/OpenMakeKit/Sources/OpenMakeKit/Generated/WsModels.swift  (quicktype)
#
# Xcode 빌드는 이 스크립트에 비의존 (생성 코드 커밋 방식) — CI 가 재생성 diff 로 drift 검사.
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$IOS_DIR/../.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/api-contracts"
GEN_DIR="$IOS_DIR/Packages/OpenMakeKit/Sources/OpenMakeKit/Generated"

echo "[generate-openmakekit] REST 타입 (swift-openapi-generator)"
swift run --package-path "$IOS_DIR/Tools" swift-openapi-generator generate \
    "$CONTRACTS_DIR/openapi.v1.json" \
    --config "$IOS_DIR/Tools/openapi-generator-config.yaml" \
    --output-directory "$GEN_DIR"
# generate: [types] 모드가 만드는 빈 스텁 제거
rm -f "$GEN_DIR/Client.swift" "$GEN_DIR/Server.swift"

echo "[generate-openmakekit] WS Codable (quicktype)"
# 계약 스키마는 definitions 만 있으므로 quicktype 루트 타입용 wrapper 를 임시 생성
WRAPPER="$(mktemp -t ws-wrapper.XXXXXX).json"
trap 'rm -f "$WRAPPER"' EXIT
node -e "
const fs = require('fs');
const schema = JSON.parse(fs.readFileSync('$CONTRACTS_DIR/events/ws-chat.v1.schema.json', 'utf8'));
const wrapper = {
    \$schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
        request: { \$ref: '#/definitions/WsChatRequest' },
        event: { \$ref: '#/definitions/WsServerEvent' },
    },
    definitions: schema.definitions,
};
fs.writeFileSync('$WRAPPER', JSON.stringify(wrapper, null, 2));
"
# 버전 고정 — quicktype 출력 변화로 CI codegen drift 게이트가 오탐하지 않게
npx --yes quicktype@26.0.0 --src-lang schema --lang swift \
    --src "$WRAPPER" --top-level WsChatEnvelope --access-level public \
    --out "$GEN_DIR/WsModels.swift"

echo "[generate-openmakekit] 완료 → $GEN_DIR"
