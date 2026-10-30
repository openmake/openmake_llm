# shellcheck shell=bash
# ==============================================================================
# DGX 채팅 모델 이름 감지 — source 해서 쓰는 함수 모음 (bash 3.2 호환)
#
# scripts/env/omk.sh(env install·update·dev setup)와 openmake_llm.sh(deploy·update)가 함께 쓴다.
# 호출자가 log_info·log_warn·log_err 를 정의한다. die 가 없으면 log_err 뒤 exit 2 로 정의한다. 네트워크는 curl 만.
#   . "$ROOT/scripts/lib/dgx-model.sh"
# ==============================================================================
declare -F die >/dev/null 2>&1 || die() { log_err "$*"; exit 2; }

OMK_DGX_LEGACY_MODEL="${OMK_DGX_LEGACY_MODEL:-qwen3.8-27b}"   # 레포 litellm.config.yaml·qwen-serve.sh 의 기본 served-model-name
DGX_RESOLVE_SOURCE="${DGX_RESOLVE_SOURCE:-}"

# DGX 모델 ID 는 게이트웨이 config 의 이름·앱의 모델 ID 로 그대로 쓰인다 — 따옴표·공백·'/'(외부 provider 표기)·':'(provider:model)를
# 막고, config 의 다른 항목·업스트림 모델과 겹치지 않게 한다. 기본값(옛 이름)은 레포 config 그대로라 겹침을 보지 않는다.
dgx_model_check() { # $1=ID [$2=레포 litellm config $3=업스트림 모델] → 0=쓸 수 있음, 아니면 사유를 출력
    local re='^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    [[ "$1" =~ $re ]] || { printf '형식이 올바르지 않습니다(영숫자와 . _ - 만, 128자 이하): %s' "$1"; return 1; }
    # 업스트림과의 겹침은 기본값도 본다 — 정적 DGX 라우트와 업스트림 항목이 같은 model_name 의 두 배포가 된다.
    [[ -z "${3:-}" || "$1" != "$3" ]] || { printf '업스트림 모델(OMK_UPSTREAM_MODEL)과 같은 이름입니다: %s' "$1"; return 1; }
    [[ "$1" != "$OMK_DGX_LEGACY_MODEL" ]] || return 0
    if [[ -f "${2:-}" ]] && grep -qxF -e "  - model_name: $1" -e "  - model_name: \"$1\"" "$2"; then
        printf '게이트웨이 config 에 이미 있는 이름입니다: %s' "$1"; return 1
    fi
}
# vLLM 의 OpenAI 호환 /models 에서 기본 모델의 served id 만 한 줄씩 — node 없이 읽는다(install 의 사전 검사는 툴체인 준비 전이다).
# vLLM 은 항목마다 permission[].id(modelperm-…)를 넣으므로 그 블록을 지운 뒤 항목별로 읽고, LoRA 어댑터(parent 가 기본 모델 이름)는 뺀다.
# 키는 헤더로만 쓴다. 읽지 못하면 HTTP 코드(000 = 연결 불가) 한 줄을 출력하고 rc 1 — 하위 셸에서 불러도 코드가 남게.
dgx_served_models() { # $1=base $2=key → served id 한 줄씩 | 실패 시 HTTP 코드 + rc 1
    local a=() out code ids
    [[ -n "${2:-}" ]] && a=(-H "Authorization: Bearer $2")
    out="$(curl -s -m 6 -w '\n%{http_code}' ${a[@]+"${a[@]}"} "${1%/}/models" 2>/dev/null || true)"
    code="${out##*$'\n'}"; [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
    [[ "$code" == 200 ]] || { printf '%s\n' "$code"; return 1; }
    ids="$(printf '%s' "${out%$'\n'*}" | tr -d '\n' | sed -E 's/"permission"[[:space:]]*:[[:space:]]*\[[^]]*\]//g' \
        | grep -oE '\{[^{}]*\}' | grep -vE '"parent"[[:space:]]*:[[:space:]]*"' \
        | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/' || true)"
    [[ -n "$ids" ]] || { printf '%s\n' "$code"; return 1; }
    printf '%s\n' "$ids"
}
# DGX 채팅 모델의 정식 ID — 명시값 > (명시로 고정해 둔 기억값) > vLLM 이 서빙하는 기본 모델 중 옛 이름·gpt-3.5-turbo·config 의 다른
# 이름을 뺀 하나 > 옛 이름. 명시값·고정값은 served 에 있어야 한다. 명시값 auto 는 고정을 풀고 감지로 돌아간다. 후보가 둘 이상이면 멈춘다.
# vLLM 에 닿지 못하면 경고 1줄 뒤 명시값 → 기억값 → 기본값(설치·업데이트를 막지 않는다).
# 출력은 "ID 출처" 한 줄(출처 served|explicit|pinned|fallback) — 로그는 stderr 로 보내 값과 섞이지 않게 한다.
dgx_resolve_model() { # $1=base $2=key $3=명시값(auto 가능) $4=기억값 [$5=기억값이 고정인가(1|0) $6=레포 litellm config]
    local served list cand n v why want="${3:-}" src=explicit
    if [[ "$want" == auto ]]; then want=""
    elif [[ -z "$want" && "${5:-0}" == 1 && -n "${4:-}" ]]; then want="$4"; src=pinned; fi
    if ! served="$(dgx_served_models "$1" "${2:-}")"; then
        v="${want:-${4:-$OMK_DGX_LEGACY_MODEL}}"
        log_warn "vLLM 모델 목록을 읽지 못해 이름을 감지하지 않았습니다(${1%/}/models, HTTP $served) — $v 사용${want:+ (서빙 여부 미확인)}$([[ "${3:-}" != auto ]] || printf ' (고정은 그대로 — vLLM 이 응답할 때 다시 실행)')" >&2
        printf '%s fallback\n' "$v"; return 0
    fi
    list="$(printf '%s' "$served" | tr '\n' ',' | sed -e 's/,$//' -e 's/,/, /g')"
    if [[ -n "$want" ]]; then
        printf '%s\n' "$served" | grep -qxF -e "$want" \
            || die "OMK_DGX_MODEL=$want$([[ "$src" != pinned ]] || printf '(고정된 값)') 을 vLLM 이 서빙하지 않습니다(served: $list) — vLLM 의 served-model-name 을 먼저 맞추거나 목록의 이름을 주십시오, 감지로 돌아가려면 OMK_DGX_MODEL=auto (아무것도 바꾸지 않았습니다)"
        printf '%s %s\n' "$want" "$src"; return 0
    fi
    cand="$(printf '%s\n' "$served" | grep -vxF -e "$OMK_DGX_LEGACY_MODEL" -e gpt-3.5-turbo || true)"
    if [[ -n "$cand" && -f "${6:-}" ]]; then   # config 의 다른 정적 이름(어댑터·임베딩 등)은 채팅 모델 후보가 아니다
        cand="$(printf '%s\n' "$cand" | while IFS= read -r v; do grep -qxF -e "  - model_name: $v" -e "  - model_name: \"$v\"" "$6" || printf '%s\n' "$v"; done)"
    fi
    n="$(printf '%s' "$cand" | grep -c . || true)"
    [[ "$n" -le 1 ]] || die "vLLM 이 서빙하는 채팅 모델이 둘 이상입니다($(printf '%s' "$cand" | tr '\n' ',' | sed -e 's/,$//' -e 's/,/, /g')) — 정식 ID 를 고를 수 없습니다. OMK_DGX_MODEL=<값> 으로 지정해 다시 실행하십시오 (아무것도 바꾸지 않았습니다)"
    if [[ "$n" -eq 0 ]]; then
        log_info "vLLM 서빙 목록($list)에 새 채팅 모델 이름이 없습니다 — $OMK_DGX_LEGACY_MODEL 를 정식 이름으로 씁니다" >&2
        printf '%s served\n' "$OMK_DGX_LEGACY_MODEL"; return 0
    fi
    why="$(dgx_model_check "$cand")" || die "vLLM 서빙 이름을 DGX 모델 ID 로 쓸 수 없습니다 — $why (아무것도 바꾸지 않았습니다)"
    log_info "DGX 채팅 모델 감지: $cand (vLLM served: $list)" >&2
    printf '%s served\n' "$cand"
}
