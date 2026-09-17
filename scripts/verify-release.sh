#!/usr/bin/env bash
# ============================================================
# 릴리스 공급망 검증 (F28.8) — release-please.yml 의 sbom-attest job 이 올린 자산을 확인한다.
#
#   scripts/verify-release.sh v1.69.0
#
# 1) 릴리스 자산(소스 아카이브 + CycloneDX SBOM)을 내려받고
# 2) gh attestation verify 로 이 저장소 워크플로가 서명한 빌드 출처·SBOM 증명인지 확인한다(Sigstore).
# 필요: gh CLI 로그인. 증명이 없거나 다른 저장소·워크플로가 서명했으면 exit 1.
# ============================================================
set -euo pipefail

TAG="${1:?사용법: scripts/verify-release.sh vX.Y.Z}"
REPO="${VERIFY_REPO:-openmake/openmake_llm}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gh release download "$TAG" --repo "$REPO" --dir "$WORK" --pattern "openmake_llm-${TAG}.tar.gz" --pattern "sbom-${TAG}.cdx.json"

echo "── 빌드 출처(provenance) ──"
gh attestation verify "$WORK/openmake_llm-${TAG}.tar.gz" --repo "$REPO" \
    --signer-workflow "${REPO}/.github/workflows/release-please.yml"

echo "── SBOM 증명 ──"
gh attestation verify "$WORK/openmake_llm-${TAG}.tar.gz" --repo "$REPO" \
    --predicate-type "https://cyclonedx.org/bom" \
    --signer-workflow "${REPO}/.github/workflows/release-please.yml"

echo "── SBOM 요약 ──"
node -e 'const b=require(process.argv[1]); console.log(`CycloneDX ${b.specVersion} · 구성요소 ${b.components?.length ?? 0}개 · ${b.metadata?.component?.name}@${b.metadata?.component?.version}`)' "$WORK/sbom-${TAG}.cdx.json"
echo "검증 완료: $TAG"
