#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — 폐쇄망(에어갭) 설치용 오프라인 번들 생성
#
# 인터넷이 없는 호스트에 이 레포를 설치하기 위해 필요한 것들을 한 디렉터리로 묶는다:
#   1) 레포 소스 아카이브    (git archive HEAD — .git 제외)
#   2) node_modules 캐시    (루트 + 각 workspace, npm workspaces hoist 구조 그대로)
#   3) docker 이미지        (infra/docker-compose.yml 의 image: 목록 — 기본 postgres:16, redis:7-alpine)
#   4) (있으면) 빌드 산출물  apps/api/dist, apps/web/.next — 대상 호스트가 devDependencies
#                            없이도 바로 기동할 수 있게 함
#   5) MANIFEST.txt         커밋 SHA·Node/npm 버전·각 파일 sha256·크기
#
# 사용법:
#   ./scripts/airgap/build-offline-bundle.sh              # 번들 생성
#   ./scripts/airgap/build-offline-bundle.sh --dry-run    # 예상 용량·구성만 출력, 실제 아카이브 없음
#
# 환경변수:
#   AIRGAP_BUNDLE_DIR    번들 출력 디렉터리 (기본: <repo>/.airgap-bundle)
#   AIRGAP_EXTRA_IMAGES  compose 목록 외 추가로 save 할 docker 이미지(공백 구분, 선택)
#
# ⚠ 전제조건 (중요 — 무작정 다른 호스트에 풀면 실패한다):
#   - node_modules 에는 네이티브 애드온(sharp, better-sqlite3 계열 등)이 포함될 수 있어
#     **번들을 만든 머신과 대상 호스트의 OS/아키텍처가 반드시 같아야 한다**
#     (예: macOS arm64 에서 만든 번들은 Linux x86_64 대상 호스트에서 재설치 없이 동작하지 않는다).
#     아키텍처가 다르면 대상과 동일한 OS/arch 의 빌드 머신(또는 동일 플랫폼 컨테이너)에서
#     이 스크립트를 실행해야 한다.
#   - 대상 호스트에도 이 번들을 만든 것과 같은 Node 메이저 버전 런타임이 필요하다
#     (MANIFEST.txt 에 기록됨). devDependencies 컴파일러(tsc 등)는 4)의 사전 빌드 산출물이
#     있으면 필요 없다 — 없으면 대상에서 `npm run build` 를 실행할 능력(Node+npm)이 있어야 한다.
#   - PostgreSQL/Redis 데이터(db/init, 실제 DB 내용)는 이 번들에 포함되지 않는다 — 별도로
#     scripts/backups/db-backup.sh 산출물을 옮길 것.
#   - 예상 용량: node_modules 는 보통 1~3GB, docker 이미지(postgres+redis) 는 300~400MB,
#     빌드 산출물(.next 포함)은 수백 MB. 전체 번들은 통상 2~5GB — 대상 반출 매체 용량을 확인할 것.
#
# 대상 호스트 설치: scripts/airgap/install-offline-bundle.sh 참고.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly REPO_ROOT

log_info() { printf "[INFO]  %s\n" "$*"; }
log_ok()   { printf "[OK]    %s\n" "$*"; }
log_warn() { printf "[WARN]  %s\n" "$*"; }
log_err()  { printf "[ERR]   %s\n" "$*" >&2; }

DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help)
            sed -n '2,33p' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        *) log_err "알 수 없는 옵션: $arg (지원: --dry-run)"; exit 1 ;;
    esac
done

for cmd in git tar docker node npm sha256sum; do
    # macOS 에는 sha256sum 이 기본 없고 shasum -a 256 이 있다 — 아래에서 폴백 처리.
    if [[ "$cmd" == "sha256sum" ]]; then continue; fi
    command -v "$cmd" >/dev/null 2>&1 || { log_err "필수 명령 미설치: $cmd"; exit 1; }
done
sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

BUNDLE_ROOT="${AIRGAP_BUNDLE_DIR:-$REPO_ROOT/.airgap-bundle}"
SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
TS="$(date +%Y%m%d)"
OUT_DIR="$BUNDLE_ROOT/openmake-llm-airgap-${TS}-${SHA}"

# infra/docker-compose.yml 에서 image: 목록을 뽑는다 (하드코딩 대신 compose 파일이 SoT).
list_compose_images() {
    # \s 는 BSD sed(macOS 기본)에 없다 — POSIX [[:space:]] 로 크로스플랫폼 대응.
    grep -E '^[[:space:]]*image:[[:space:]]*' "$REPO_ROOT/infra/docker-compose.yml" \
        | sed -E 's/^[[:space:]]*image:[[:space:]]*//' | tr -d '"'"'"''
}
IMAGES="$(list_compose_images)"
[[ -n "${AIRGAP_EXTRA_IMAGES:-}" ]] && IMAGES="$IMAGES $AIRGAP_EXTRA_IMAGES"

