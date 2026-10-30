#!/usr/bin/env bash
# openmake_llm.sh deploy 의 DGX 채팅 모델 이름 맞춤(손 관리 게이트웨이 설치본) 테스트 — 실제 네트워크·PM2·docker·DB 를 건드리지 않는다.
# 임시 폴더에 스크립트를 복사하고 main 직전에 훅을 넣어 무거운 단계(빌드·compose·마이그레이션·앱 재시작)를 기록만 하게 바꾼다.
# PATH 앞의 가짜 pm2·curl 이 게이트웨이 앱·vLLM /v1/models·게이트웨이 /v1/models 를 흉내 낸다. node 는 실제(js-yaml 검증).
# .env 에 OMK_LITELLM_CONFIG·OMK_LITELLM_PM2_APP 이 있을 때만 동작하고, 자동 감지의 이상은 경고만, 명시값 오류만 빌드 전 종료 2.
#   bash scripts/env/deploy-dgx-sync.test.sh      # macOS 기본 bash 3.2 에서도 통과해야 한다
set -uo pipefail
HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$( cd "$HERE/../.." && pwd )"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
eq() { if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$3" "$2"; fi; }
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); printf 'FAIL %s  (%s)\n' "$1" "$2"; fi; }

if ! ( cd "$ROOT" && node -e 'require("module").createRequire(require("path").resolve("apps/api/package.json"))("js-yaml")' ) >/dev/null 2>&1; then
    echo "SKIP deploy-dgx-sync: node 또는 apps/api 의 js-yaml 없음 (npm ci 먼저)"; exit 0
fi

VKEY="sk-test-key"            # config 의 DGX 항목 키 — 어떤 출력에도 나오면 안 된다
GKEY="sk-gw-master-test"      # 앱 .env 의 LLM_API_KEY — 마찬가지
VBASE="http://vllm.test:8002/v1"
GWURL="http://gw.test:4000"

# ── 가짜 실행 파일 ──
BIN="$TMP/bin"; mkdir -p "$BIN"
# pm2: jlist 는 FAKE_PM2_APPS 의 이름들(앱은 pm2_env.LLM_DEFAULT_MODEL — FAKE_PM2_MODEL, 없으면 지금 .env 값). 그 밖은 기록만.
cat > "$BIN/pm2" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == jlist ]]; then
    model="${FAKE_PM2_MODEL-$(grep -E '^LLM_DEFAULT_MODEL=' "$FAKE_APP/.env" 2>/dev/null | tail -1 | cut -d= -f2-)}"
    out="" sep=""
    for n in ${FAKE_PM2_APPS-openmake-llm gw}; do
        out="$out$sep{\"name\":\"$n\",\"pm2_env\":{\"status\":\"online\",\"LLM_DEFAULT_MODEL\":\"$model\"}}"; sep=","
    done
    printf '[%s]' "$out"; exit 0
fi
echo "pm2 $*" >> "$FAKE_LOG"
EOF
# curl: vLLM 은 FAKE_VLLM(공백 구분 served, name@parent 는 어댑터, '-' 는 미도달), 게이트웨이는 지금 config 의 model_name 목록
# (FAKE_GW_STUCK=1 이면 처음 config 의 목록 그대로). 호출은 URL·인증 헤더가 기대값인지만 기록한다(키 값은 기록하지 않는다).
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
url="" hdr="" w=0 prev=""
for a in "$@"; do
    [[ "$prev" == -H ]] && hdr="$a"
    [[ "$a" == -w ]] && w=1
    [[ "$a" == http* ]] && url="$a"
    prev="$a"
