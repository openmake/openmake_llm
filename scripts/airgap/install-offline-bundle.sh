#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — 폐쇄망(에어갭) 호스트에서 오프라인 번들 설치
#
# scripts/airgap/build-offline-bundle.sh 로 만든 번들 디렉터리를 이 호스트로 옮긴 뒤 실행한다.
#
# 사용법:
#   ./install-offline-bundle.sh <번들디렉터리> [--dest DIR] [--dry-run]
#
#   --dest DIR   설치 대상 디렉터리 (기본: ./openmake_llm, 즉 현재 위치 기준 신규 디렉터리)
#   --dry-run    MANIFEST 체크섬만 검증하고 실제 추출/로드는 하지 않음
#
# 수행 단계:
#   1) MANIFEST.txt 의 sha256 체크섬으로 번들 무결성 검증
#   2) 레포 소스를 --dest 에 추출
#   3) node_modules 를 --dest 위에 겹쳐 추출 (OS/arch 가 번들을 만든 머신과 같아야 함 — 전제조건 참고)
#   4) docker 이미지 로드 (docker load)
#   5) 빌드 산출물(build-artifacts.tar.gz)이 있으면 --dest 위에 겹쳐 추출
#
# 이 스크립트는 여기서 끝난다 — pm2 기동·DB 마이그레이션·.env 작성은 하지 않는다
# (운영 영향이 있는 단계라 운영자가 직접 판단해서 실행해야 함). 완료 후 안내 문구 참고.
#
# 전제조건: docker, tar, sha256sum(또는 shasum) 이 이 호스트에 이미 설치돼 있어야 한다
#   (에어갭이라 이 스크립트가 설치해주지 않는다). Node/npm/pm2 도 마찬가지.
# ==============================================================================
set -euo pipefail

log_info() { printf "[INFO]  %s\n" "$*"; }
log_ok()   { printf "[OK]    %s\n" "$*"; }
log_warn() { printf "[WARN]  %s\n" "$*"; }
log_err()  { printf "[ERR]   %s\n" "$*" >&2; }

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

BUNDLE_DIR=""
DEST_DIR="./openmake_llm"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dest) DEST_DIR="${2:?--dest 뒤에 경로가 필요합니다}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *)
            [[ -n "$BUNDLE_DIR" ]] && { log_err "번들 디렉터리 인자가 두 번 지정됨"; exit 1; }
            BUNDLE_DIR="$1"; shift ;;
    esac
done

[[ -n "$BUNDLE_DIR" && -d "$BUNDLE_DIR" ]] || { log_err "사용법: $0 <번들디렉터리> [--dest DIR] [--dry-run]"; exit 1; }
[[ -f "$BUNDLE_DIR/MANIFEST.txt" ]] || { log_err "MANIFEST.txt 없음 — 올바른 번들 디렉터리인지 확인: $BUNDLE_DIR"; exit 1; }

log_info "번들: $BUNDLE_DIR"
cat "$BUNDLE_DIR/MANIFEST.txt" | sed -n '1,7p'

# 1) 무결성 검증
log_info "1/5 체크섬 검증"
verify_failed=0
while IFS= read -r line; do
    # MANIFEST 형식: "  <sha256>  <파일명>  (<크기>)"
    sum="$(awk '{print $1}' <<<"$line")"
    fname="$(awk '{print $2}' <<<"$line")"
    [[ -n "$sum" && -n "$fname" && -f "$BUNDLE_DIR/$fname" ]] || continue
    actual="$(sha256 "$BUNDLE_DIR/$fname")"
    if [[ "$actual" != "$sum" ]]; then
        log_err "체크섬 불일치: $fname (기대: $sum, 실제: $actual)"
        verify_failed=1
    else
        log_ok "체크섬 일치: $fname"
    fi
done < <(grep -E '^\s+[0-9a-f]{64}\s+' "$BUNDLE_DIR/MANIFEST.txt")

if [[ "$verify_failed" -eq 1 ]]; then
    log_err "무결성 검증 실패 — 번들이 손상되었을 수 있습니다. 재전송 필요."
    exit 2
fi
log_ok "모든 파일 체크섬 일치"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] 검증만 수행 — 추출/로드 없음 (대상: $DEST_DIR)"
    exit 0
fi

[[ -e "$DEST_DIR" ]] && { log_err "설치 대상이 이미 존재합니다: $DEST_DIR (다른 --dest 지정 또는 기존 디렉터리 정리 후 재시도)"; exit 1; }
mkdir -p "$DEST_DIR"
DEST_DIR="$(cd "$DEST_DIR" && pwd)"

# 2) 레포 소스
log_info "2/5 레포 소스 추출 → $DEST_DIR"
tar -xzf "$BUNDLE_DIR/openmake_llm-src.tar.gz" -C "$DEST_DIR"
log_ok "소스 추출 완료"

# 3) node_modules (있으면)
if [[ -f "$BUNDLE_DIR/node_modules.tar.gz" ]]; then
    log_info "3/5 node_modules 추출 (⚠ 이 호스트의 OS/아키텍처가 번들을 만든 머신과 다르면 네이티브 애드온이 깨질 수 있습니다)"
    tar -xzf "$BUNDLE_DIR/node_modules.tar.gz" -C "$DEST_DIR"
    log_ok "node_modules 추출 완료"
else
    log_warn "node_modules.tar.gz 없음 — 설치 후 npm install 을 직접 실행해야 합니다(에어갭이면 로컬 캐시/미러 필요)"
fi

# 4) docker 이미지 로드
if [[ -f "$BUNDLE_DIR/docker-images.tar" ]]; then
    log_info "4/5 docker 이미지 로드"
    command -v docker >/dev/null 2>&1 || { log_err "docker 미설치 — 먼저 설치하세요"; exit 1; }
    docker load -i "$BUNDLE_DIR/docker-images.tar"
    log_ok "docker 이미지 로드 완료"
else
    log_warn "docker-images.tar 없음 — DB/Redis 컨테이너를 별도로 준비해야 합니다"
fi

# 5) 빌드 산출물 (있으면)
if [[ -f "$BUNDLE_DIR/build-artifacts.tar.gz" ]]; then
    log_info "5/5 빌드 산출물 추출"
    tar -xzf "$BUNDLE_DIR/build-artifacts.tar.gz" -C "$DEST_DIR"
    log_ok "빌드 산출물 추출 완료 — npm run build 생략 가능"
else
    log_warn "빌드 산출물 없음 — 설치 후 'npm run build' 필요(devDependencies 포함 node_modules 필수)"
fi

cat <<EOF

[OK]    오프라인 번들 설치 완료: $DEST_DIR

남은 수동 단계 (운영 영향이 있어 이 스크립트가 대신 실행하지 않습니다):
  1) cd $DEST_DIR && cp .env.example .env  →  DATABASE_URL 등 필수값 채우기
  2) infra/docker-compose.yml 로 PostgreSQL/Redis 기동
       docker compose --env-file .env -f infra/docker-compose.yml up -d
  3) (node_modules/build-artifacts 를 안 옮겼다면) npm install && npm run build
  4) DB 마이그레이션 + PM2 기동
       ./openmake_llm.sh migrate && ./openmake_llm.sh start
  5) ./openmake_llm.sh health 로 확인
EOF
