#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2329
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export OMK_ROOT="$TMP/root" OMK_SOURCE_ONLY=1
. "$HERE/omk.sh"
git() { if [[ "${3:-}" == fetch ]]; then return 0; fi; command git "$@"; }
ldir="$(llm_dir staging)"; mkdir -p "$ldir/apps/api/dist"
command git -C "$ldir" init -q
command git -C "$ldir" -c user.name=t -c user.email=t@e commit -qm fixture --allow-empty
command git -C "$ldir" branch -M main
sha="$(command git -C "$ldir" rev-parse HEAD)"
printf '.env\napps/\n' > "$ldir/.git/info/exclude"
printf 'OMK_TRACK=main\n' > "$ldir/.env"
printf '{"gitHash":"%s"}' "$sha" > "$ldir/apps/api/dist/build-info.json"
command git -C "$ldir" update-ref refs/remotes/origin/main "$sha"
curl() { printf '{"data":{"build":{"gitHash":"%s"}}}' "$sha"; }
verified_push() { touch "$TMP/pushed"; }
cmd_env_hold staging
if (cmd_env_approve staging --yes) >/dev/null 2>&1; then echo 'FAIL missing SHA accepted'; exit 1; fi
if (cmd_env_approve staging --sha aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --yes) >/dev/null 2>&1; then echo 'FAIL stale SHA accepted'; exit 1; fi
if (cmd_env_approve staging --sha "$sha" --yes) >/dev/null 2>&1; then echo 'FAIL missing evidence accepted'; exit 1; fi
[[ ! -f "$TMP/pushed" ]]
printf '{"schemaVersion":1,"stage":"staging-validation","sha":"%s","status":"passed","checks":[{"status":"passed"}],"startedAt":"2026-10-20T00:00:00Z","finishedAt":"2026-10-20T00:01:00Z"}' "$sha" > "$(pipeline_dir staging)/validation.json"
verified_push() { return 1; }
if (cmd_env_approve staging --sha "$sha" --yes) >/dev/null 2>&1; then echo 'FAIL failed push accepted'; exit 1; fi
[[ -f "$(pipeline_dir staging)/hold" && ! -f "$(pipeline_dir staging)/human-verification.json" ]]
verified_push() { touch "$TMP/pushed"; }
cmd_env_approve staging --sha "$sha" --yes
[[ -f "$TMP/pushed" && ! -f "$(pipeline_dir staging)/hold" ]]
node - "$(pipeline_dir staging)/human-verification.json" "$sha" <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict');const p=process.argv[2];const v=JSON.parse(fs.readFileSync(p));assert.equal(v.schemaVersion,1);assert.equal(v.stage,'human-verify');assert.equal(v.sha,process.argv[3]);assert.equal(v.status,'passed');assert.equal(v.actor,process.env.USER||'unknown');assert.ok(v.approvedAt);assert.equal(v.validationFinishedAt,'2026-10-20T00:01:00Z');assert.equal(fs.statSync(p).mode&0o777,0o600);
NODE
echo 'approve exact SHA, evidence, push failure, receipt and hold-release checks passed'
