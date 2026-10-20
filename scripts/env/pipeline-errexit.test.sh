#!/usr/bin/env bash
# shellcheck disable=SC2016 # Fixture script deliberately expands variables when executed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1 OMK_LOG=off
ldir="$OMK_ROOT/staging/llm"; mkdir -p "$ldir"
git -C "$ldir" init -q
git -C "$ldir" -c user.name=t -c user.email=t@e commit -qm fixture --allow-empty
git -C "$ldir" branch -M main
printf 'OMK_TRACK=main\n' > "$ldir/.env"
export OMK_FIXTURE_SOURCE="$HERE/omk.sh"
cat > "$TMP/omk-fixture.sh" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail
. "$OMK_FIXTURE_SOURCE"
SCRIPT_PATH="${BASH_SOURCE[0]}"
cmd_env_update_unlocked() { false; touch "$OMK_ROOT/swallowed-update-failure"; }
cmd_env_smoke() { touch "$OMK_ROOT/smoked-after-failure"; }
pipeline_validate() { return 0; }
main "$@"
FIXTURE
set +e
bash "$TMP/omk-fixture.sh" env pipeline staging
rc=$?
set -e
[[ "$rc" -ne 0 && ! -f "$OMK_ROOT/swallowed-update-failure" && ! -f "$OMK_ROOT/smoked-after-failure" ]] || { echo 'FAIL inner nonfinal update failure swallowed'; exit 1; }
echo 'pipeline preserves errexit for actual nonfinal update failures'
