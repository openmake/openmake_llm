# shellcheck shell=bash
# 컴패니언 앱에 동봉할 node 판별·준비 — build.sh 가 source 하고 node-bundle.test.mjs 가 검증한다.
# 자기완결 검사 — otool -L 첫 줄(파일 경로)을 빼고 /usr/lib/·/System/ 밖 라이브러리가 있으면 다른 Mac 에서 dyld 오류로 죽는다.
node_is_self_contained() {
  local libs
  libs="$(otool -L "$1" | tail -n +2)" || return 1
  ! printf '%s\n' "$libs" | awk 'NF { print $1 }' | grep -qvE '^(/usr/lib/|/System/)'
}
# 공식 배포본 받기 — Homebrew node 는 libnode·libuv 동적 링크본이라 앱에 넣을 수 없다(2026-11-04 운영 Mac 재현).
fetch_official_node() {
  local ver="$1" arch dir tmp name base
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) echo "지원하지 않는 아키텍처: $(uname -m)" >&2; return 1 ;;
  esac
  dir="$HOME/Library/Caches/openmake-companion-node/v$ver-$arch"
  if [[ ! -x "$dir/node" ]]; then
    name="node-v$ver-darwin-$arch"
    base="https://nodejs.org/dist/v$ver"
    tmp="$(mktemp -d)" || return 1
    curl -fsSL -o "$tmp/$name.tar.gz" "$base/$name.tar.gz" || return 1
    curl -fsSL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt" || return 1
    (cd "$tmp" && grep "  $name.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c -) >/dev/null \
      || { echo "node 배포본 sha256 검증 실패: $name.tar.gz" >&2; return 1; }
    tar -xzf "$tmp/$name.tar.gz" -C "$tmp" "$name/bin/node" || return 1
    mkdir -p "$dir" && mv "$tmp/$name/bin/node" "$dir/node" || return 1
    rm -rf "$tmp"
  fi
  echo "$dir/node"
}