log_info "레포: $REPO_ROOT (HEAD=$SHA)"
log_info "docker 이미지: $(echo "$IMAGES" | tr '\n' ' ')"
log_info "출력 디렉터리: $OUT_DIR"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] 예상 구성:"
    echo "  - repo/openmake_llm-src.tar.gz   (git archive HEAD)"
    du_src="$(du -sh "$REPO_ROOT" 2>/dev/null | cut -f1)"
    echo "      참고: 작업 트리 전체 크기(node_modules 포함) = ${du_src:-?} — 소스만은 이보다 훨씬 작음"
    for nm in "$REPO_ROOT/node_modules" "$REPO_ROOT"/apps/*/node_modules "$REPO_ROOT"/packages/*/node_modules; do
        [[ -d "$nm" ]] || continue
        echo "  - node_modules.tar.gz 포함 대상: $nm ($(du -sh "$nm" 2>/dev/null | cut -f1))"
    done
    for img in $IMAGES; do
        size="$(docker image inspect "$img" --format '{{.Size}}' 2>/dev/null || echo '?')"
        echo "  - docker-images.tar 포함: $img (${size} bytes, 로컬에 없으면 사전에 docker pull 필요)"
    done
    for d in apps/api/dist apps/web/.next; do
        [[ -d "$REPO_ROOT/$d" ]] && echo "  - build-artifacts.tar.gz 포함: $d ($(du -sh "$REPO_ROOT/$d" 2>/dev/null | cut -f1))" \
            || echo "  - build-artifacts: $d 없음 (대상 호스트에서 npm run build 필요)"
    done
    log_ok "[dry-run] 완료 — 실제 아카이브 생성 없음"
    exit 0
fi

mkdir -p "$OUT_DIR"

# 1) 레포 소스 (git archive — .gitignore/.git 제외한 추적 파일만)
log_info "1/5 레포 소스 아카이브 생성"
git -C "$REPO_ROOT" archive --format=tar.gz -o "$OUT_DIR/openmake_llm-src.tar.gz" HEAD
log_ok "소스 아카이브 완료"

# 2) node_modules (루트 + workspace 별) — npm workspaces hoist 구조를 그대로 보존해야
#    설치 후 require 해석이 어긋나지 않는다.
log_info "2/5 node_modules 아카이브 생성 (시간이 걸릴 수 있음)"
NM_TARGETS=()
[[ -d "$REPO_ROOT/node_modules" ]] && NM_TARGETS+=("node_modules")
while IFS= read -r -d '' d; do
    rel="${d#"$REPO_ROOT"/}"
    NM_TARGETS+=("$rel")
done < <(find "$REPO_ROOT/apps" "$REPO_ROOT/packages" -maxdepth 2 -type d -name node_modules -print0 2>/dev/null)
if [[ "${#NM_TARGETS[@]}" -eq 0 ]]; then
    log_warn "node_modules 없음 — 'npm install' 먼저 실행 후 다시 만드세요"
else
    ( cd "$REPO_ROOT" && tar -czf "$OUT_DIR/node_modules.tar.gz" "${NM_TARGETS[@]}" )
    log_ok "node_modules 아카이브 완료 (${#NM_TARGETS[@]}개 디렉터리)"
fi

# 3) docker 이미지 (compose 목록 기준)
log_info "3/5 docker 이미지 저장"
missing=()
for img in $IMAGES; do
    docker image inspect "$img" >/dev/null 2>&1 || missing+=("$img")
done
if [[ "${#missing[@]}" -gt 0 ]]; then
    log_err "로컬에 없는 이미지: ${missing[*]} — 인터넷 되는 곳에서 'docker pull' 후 재실행하세요"
    exit 2
fi
# shellcheck disable=SC2086  # $IMAGES 는 공백 구분 이미지 목록 — 단어 분할 의도됨
docker save $IMAGES -o "$OUT_DIR/docker-images.tar"
log_ok "docker 이미지 저장 완료"

# 4) 빌드 산출물 (있으면 — 대상 호스트가 devDependencies 없이 바로 기동 가능하게)
log_info "4/5 빌드 산출물 포함 여부 확인"
BUILD_TARGETS=()
[[ -d "$REPO_ROOT/apps/api/dist" ]] && BUILD_TARGETS+=("apps/api/dist")
[[ -d "$REPO_ROOT/apps/web/.next" ]] && BUILD_TARGETS+=("apps/web/.next")
if [[ "${#BUILD_TARGETS[@]}" -gt 0 ]]; then
    ( cd "$REPO_ROOT" && tar -czf "$OUT_DIR/build-artifacts.tar.gz" "${BUILD_TARGETS[@]}" )
    log_ok "빌드 산출물 포함 (${BUILD_TARGETS[*]})"
else
    log_warn "빌드 산출물 없음 — 대상 호스트에서 'npm run build' 필요(devDependencies 포함 node_modules 필수)"
fi

# 5) MANIFEST.txt — 체크섬 + 버전 정보
log_info "5/5 MANIFEST 작성"
{
    echo "OpenMake LLM 오프라인 번들"
    echo "생성일: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "git HEAD: $(git -C "$REPO_ROOT" rev-parse HEAD)"
    echo "node: $(node --version)"
    echo "npm: $(npm --version)"
    echo "platform: $(uname -s)-$(uname -m)"
    echo "docker images: $IMAGES"
    echo ""
    echo "파일 체크섬 (sha256):"
    for f in "$OUT_DIR"/*.tar.gz "$OUT_DIR"/*.tar; do
        [[ -f "$f" ]] || continue
        echo "  $(sha256 "$f")  $(basename "$f")  ($(du -h "$f" | cut -f1))"
    done
} > "$OUT_DIR/MANIFEST.txt"

log_ok "번들 생성 완료: $OUT_DIR"
log_info "전체 용량: $(du -sh "$OUT_DIR" | cut -f1)"
log_info "대상 호스트 설치: scripts/airgap/install-offline-bundle.sh $OUT_DIR"