done
auth=none
[[ "$hdr" != "Authorization: Bearer $FAKE_VKEY" ]] || auth=vllm
[[ "$hdr" != "Authorization: Bearer $FAKE_GKEY" ]] || auth=gw
echo "curl $url auth=$auth app=$(grep -E '^LLM_DEFAULT_MODEL=' "$FAKE_APP/.env" | tail -1 | cut -d= -f2-)" >> "$FAKE_LOG"
case "$url" in
    "$FAKE_GWURL"/v1/models)
        src="$FAKE_CFG"; [[ "${FAKE_GW_STUCK:-0}" != 1 ]] || src="$FAKE_CFG_FIRST"
        ids="$(sed -nE 's/^  - model_name: "?([^"]*)"?$/\1/p' "$src" | while IFS= read -r n; do printf '{"id":"%s","object":"model"},' "$n"; done)"
        printf '{"data":[%s]}' "${ids%,}" ;;
    */models)
        if [[ "${FAKE_VLLM:--}" == - ]]; then [[ $w -eq 0 ]] || printf '\n000'; exit 7; fi
        out="" sep=""
        for i in $FAKE_VLLM; do
            id="${i%%@*}"; parent=null; [[ "$i" != *@* ]] || parent="\"${i#*@}\""
            out="$out$sep{\"id\":\"$id\",\"object\":\"model\",\"root\":\"/models/x\",\"parent\":$parent,\"permission\":[{\"id\":\"modelperm-1\",\"object\":\"model_permission\"}]}"; sep=","
        done
        printf '{"object":"list","data":[%s]}' "$out"; [[ $w -eq 0 ]] || printf '\n200' ;;
esac
EOF
for name in docker npm npx git lsof; do printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/$name"; done
chmod +x "$BIN"/*

# ── fixture: main 직전에 훅을 source 해 무거운 단계만 갈아 끼운다(dgx_ops_*·gateway_*·env_set·pm2_env_check 는 실제 본문) ──
HOOK="$TMP/hook.sh"
cat > "$HOOK" <<'EOF'
require_node_version() { return 0; }
require_pm2_daemon_node_version() { return 0; }
cmd_build() { echo "build" >> "$FAKE_LOG"; }
ensure_docker_service() { return 0; }
wait_for_port() { return 0; }
cmd_migrate() { echo "migrate" >> "$FAKE_LOG"; }
pm2_restart_app() { echo "pm2_restart_app $1 app=$(grep -E '^LLM_DEFAULT_MODEL=' "$SCRIPT_DIR/.env" | tail -1 | cut -d= -f2-)" >> "$FAKE_LOG"; }
wait_for_app_with_logs() { return 0; }
restart_knowledge_worker_if_registered() { return 0; }
sync_caddyfile() { return 0; }
show_status() { return 0; }
sleep() { :; }
EOF
APP="$TMP/app"; mkdir -p "$APP/scripts/lib" "$APP/scripts/vllm" "$APP/infra" "$APP/apps"
cp "$ROOT"/scripts/lib/colima.sh "$ROOT"/scripts/lib/dgx-model.sh "$ROOT"/scripts/lib/pm2-save.sh "$APP/scripts/lib/"
cp "$ROOT/scripts/vllm/litellm.config.yaml" "$APP/scripts/vllm/"   # 감지의 제외용(레포) config
ln -s "$ROOT/apps/api" "$APP/apps/api"                               # js-yaml (apps/api 의존성)
awk -v hook="$HOOK" '$0 == "main \"$@\"" { print ". \"" hook "\"" } { print }' "$ROOT/openmake_llm.sh" > "$APP/openmake_llm.sh"
: > "$APP/infra/docker-compose.yml"
ok "fixture: main 직전에 훅이 들어갔다" 'grep -qxF ". \"$HOOK\"" "$APP/openmake_llm.sh"'

GW="$TMP/gw"; mkdir -p "$GW"; CFG="$GW/litellm.config.yaml"
# 레포형(옛 이름 upstream) — DGX 항목의 주소·키를 literal 로(주석 유지). jev-decision 은 같은 :8002 어댑터.
REPO_CFG="$TMP/repo-form.yaml"
sed -e "s#os.environ/QWEN_VLLM_API_BASE#$VBASE#" -e "s#os.environ/VLLM_API_KEY#$VKEY#" "$ROOT/scripts/vllm/litellm.config.yaml" > "$REPO_CFG"
# 운영 현재 상태 — 정식 항목 qwen3.8-flash-next + qwen3.8-27b·gpt-3.5-turbo 가 이미 openai/qwen3.8-flash-next
OPS_CFG="$TMP/ops-form.yaml"
awk -v b="$VBASE" -v k="$VKEY" '{ sub(/model: openai\/qwen3\.8-27b$/, "model: openai/qwen3.8-flash-next"); print }
    /^model_list:/ { print "  - model_name: qwen3.8-flash-next"; print "    litellm_params:"; print "      model: openai/qwen3.8-flash-next"
                     print "      api_base: " b; print "      api_key: " k; print "" }' "$REPO_CFG" > "$OPS_CFG"

LOG="$TMP/calls.log"; OUT="$TMP/out.log"; ALL="$TMP/all-out.log"; : > "$ALL"
PM2H="$TMP/pm2home"; mkdir -p "$PM2H"
setup() { # $1=config 원본 $2=.env 추가 줄(\n 구분) — 게이트웨이 config·앱 .env 를 새로 깐다
    cp "$1" "$CFG"; cp "$CFG" "$TMP/cfg-first.yaml"; rm -f "$CFG".bak.* "$CFG".tmp.*
    printf 'LLM_BASE_URL=%s\nLLM_API_KEY=%s\nOMK_LITELLM_CONFIG=%s\nOMK_LITELLM_PM2_APP=gw\n%b' "$GWURL" "$GKEY" "$CFG" "${2:-}" > "$APP/.env"
}
run() { # deploy --yes → 종료 코드 출력. 환경변수(OMK_DGX_MODEL·FAKE_*)는 호출자가 앞에 붙인다.
    : > "$LOG"
    ( cd "$APP" || exit 99
      unset COMPOSE_FILE OMK_INSTANCE PORT POSTGRES_PORT REDIS_PORT OMK_DEPLOY_SKIP_CONFIRM QWEN_VLLM_API_BASE_X
      PATH="$BIN:$PATH" PM2_HOME="$PM2H" OMK_ROOT="$TMP/omkroot" FAKE_LOG="$LOG" FAKE_APP="$APP" FAKE_CFG="$CFG" \
      FAKE_CFG_FIRST="$TMP/cfg-first.yaml" FAKE_VKEY="$VKEY" FAKE_GKEY="$GKEY" FAKE_GWURL="$GWURL" \
      "$BASH" "$APP/openmake_llm.sh" deploy --yes </dev/null >"$OUT" 2>&1 )
    local rc=$?; cat "$OUT" >> "$ALL"; echo "$rc"
}
envv() { grep -E "^$1=" "$APP/.env" | tail -1 | cut -d= -f2-; }
sum() { cksum < "$1"; }
baks() { find "$GW" -name 'litellm.config.yaml.bak.*' | wc -l | tr -d ' '; }
calls() { tr '\n' ';' < "$LOG"; }
n_of() { grep -c -- "$1" "$LOG" | tr -d ' '; }

# ── 1. opt-in 키 없음 → 아무것도 하지 않는다 ──
setup "$REPO_CFG"; printf 'LLM_DEFAULT_MODEL=qwen3.8-27b\n' > "$APP/.env"; S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "키 없음: 배포 성공" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "키 없음: curl 미호출" "$(n_of '^curl')" "0"
eq "키 없음: config·.env 그대로" "$(sum "$CFG")|$(sum "$APP/.env")" "$S_CFG|$S_ENV"
ok "키 없음: DGX 로그 없음" '! grep -qE "DGX|게이트웨이" "$OUT"'

# ── 2. 운영 현재 상태(새 이름 항목·호환 라우트가 이미 새 이름, 앱도 새 이름, 무기록) → 기록 키 2개만 ──
setup "$OPS_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-flash-next\n'; S_CFG="$(sum "$CFG")"
eq "운영 상태: 배포 성공" "$(FAKE_VLLM='qwen3.8-27b qwen3.8-flash-next jev-decision@qwen3.8-flash-next' run)" "0"
eq "운영 상태: config 그대로·백업 없음" "$(sum "$CFG")|$(baks)" "$S_CFG|0"
eq "운영 상태: 게이트웨이 재시작 없음" "$(n_of '^pm2 restart')" "0"
eq "운영 상태: 기록 키 2개, 앱 기본 모델 그대로" "$(envv OMK_DGX_MODEL)|$(envv OMK_DGX_MODEL_PINNED)|$(envv LLM_DEFAULT_MODEL)" "qwen3.8-flash-next|0|qwen3.8-flash-next"
ok "운영 상태: 이미 맞춰져 있다고 알린다" 'grep -q "이미 qwen3.8-flash-next 로 맞춰져 있습니다" "$OUT"'
eq "운영 상태: 모델을 바꾸지 않았으니 pm2 save 없음" "$(n_of '^pm2 save')" "0"
ok "운영 상태: jev-decision 항목 그대로" 'grep -qxF "      model: openai/jev-decision" "$CFG"'

# ── 3. 전환(레포형 config·앱 옛 이름·served {옛, 새}) ──
setup "$REPO_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'
eq "전환: 배포 성공" "$(FAKE_VLLM='qwen3.8-27b chat-next jev-decision@chat-next' run)" "0"
D="$(diff "$REPO_CFG" "$CFG")"
eq "전환: diff 는 삽입 6줄 + 치환 2줄뿐" "$(grep -c '^>' <<<"$D")|$(grep -c '^<' <<<"$D")" "8|2"
eq "전환: 정식 항목이 model_list: 바로 다음" "$(sed -n "$(( $(grep -n '^model_list:' "$CFG" | cut -d: -f1) + 2 )),+2p" "$CFG" | tr '\n' ';')" \
    '  - model_name: "chat-next";    litellm_params:;      model: "openai/chat-next";'
L0="$(grep -n '^model_list:' "$CFG" | cut -d: -f1)"
eq "전환: api_base·api_key 줄은 앵커 항목과 바이트 단위로 같다" "$(sed -n "$((L0+5)),$((L0+6))p" "$CFG")" "$(sed -n '/^  - model_name: qwen3.8-27b$/,/api_key:/p' "$REPO_CFG" | grep -E '^      api_(base|key):')"
eq "전환: 두 호환 라우트 upstream 이 새 이름" "$(grep -cxF '      model: "openai/chat-next"' "$CFG")" "3"
ok "전환: jev-decision·bge-m3·wildcard·general_settings 그대로" 'grep -qxF "      model: openai/jev-decision" "$CFG" && grep -qxF "      model: openai/bge-m3" "$CFG" && grep -qxF "  - model_name: openrouter/*" "$CFG" && grep -q "^general_settings:" "$CFG"'
eq "전환: 백업 1개 = 원본" "$(baks)|$(sum "$(find "$GW" -name 'litellm.config.yaml.bak.*' | head -1)")" "1|$(sum "$REPO_CFG")"
eq "전환: 순서 — 빌드 → 마이그레이션 → 게이트웨이 재시작 → 게이트웨이 확인(앱 아직 옛 이름) → 앱 재시작(새 이름) → pm2 save" \
    "$(grep -vE "^curl ${VBASE}" "$LOG" | tr '\n' ';')" \
    "build;migrate;pm2 restart gw;curl $GWURL/v1/models auth=gw app=qwen3.8-27b;pm2_restart_app openmake-llm app=chat-next;pm2 save;"
eq "전환: vLLM 은 config 의 주소·키로" "$(grep -c "^curl $VBASE/models auth=vllm" "$LOG" | tr -d ' ')" "2"
eq "전환: .env 세 키" "$(envv OMK_DGX_MODEL)|$(envv OMK_DGX_MODEL_PINNED)|$(envv LLM_DEFAULT_MODEL)" "chat-next|0|chat-next"
ok "전환: 맞춤 예정·갱신·앱 기본 모델 로그" 'grep -q "DGX 모델 이름 맞춤 예정: 앱 qwen3.8-27b / 기록 없음 → chat-next (출처 served)" "$OUT" && grep -q "게이트웨이 config 갱신" "$OUT" && grep -q "앱 기본 모델: qwen3.8-27b → chat-next" "$OUT"'
ok "전환: 바뀐 config 를 js-yaml 이 읽는다" '( cd "$ROOT" && node -e "require(\"module\").createRequire(require(\"path\").resolve(\"apps/api/package.json\"))(\"js-yaml\").load(require(\"fs\").readFileSync(process.argv[1],\"utf8\"))" "$CFG" )'
T3_CFG="$TMP/after3.yaml"; cp "$CFG" "$T3_CFG"; cp "$APP/.env" "$TMP/after3.env"

# ── 14. 3 뒤 재실행 → 무변경(멱등) ──
S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "멱등: 배포 성공" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "멱등: config·.env 그대로, 재시작·저장 없음" "$(sum "$CFG")|$(sum "$APP/.env")|$(n_of '^pm2 restart')|$(n_of '^pm2 save')" "$S_CFG|$S_ENV|0|0"

# ── 4. vLLM 미도달 → 경고, 무변경, 배포 계속 ──
setup "$REPO_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'; S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "미도달: 배포 계속" "$(FAKE_VLLM=- run)" "0"
ok "미도달: 경고 + 이번 배포는 바꾸지 않음" 'grep -q "WARN.*vLLM 모델 목록을 읽지 못해.*이번 배포는 모델 이름을 바꾸지 않습니다" "$OUT"'
eq "미도달: 무변경·빌드 있음" "$(sum "$CFG")|$(sum "$APP/.env")|$(n_of '^build')" "$S_CFG|$S_ENV|1"

# ── 5. 후보 둘 이상 → 경고, 무변경 ──
eq "후보 둘: 배포 계속" "$(FAKE_VLLM='qwen3.8-27b a-1 b-1' run)" "0"
ok "후보 둘: 경고(목록 포함)" 'grep -q "WARN.*둘 이상입니다(a-1, b-1)" "$OUT"'
eq "후보 둘: 무변경" "$(sum "$CFG")|$(sum "$APP/.env")|$(n_of '^build')" "$S_CFG|$S_ENV|1"

# ── 6. 명시값이 서빙되지 않음 → 빌드 전 종료 2 ──
eq "명시값 미서빙: 종료 2" "$(OMK_DGX_MODEL=zz FAKE_VLLM='qwen3.8-27b chat-next' run)" "2"
eq "명시값 미서빙: 빌드 없음·무변경" "$(n_of '^build')|$(sum "$CFG")|$(sum "$APP/.env")" "0|$S_CFG|$S_ENV"
ok "명시값 미서빙: 사유" 'grep -q "OMK_DGX_MODEL=zz 을 vLLM 이 서빙하지 않습니다" "$OUT"'
eq "명시값 + 미도달: 빌드 전 종료 2" "$(OMK_DGX_MODEL=chat-next FAKE_VLLM=- run)|$(n_of '^build')" "2|0"

# ── 7. 고정 → 고정 유지 → auto 로 해제 ──
cp "$T3_CFG" "$CFG"; cp "$T3_CFG" "$TMP/cfg-first.yaml"; cp "$TMP/after3.env" "$APP/.env"; rm -f "$CFG".bak.*
eq "고정: 옛 이름 명시" "$(OMK_DGX_MODEL=qwen3.8-27b FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "고정: .env" "$(envv OMK_DGX_MODEL)|$(envv OMK_DGX_MODEL_PINNED)|$(envv LLM_DEFAULT_MODEL)" "qwen3.8-27b|1|qwen3.8-27b"
eq "고정: 정식·호환 라우트 upstream 모두 openai/qwen3.8-27b" "$(grep -c 'openai/chat-next' "$CFG")|$(grep -cxF '      model: "openai/qwen3.8-27b"' "$CFG")" "0|3"
S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "고정 유지: 다음 배포(served 에 새 이름 있음)" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "고정 유지: 무변경" "$(sum "$CFG")|$(sum "$APP/.env")" "$S_CFG|$S_ENV"
eq "고정값 미서빙: 종료 2(빌드 전)" "$(FAKE_VLLM='chat-next' run)|$(n_of '^build')" "2|0"
cp "$CFG" "$TMP/cfg-first.yaml"
eq "auto: 해제" "$(OMK_DGX_MODEL=auto FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "auto: 감지값으로 돌아간다" "$(envv OMK_DGX_MODEL)|$(envv OMK_DGX_MODEL_PINNED)|$(envv LLM_DEFAULT_MODEL)|$(grep -cxF '      model: "openai/chat-next"' "$CFG")" "chat-next|0|chat-next|3"

# ── 8. 앱 기본 모델이 DGX 이름이 아님 → 경고, 무변경 ──
setup "$REPO_CFG" 'LLM_DEFAULT_MODEL=openrouter/x\n'; S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "비DGX 앱 기본값: 배포 계속" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
ok "비DGX 앱 기본값: 경고" 'grep -q "WARN.*LLM_DEFAULT_MODEL=openrouter/x.*자동으로 바꾸지 않습니다" "$OUT"'
eq "비DGX 앱 기본값: 무변경" "$(sum "$CFG")|$(sum "$APP/.env")" "$S_CFG|$S_ENV"

# ── 9. 게이트웨이 PM2 앱 미등록 → 경고, config 미편집, vLLM 미호출 ──
setup "$REPO_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'; S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "게이트웨이 미등록: 배포 계속" "$(FAKE_PM2_APPS='openmake-llm' FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
ok "게이트웨이 미등록: 경고" 'grep -q "WARN.*게이트웨이 PM2 앱(gw)이 등록돼 있지 않아" "$OUT"'
eq "게이트웨이 미등록: 무변경·curl 없음" "$(sum "$CFG")|$(sum "$APP/.env")|$(n_of '^curl')" "$S_CFG|$S_ENV|0"

# ── 10. config 형태 불인식(model_list: → models:) → 경고, 백업 없음, 무변경 ──
sed 's/^model_list:/models:/' "$REPO_CFG" > "$TMP/bad.yaml"; setup "$TMP/bad.yaml" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'
S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "형태 불인식: 배포 계속" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
ok "형태 불인식: 경고" 'grep -q "WARN.*DGX 항목(openai/qwen3.8-27b)을 찾지 못해" "$OUT"'
eq "형태 불인식: 무변경·백업 없음" "$(sum "$CFG")|$(sum "$APP/.env")|$(baks)" "$S_CFG|$S_ENV|0"

# ── 11. 게이트웨이가 새 이름을 끝까지 올리지 않음 → 백업 복원·재시작 2회, .env 그대로 ──
setup "$REPO_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'; S_ENV="$(sum "$APP/.env")"
eq "게이트웨이 실패: 배포 계속" "$(FAKE_GW_STUCK=1 FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "게이트웨이 실패: config 복원·재시작 2회·.env 그대로" "$(sum "$CFG")|$(n_of '^pm2 restart gw')|$(sum "$APP/.env")" "$(sum "$REPO_CFG")|2|$S_ENV"
ok "게이트웨이 실패: 경고" 'grep -q "WARN.*게이트웨이(gw)가 chat-next 를 올리지 않아 config 를 백업으로 되돌리고" "$OUT"'
eq "게이트웨이 실패: 앱은 옛 이름으로 재시작·pm2 save 없음" "$(grep '^pm2_restart_app' "$LOG")|$(n_of '^pm2 save')" "pm2_restart_app openmake-llm app=qwen3.8-27b|0"

# ── 13. 앵커 항목의 api_base 가 os.environ/… — 배포 셸에 없으면 경고·무변경, 있으면 그 값으로 ──
sed "s#$VBASE#os.environ/QWEN_VLLM_API_BASE_X#" "$REPO_CFG" > "$TMP/envbase.yaml"; setup "$TMP/envbase.yaml" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'
S_CFG="$(sum "$CFG")"; S_ENV="$(sum "$APP/.env")"
eq "os.environ 주소 없음: 배포 계속" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
ok "os.environ 주소 없음: 경고" 'grep -q "WARN.*api_base 가 os.environ/QWEN_VLLM_API_BASE_X 인데 값을 알 수 없어" "$OUT"'
eq "os.environ 주소 없음: 무변경·curl 없음" "$(sum "$CFG")|$(sum "$APP/.env")|$(n_of '^curl')" "$S_CFG|$S_ENV|0"
: > "$LOG"
( cd "$APP" && PATH="$BIN:$PATH" PM2_HOME="$PM2H" FAKE_LOG="$LOG" FAKE_APP="$APP" FAKE_CFG="$CFG" FAKE_CFG_FIRST="$TMP/cfg-first.yaml" \
  FAKE_VKEY="$VKEY" FAKE_GKEY="$GKEY" FAKE_GWURL="$GWURL" FAKE_VLLM='qwen3.8-27b chat-next' QWEN_VLLM_API_BASE_X="http://envbase.test:8002/v1" \
  "$BASH" "$APP/openmake_llm.sh" deploy --yes </dev/null >"$OUT" 2>&1 ); cat "$OUT" >> "$ALL"
eq "os.environ 주소 있음: 그 주소로 감지·전환" "$(grep -c '^curl http://envbase.test:8002/v1/models auth=vllm' "$LOG" | tr -d ' ')|$(envv LLM_DEFAULT_MODEL)" "2|chat-next"
ok "os.environ 주소 있음: 새 항목의 api_base 도 같은 os.environ 줄" 'grep -A4 "^  - model_name: \"chat-next\"" "$CFG" | grep -q "api_base: os.environ/QWEN_VLLM_API_BASE_X"'

# ── 15. PM2 env 와 .env 의 LLM_DEFAULT_MODEL 비교(진단만) ──
setup "$OPS_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-flash-next\n'
eq "PM2 env 다름: 배포 성공" "$(FAKE_PM2_MODEL=stale-name FAKE_VLLM='qwen3.8-27b qwen3.8-flash-next' run)" "0"
ok "PM2 env 다름: 경고" 'grep -q "WARN.*PM2 env 의 LLM_DEFAULT_MODEL(stale-name)이 .env(qwen3.8-flash-next)와 다릅니다" "$OUT"'
eq "PM2 env 같음: 배포 성공" "$(FAKE_VLLM='qwen3.8-27b qwen3.8-flash-next' run)" "0"
ok "PM2 env 같음: 경고 없음" '! grep -q "PM2 env 의" "$OUT"'

# ── 16. pm2 save 는 앱 기본 모델을 바꾼 배포만(3 에서 1회, 2·14 에서 0회 — 위에서 확인), dump 의 앱을 잃게 되면 저장하지 않는다 ──
setup "$REPO_CFG" 'LLM_DEFAULT_MODEL=qwen3.8-27b\n'
printf '[{"name":"openmake-llm"},{"name":"gw"},{"name":"other-app"}]' > "$PM2H/dump.pm2"
eq "dump 손실: 배포 성공" "$(FAKE_VLLM='qwen3.8-27b chat-next' run)" "0"
eq "dump 손실: 모델은 바뀌었지만 pm2 save 없음" "$(envv LLM_DEFAULT_MODEL)|$(n_of '^pm2 save')" "chat-next|0"
ok "dump 손실: 경고" 'grep -q "WARN.*저장된 PM2 앱이 지금 실행 중이 아닙니다: other-app" "$OUT"'
rm -f "$PM2H/dump.pm2"

# ── 12. 키는 어떤 출력에도 없다 ──
eq "키 미출력: vLLM 키·게이트웨이 키" "$(grep -cF -e "$VKEY" -e "$GKEY" "$ALL" | tr -d ' ')" "0"

printf 'deploy-dgx-sync: %d passed, %d failed\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
