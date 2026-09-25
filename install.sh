#!/usr/bin/env bash
# ==============================================================================
# OpenMake LLM — 설치 입구 (OS 판별 후 OS 전용 인스톨러로 넘긴다)
# ==============================================================================
# 설치 로직은 OS 별로 완전히 분리돼 있다. 이 파일은 OS 만 판별해 넘긴다:
#
#   macOS          → install_mac.sh
#   Linux / WSL2   → install_linux.sh
#   Windows 네이티브 → install_linux.sh (WSL2 설치 절차를 안내하고 종료)
#
# 사용 (모든 인자는 OS 인스톨러에 그대로 전달된다 — 옵션은 각 인스톨러의 --help):
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes
#   ./install.sh [옵션]
#
# 레포 밖(curl 파이프)에서 실행되면 OS 인스톨러를 레포에서 내려받아 실행한다.
#   OMK_REF        브랜치/태그 (기본 main) — 병합 전 브랜치 검증에 쓴다
#   OMK_REPO_URL   GitHub 레포 주소 (기본 https://github.com/openmake/openmake_llm.git)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
readonly SCRIPT_DIR
readonly DEFAULT_REPO_URL="https://github.com/openmake/openmake_llm.git"

case "$(uname -s)" in
    Darwin) target="install_mac.sh" ;;
    *)      target="install_linux.sh" ;;
esac

# 클론된 레포 안 — 같은 디렉터리의 OS 인스톨러로 넘긴다.
if [[ -f "$SCRIPT_DIR/$target" ]]; then
    exec bash "$SCRIPT_DIR/$target" "$@"
fi

# 레포 밖(curl 파이프·단독 다운로드) — OS 인스톨러를 받아 실행한다.
# 파이프로 bash 에 넘기지 않고 임시 파일로 받는다: 인스톨러가 stdin 을 쓰는 명령을 실행해도
# 스크립트 본문이 먹히지 않고, 인스톨러의 부트스트랩이 레포를 받은 뒤 그 안의 사본으로 재진입한다.
repo_url="${OMK_REPO_URL:-$DEFAULT_REPO_URL}"
ref="${OMK_REF:-main}"
if [[ ! "${repo_url%.git}" =~ ^https://github\.com/([^/]+/[^/]+)$ ]]; then
    echo "[ERR]   OMK_REPO_URL 이 GitHub 주소가 아닙니다: $repo_url — 레포를 직접 클론한 뒤 ./$target 을 실행하세요." >&2
    exit 1
fi
slug="${BASH_REMATCH[1]}"
url="https://raw.githubusercontent.com/$slug/$ref/$target"

command -v curl >/dev/null 2>&1 || { echo "[ERR]   curl 이 필요합니다." >&2; exit 1; }
tmp="$(mktemp -d)/$target"
echo "[INFO]  $target 다운로드: $url"
curl -fsSL "$url" -o "$tmp" || { echo "[ERR]   다운로드 실패: $url" >&2; exit 1; }
exec bash "$tmp" "$@"
