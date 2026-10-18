#!/usr/bin/env bash
# 빌드 산출물 묶음(오프라인 번들·canary 롤백 스냅샷)이 workspace 패키지 산출물(packages/*/dist)까지 싣는지 —
# 실제 docker·pm2·운영 트리를 쓰지 않는다. 임시 git 레포에 스크립트를 복사하고 PATH 앞의 가짜 docker 만 쓴다.
#   bash scripts/airgap/build-artifacts.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
export LC_ALL=C
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$HERE/../.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

BIN="$TMP/bin"; mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOS'
#!/usr/bin/env bash
# 가짜 docker — 이미지는 있다고 답하고, save 는 빈 파일만 만든다
case "$1" in
    save) while [[ $# -gt 0 ]]; do [[ "$1" == -o ]] && : > "$2"; shift; done ;;
esac
exit 0
EOS
chmod +x "$BIN/docker"

# ── 오프라인 번들: 만들고 → 설치하면 packages/*/dist 가 따라온다 ──
REPO="$TMP/repo"; mkdir -p "$REPO/scripts/airgap" "$REPO/infra" "$REPO/packages/config"
cp "$HERE/build-offline-bundle.sh" "$HERE/install-offline-bundle.sh" "$REPO/scripts/airgap/"
printf 'services:\n  db:\n    image: postgres:16\n' > "$REPO/infra/docker-compose.yml"
printf '{"name":"@openmake/config","main":"dist/index.js"}\n' > "$REPO/packages/config/package.json"
( cd "$REPO" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )
# 빌드 산출물 — git 에 없다(실제 레포도 dist 는 .gitignore)
mkdir -p "$REPO/apps/api/dist" "$REPO/packages/config/dist"
echo api > "$REPO/apps/api/dist/cli.js"; echo cfg > "$REPO/packages/config/dist/index.js"

( PATH="$BIN:$PATH" AIRGAP_BUNDLE_DIR="$TMP/out" bash "$REPO/scripts/airgap/build-offline-bundle.sh" </dev/null >/dev/null 2>&1 )
BUNDLE="$(find "$TMP/out" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
ok "bundle: 만들어진다" '[[ -f "$BUNDLE/build-artifacts.tar.gz" && -f "$BUNDLE/MANIFEST.txt" ]]'
ok "bundle: 패키지 산출물을 싣는다" 'tar -tzf "$BUNDLE/build-artifacts.tar.gz" | grep -qx "packages/config/dist/index.js"'
ok "bundle: API 산출물도 그대로" 'tar -tzf "$BUNDLE/build-artifacts.tar.gz" | grep -qx "apps/api/dist/cli.js"'

# shellcheck disable=SC2034  # ok 의 eval 문자열이 읽는다
install_out="$(PATH="$BIN:$PATH" bash "$REPO/scripts/airgap/install-offline-bundle.sh" "$BUNDLE" --dest "$TMP/dest" </dev/null 2>&1)"
eq "install: 패키지 산출물이 설치된다" "$(cat "$TMP/dest/packages/config/dist/index.js" 2>/dev/null)" "cfg"
ok "install: 빌드 생략 가능 안내" '[[ "$install_out" == *"npm run build 생략 가능"* ]]'

# 패키지 산출물이 빠진 옛 번들은 설치가 알아채고 build:packages 를 안내한다
( cd "$REPO" && tar -czf "$BUNDLE/build-artifacts.tar.gz" apps/api/dist )
old_sum="$(awk '$2 == "build-artifacts.tar.gz" {print $1}' "$BUNDLE/MANIFEST.txt")"
new_sum="$(sha "$BUNDLE/build-artifacts.tar.gz")"
sed -i.bak "s/$old_sum/$new_sum/" "$BUNDLE/MANIFEST.txt"
# shellcheck disable=SC2034  # ok 의 eval 문자열이 읽는다
install_out="$(PATH="$BIN:$PATH" bash "$REPO/scripts/airgap/install-offline-bundle.sh" "$BUNDLE" --dest "$TMP/dest-old" </dev/null 2>&1)"
ok "install(옛 번들): build:packages 안내" '[[ "$install_out" == *"npm run build:packages"* ]]'

# ── canary 롤백 스냅샷: 패키지 산출물까지 담고, 옛 스냅샷으로는 지금 패키지 산출물을 지우지 않는다 ──
FN="$TMP/canary-fns.sh"
sed -n '/^canary_artifact_dirs() {/,/^}/p; /^canary_backup_dist() {/,/^}/p; /^canary_restore_dist() {/,/^}/p' "$ROOT/openmake_llm.sh" > "$FN"
ok "canary: 함수 3개를 찾았다" '[[ "$(grep -c "^canary_[a-z_]*() {" "$FN")" == 3 ]]'
SD="$TMP/app"; mkdir -p "$SD/apps/api/dist" "$SD/apps/web/.next" "$SD/packages/config/dist"
canary() (
    log_info() { :; }; log_ok() { :; }; log_warn() { :; }; log_err() { echo "ERR $*" >&2; }
    # shellcheck disable=SC2034  # 아래에서 source 하는 canary 함수들이 읽는다
    SCRIPT_DIR="$SD" CANARY_RELEASE_DIR="$TMP/releases" CANARY_KEEP_RELEASES=5
    # shellcheck source=/dev/null
    source "$FN"
    git() { echo deadbee; }
    "$@"
)
put() { echo "$1" > "$SD/apps/api/dist/cli.js"; echo "$1" > "$SD/apps/web/.next/BUILD_ID"; echo "$1" > "$SD/packages/config/dist/index.js"; }
state() { printf '%s/%s/%s' "$(cat "$SD/apps/api/dist/cli.js")" "$(cat "$SD/apps/web/.next/BUILD_ID")" "$(cat "$SD/packages/config/dist/index.js" 2>/dev/null || echo none)"; }

put old
canary canary_backup_dist >/dev/null 2>&1
SNAP="$(find "$TMP/releases" -name 'pre-canary-*.tar.gz' -type f | head -n 1)"
ok "canary: 스냅샷에 패키지 산출물" 'tar -tzf "$SNAP" | grep -qx "packages/config/dist/index.js"'
put new; echo stray > "$SD/packages/config/dist/added-in-new.js"
canary eval 'CANARY_BACKUP_FILE="'"$SNAP"'"; canary_restore_dist' >/dev/null 2>&1
eq "canary: 셋 다 이전 빌드로" "$(state)" "old/old/old"
ok "canary: 새 빌드에만 있던 패키지 파일은 사라진다" '[[ ! -e "$SD/packages/config/dist/added-in-new.js" ]]'

# 이 변경 전에 만든 스냅샷(API·웹만)으로 롤백해도 패키지 산출물은 지우지 않는다
OLD_SNAP="$TMP/pre-canary-legacy.tar.gz"; ( cd "$SD" && tar -czf "$OLD_SNAP" apps/api/dist apps/web/.next )
put new
canary eval 'CANARY_BACKUP_FILE="'"$OLD_SNAP"'"; canary_restore_dist' >/dev/null 2>&1
eq "canary(옛 스냅샷): API·웹만 되돌리고 패키지 산출물은 남는다" "$(state)" "old/old/new"

printf 'build-artifacts.test: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
