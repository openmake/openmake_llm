#!/usr/bin/env bash
# install_linux.sh 설치 보강 테스트(2026-11-08 점검 후속) — Node 배포본 체크섬 확인과 Redis 주소 포트 갱신.
# 설치기 전체를 돌리지 않고 함수만 꺼내 가짜 curl·임시 HOME 으로 실행한다(네트워크·실제 설치 없음).
#   bash scripts/setup/linux-install-verify.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }

FN="$TMP/fns.sh"
sed -n '/^install_node_tarball() {/,/^}/p; /^update_env_port() {/,/^}/p' "$HERE/../../install_linux.sh" > "$FN"

# ── 가짜 배포본: node-v<ver>-linux-<arch>/bin/node ──
VER=24.0.0; PLAT=linux-x64; NAME="node-v$VER-$PLAT"
mkdir -p "$TMP/dist/$NAME/bin"
printf '#!/bin/sh\necho v%s\n' "$VER" > "$TMP/dist/$NAME/bin/node"; chmod +x "$TMP/dist/$NAME/bin/node"
tar -czf "$TMP/dist/$NAME.tar.gz" -C "$TMP/dist" "$NAME"
if command -v sha256sum >/dev/null 2>&1; then SUM="$(sha256sum "$TMP/dist/$NAME.tar.gz" | cut -d' ' -f1)"
else SUM="$(shasum -a 256 "$TMP/dist/$NAME.tar.gz" | cut -d' ' -f1)"; fi
printf '%s  %s\n%s  %s\n' "0000000000000000000000000000000000000000000000000000000000000000" "node-v$VER-darwin-arm64.tar.gz" "$SUM" "$NAME.tar.gz" > "$TMP/dist/SHASUMS256.good"
printf '%s  %s\n' "1111111111111111111111111111111111111111111111111111111111111111" "$NAME.tar.gz" > "$TMP/dist/SHASUMS256.bad"

# curl 대역: `-o 파일 URL` 이면 파일로, 아니면 표준 출력으로 내보낸다. SHASUMS 는 FAKE_SUMS 를 준다.
BIN="$TMP/bin"; mkdir -p "$BIN"
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
out="" url=""
while [[ $# -gt 0 ]]; do
    case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
done
case "$url" in *SHASUMS256.txt) src="$FAKE_SUMS" ;; *) src="$FAKE_TARBALL" ;; esac
if [[ -n "$out" ]]; then cp "$src" "$out"; else cat "$src"; fi
EOF
chmod +x "$BIN/curl"

run_install() { # $1=SHASUMS 파일 → 출력, 종료 코드는 마지막 줄 rc=
    (
        export PATH="$BIN:$PATH" FAKE_TARBALL="$TMP/dist/$NAME.tar.gz" FAKE_SUMS="$1"
        HOME="$TMP/home-$(basename "$1")"; mkdir -p "$HOME"
        # shellcheck disable=SC2034  # 아래에서 source 하는 함수들이 읽는다
        NODE_PINNED_VERSION="$VER" ARCH=x64
        log_info() { :; }; persist_path() { :; }
        has() { command -v "$1" >/dev/null 2>&1; }
        die() { echo "die: $*"; exit 2; }
        node_is_pinned() { [[ -x "$HOME/.openmake/node/bin/node" ]]; }
        # shellcheck source=/dev/null
        source "$FN"
        install_node_tarball
        echo "node=$([[ -x "$HOME/.openmake/node/bin/node" ]] && echo yes || echo no)"
    ) 2>&1
    echo "rc=$?"
}

out="$(run_install "$TMP/dist/SHASUMS256.good")"
eq "체크섬 일치: 설치됨" "$(grep -c '^node=yes$' <<<"$out")" "1"
eq "체크섬 일치: 종료 0" "$(tail -1 <<<"$out")" "rc=0"

out="$(run_install "$TMP/dist/SHASUMS256.bad")"
eq "체크섬 불일치: 중단" "$(tail -1 <<<"$out")" "rc=2"
eq "체크섬 불일치: 안내" "$(grep -c '체크섬 검증 실패' <<<"$out")" "1"
eq "체크섬 불일치: 풀지 않음" "$([[ -e "$TMP/home-SHASUMS256.bad/.openmake/node/bin/node" ]] && echo yes || echo no)" "no"

# ── Redis 주소 포트 갱신: 비밀번호가 든 주소도 포트만 바뀐다 ──
# shellcheck disable=SC2034  # 아래에서 source 하는 함수가 읽는다
SCRIPT_DIR="$TMP/app"; mkdir -p "$SCRIPT_DIR"
# shellcheck source=/dev/null
source "$FN"
printf 'REDIS_PORT=6379\nREDIS_URL=redis://:abc123@127.0.0.1:6379\n' > "$SCRIPT_DIR/.env"
update_env_port REDIS_PORT 6380
eq "비밀번호 주소 포트" "$(grep '^REDIS_URL=' "$SCRIPT_DIR/.env")" "REDIS_URL=redis://:abc123@127.0.0.1:6380"
eq "REDIS_PORT 갱신" "$(grep '^REDIS_PORT=' "$SCRIPT_DIR/.env")" "REDIS_PORT=6380"
printf 'REDIS_PORT=6379\nREDIS_URL=redis://127.0.0.1:6379\n' > "$SCRIPT_DIR/.env"
update_env_port REDIS_PORT 6381
eq "비밀번호 없는 주소 포트" "$(grep '^REDIS_URL=' "$SCRIPT_DIR/.env")" "REDIS_URL=redis://127.0.0.1:6381"

printf 'linux-install-verify.test: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
