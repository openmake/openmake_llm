#!/usr/bin/env bash
# Managed pipeline: staging update → smoke → configured validation → human hold;
# online captured release → verification gate → backup/update → smoke/identity.
# Configuration is local: OMK_VALIDATION_CONFIG or <env-dir>/.pipeline/checks.json.
pipeline_dir() { printf '%s/.pipeline' "$(env_dir "$1")"; }
pipeline_locked() ( # A single host-local lock covers every mutating pipeline command.
    local env="$1"; shift
    if [[ "${OMK_PIPELINE_LOCK_ENV:-}" == "$env" ]]; then "$@"; return; fi
    local lock; lock="$(pipeline_dir "$env")/lock"
    mkdir -p "$(dirname "$lock")"
    mkdir "$lock" 2>/dev/null || die "$env pipeline busy (or abandoned lock: $lock); inspect before removing"
    trap 'rmdir "$lock"' EXIT
    local OMK_PIPELINE_LOCK_ENV="$env"
    "$@"
)
pipeline_update_allowed() {
    [[ ! -f "$(pipeline_dir "$1")/hold" ]] || die "$1 held for human review; explicitly release with omk env hold $1 --release"
}
cmd_env_hold() { pipeline_locked "$1" pipeline_hold "$@"; }
pipeline_hold() {
    local env="$1"; shift
    mkdir -p "$(pipeline_dir "$env")"
    if [[ "${1:-}" == --release && $# -eq 1 ]]; then rm -f "$(pipeline_dir "$env")/hold"; return; fi
    [[ $# -eq 0 ]] || usage_die 'hold <env> [--release]'
    git -C "$(llm_dir "$env")" rev-parse HEAD > "$(pipeline_dir "$env")/hold"
}
pipeline_identity() { # Require running and on-disk builds to identify the same full commit.
    local env="$1" sha="$2" ldir body hash full disk
    ldir="$(llm_dir "$env")"
    load_toolchain "$ldir"
    body="$(curl -fsS --max-time 10 "http://localhost:$(llm_api_port "$ldir")/health")" || die 'Running build identity unavailable'
    hash="$(printf '%s' "$body" | node -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(v.data?.build?.gitHash||"")')"
    [[ "$hash" =~ ^[a-f0-9]{7,40}$ ]] || die 'Running build has no Git identity'
    full="$(git -C "$ldir" rev-parse --verify "$hash^{commit}")" || die 'Running build identity ambiguous'
    disk="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).gitHash||"")' "$ldir/apps/api/dist/build-info.json")" || die 'Installed build identity unavailable'
    [[ "$disk" =~ ^[a-f0-9]{7,40}$ ]] || die 'Installed build has no Git identity'
    [[ "$sha" == "$full" && "$sha" == "$(git -C "$ldir" rev-parse --verify "$disk^{commit}")" ]] || die 'Running/installed build SHA differs from requested SHA'
}
cmd_env_validate() { pipeline_locked "$1" pipeline_validate "$@"; }
pipeline_validate() {
    local env="$1" ldir sha out rc=0
    [[ $# -eq 1 && "$env" == staging ]] || usage_die 'validate staging'
    ldir="$(llm_dir "$env")"; sha="$(git -C "$ldir" rev-parse HEAD)"; out="$(pipeline_dir "$env")/validation.json"
    rm -f "$out" # A failed rerun must invalidate previous passing evidence.
    pipeline_identity "$env" "$sha"
    node "$SCRIPT_DIR/../pipeline/validate.mjs" --config "${OMK_VALIDATION_CONFIG:-$(pipeline_dir "$env")/checks.json}" --cwd "$ldir" --sha "$sha" --output "$out" || rc=$?
    [[ "$sha" == "$(git -C "$ldir" rev-parse HEAD)" && -z "$(git -C "$ldir" status --porcelain)" ]] || { rm -f "$out"; die 'Source changed during validation'; }
    ( pipeline_identity "$env" "$sha" ) || { rm -f "$out"; die "Build changed during validation"; }
    return "$rc"
}
pipeline_verify_proof() {
    local env="$1" sha="$2" dir; dir="$(pipeline_dir "$env")"
    [[ "$sha" =~ ^[a-f0-9]{40}$ && -f "$dir/hold" && "$(cat "$dir/hold")" == "$sha" ]] || die 'Verify requires the exact held --sha (run pipeline staging first)'
    node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(v.schemaVersion!==1||v.stage!=="staging-validation"||v.sha!==process.argv[2]||v.status!=="passed"||!v.startedAt||!v.finishedAt||!Array.isArray(v.checks)||!v.checks.length||v.checks.some(c=>c.status!=="passed"))process.exit(1)' "$dir/validation.json" "$sha" || die 'Missing, failed or stale strong validation evidence'
    pipeline_identity "$env" "$sha"
}
# A fresh Bash process preserves updater errexit even in conditional callers.
# The parent retains the shared lock while the child uses that exact ownership.
pipeline_update_step() {
    OMK_PIPELINE_LOCK_ENV="$1" OMK_PIPELINE_RELEASE_SHA="${2:-}" bash "$SCRIPT_PATH" env update "$1" --yes
}
cmd_env_pipeline() { pipeline_locked "$1" pipeline_run "$@"; }
pipeline_run() {
    local env="$1"; shift
    [[ "$env" == staging || "$env" == online ]] || usage_die 'pipeline staging|online [--schedule [CRON]|--off]'
    if [[ $# -gt 0 ]]; then
        local cron="${OMK_PIPELINE_CRON:-$OMK_AUTOUPDATE_CRON}" name="omk-pipeline-$env" ldir
        ldir="$(llm_dir "$env")"; load_toolchain "$ldir"; require_pm2
        case "$1" in
            --off) [[ $# -eq 1 ]] || usage_die 'pipeline --off'; pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null || true; return ;;
            --schedule) [[ $# -le 2 ]] || usage_die 'pipeline --schedule [CRON]'; [[ $# -lt 2 ]] || cron="$2" ;;
            *) usage_die 'pipeline staging|online [--schedule [CRON]|--off]' ;;
        esac
        pm2 describe "$name" >/dev/null 2>&1 && pm2 delete "$name" >/dev/null || true
        ( cd "$ldir" && pm2 start "$SCRIPT_PATH" --name "$name" --interpreter bash --no-autorestart --cron-restart "$cron" --time -- env pipeline "$env" )
        return
    fi
    pipeline_update_allowed "$env"
    local ldir sha track; ldir="$(llm_dir "$env")"; load_toolchain "$ldir"; track="$(dotenv_get "$ldir/.env" OMK_TRACK)"
    if [[ "$env" == staging ]]; then
        [[ "$track" == main && "$(git -C "$ldir" branch --show-current)" == main ]] || die 'staging pipeline requires main track and branch'
        pipeline_update_step "$env" || return $?
        sha="$(git -C "$ldir" rev-parse HEAD)"
        cmd_env_smoke "$env" || return $?
        pipeline_validate "$env" || return $?
        [[ "$sha" == "$(git -C "$ldir" rev-parse HEAD)" ]] || die 'Staging SHA changed'
        pipeline_hold "$env"
        log_ok "Human review hold: $sha; verify staging --sha $sha after review"
    else
        [[ "$track" == release ]] || die 'online pipeline requires release track'
        git -C "$ldir" fetch -q --tags origin || die 'Cannot capture release tags'
        local tag captured
        tag="$(latest_release_tag "$ldir")"; [[ -n "$tag" ]] || die 'No release tag'
        captured="$(git -C "$ldir" rev-parse "$tag^{commit}")"
        release_gate_fetch "$ldir" || die 'Cannot fetch verification records'
        release_gate_check "$ldir" "$captured" || die "Unverified release $tag: $GATE_REASON"
        # The child updater uses only this captured immutable commit.
        pipeline_update_step "$env" "$captured" || return $?
        [[ "$(git -C "$ldir" rev-parse HEAD)" == "$captured" ]] || die 'Installed release differs from captured tag'
        cmd_env_smoke "$env" || return $?
        pipeline_identity "$env" "$captured"
    fi
}

# Trusted CLI operator approval for the exact SHA reviewed by the operator.
cmd_env_approve() { pipeline_locked "$1" pipeline_approve "$@"; }
pipeline_approve() {
    local env="$1"; shift
    [[ "$env" == staging ]] || usage_die 'approve staging --sha FULL_SHA [--yes]'
    local sha=""
    local verify_args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --sha) [[ $# -ge 2 ]] || usage_die 'approve requires --sha FULL_SHA'; sha="$2"; verify_args+=(--sha "$sha"); shift ;;
            --yes|-y) verify_args+=(--yes) ;;
            *) usage_die "Unknown approve argument: $1" ;;
        esac
        shift
    done
    [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || usage_die 'approve requires explicit --sha FULL_SHA'
    cmd_env_verify_unlocked "$env" "${verify_args[@]}"
    # Verification may be declined by the operator; only a remote ref proves push.
    [[ "${OMK_VERIFY_COMPLETED_SHA:-}" == "$sha" ]] || return 1
    node - "$(pipeline_dir "$env")" "$sha" "${USER:-unknown}" <<'NODE' || die 'Could not persist human approval receipt; hold retained'
const fs=require('node:fs'),path=require('node:path');
const [dir,sha,actor]=process.argv.slice(2);const validation=JSON.parse(fs.readFileSync(path.join(dir,'validation.json'),'utf8'));
const output=path.join(dir,'human-verification.json'),temporary=`${output}.${process.pid}.tmp`;
const receipt={schemaVersion:1,stage:'human-verify',sha,status:'passed',actor,approvedAt:new Date().toISOString(),validationFinishedAt:validation.finishedAt};
fs.writeFileSync(temporary,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,output);
NODE
    rm -f "$(pipeline_dir "$env")/hold"
    log_ok "Human approval recorded: $sha; staging hold released"
}
