# shellcheck shell=bash
# 테스트 전용 launchctl 대역 — 실제 launchd 를 건드리지 않는다. source 해서 쓴다.
# 상태는 파일에 둔다 (명령 치환 서브셸 안에서 불려도 남는다).
#   fake_lctl_reset [domain_ok=1]   등록 없음으로 초기화. 0 이면 GUI 도메인 없음 (SSH 만 열린 세션 등)
#   fake_lctl_load <plist> [path]   그 정의가 이미 로드된 상태로 만든다 (path = launchd 가 기억하는 파일 경로)
#   fake_lctl_log                   호출된 변경 명령 (bootout/bootstrap)
LCTL_STATE="$(mktemp -d)"

fake_lctl_reset() {
    rm -f "$LCTL_STATE/loaded.plist" "$LCTL_STATE/path" "$LCTL_STATE/log"; : > "$LCTL_STATE/log"
    if [[ "${1:-1}" == 1 ]]; then : > "$LCTL_STATE/domain"; else rm -f "$LCTL_STATE/domain"; fi
}
fake_lctl_load() { cp "$1" "$LCTL_STATE/loaded.plist"; printf '%s' "${2:-$1}" > "$LCTL_STATE/path"; }
fake_lctl_log() { local l; l="$(tr '\n' ' ' < "$LCTL_STATE/log")"; printf '%s' "${l% }"; }

# plist → "A<TAB>인자" · "K<TAB>환경 키" · "V<TAB>환경 값" · "O<TAB>stdout" · "E<TAB>stderr" (XML 해제)
fake_plist_fields() {
    awk '
        function emit(tag, v) {
            gsub(/&lt;/, "<", v); gsub(/&gt;/, ">", v); gsub(/&quot;/, "\"", v); gsub(/&apos;/, "\047", v); gsub(/&amp;/, "\\&", v)
            print tag "\t" v
        }
        {
            line = $0
            while (match(line, /<(key|string)>[^<]*<\/(key|string)>|<\/array>|<\/dict>/)) {
                tok = substr(line, RSTART, RLENGTH); line = substr(line, RSTART + RLENGTH)
                if (tok == "</array>" || tok == "</dict>") { mode = ""; continue }
                isKey = (substr(tok, 1, 5) == "<key>")
                v = tok; sub(/^<(key|string)>/, "", v); sub(/<\/(key|string)>$/, "", v)
                if (isKey && mode != "env") {
                    mode = (v == "ProgramArguments") ? "args" : (v == "EnvironmentVariables") ? "env" : (v == "StandardOutPath") ? "out" : (v == "StandardErrorPath") ? "err" : ""
                    continue
                }
                if (mode == "args") emit("A", v)
                else if (mode == "env") emit(isKey ? "K" : "V", v)
                else if (mode == "out") { emit("O", v); mode = "" }
                else if (mode == "err") { emit("E", v); mode = "" }
            }
        }' "$1"
}

# 실제 `launchctl print gui/<uid>/<label>` 과 같은 모양 (launchd 가 넣는 환경 키·다른 environment 블록 포함)
fake_lctl_print_job() {
    local tag v args=() envs=() outp="" errp="" key=""
    while IFS=$'\t' read -r tag v; do
        case "$tag" in
            A) args+=("$v") ;; K) key="$v" ;; V) envs+=("$key => $v") ;; O) outp="$v" ;; E) errp="$v" ;;
        esac
    done < <(fake_plist_fields "$LCTL_STATE/loaded.plist")
    printf '%s = {\n\tactive count = 0\n\tpath = %s\n\ttype = LaunchAgent\n\n\tprogram = %s\n\targuments = {\n' "$1" "$(cat "$LCTL_STATE/path")" "${args[0]}"
    printf '\t\t%s\n' "${args[@]}"
    printf '\t}\n\n'
    [[ -z "$outp" ]] || printf '\tstdout path = %s\n' "$outp"
    [[ -z "$errp" ]] || printf '\tstderr path = %s\n' "$errp"
    printf '\tdefault environment = {\n\t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin\n\t}\n\n\tenvironment = {\n\t\tOSLogRateLimit => 64\n'
    [[ ${#envs[@]} -eq 0 ]] || printf '\t\t%s\n' "${envs[@]}"
    printf '\t\tXPC_SERVICE_NAME => com.openmake.colima\n\t}\n\n\tdomain = gui/501 [100002]\n}\n'
}

launchctl() {
    case "$1" in
        print)
            [[ -f "$LCTL_STATE/domain" ]] || return 113
            case "$2" in gui/*/*) ;; *) return 0 ;; esac
            [[ -f "$LCTL_STATE/loaded.plist" ]] || return 113
            fake_lctl_print_job "$2" ;;
        bootout) echo bootout >> "$LCTL_STATE/log"; rm -f "$LCTL_STATE/loaded.plist" ;;
        bootstrap)
            [[ -f "$LCTL_STATE/domain" ]] || return 125
            echo bootstrap >> "$LCTL_STATE/log"; fake_lctl_load "$3" ;;
        *) printf 'unexpected launchctl %s\n' "$*" >&2; return 99 ;;
    esac
}
fake_lctl_reset 1
