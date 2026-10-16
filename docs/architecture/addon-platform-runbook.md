# Add-on 플랫폼 운영 runbook — 단계 배포·관찰·롤백

> 대상: add-on 경계 3차 묶음(수명주기·계약 패키지·데이터 포트·레거시 권한 상태·Knowledge 별도 worker·검증 도구)이 들어간 릴리스. 설계 근거는 `docs/architecture/addon-platform.md`(§7.3 수명주기, §8.3 실행 판정, §9 작업 큐, §11 권한 상태, §12 경로별 책임표, §13 증거 규약).
> 환경 이름은 로컬 / 개발 / 스테이징 / 운영 네 가지로만 쓴다. 명령의 `<…>` 는 그 환경에서 정하는 값이다(설치 경로·포트·관리자 쿠키). 비밀값은 이 문서와 증거에 적지 않는다.

## 0. 완료의 세 단계

| 단계 | 뜻 | 닫는 증거 |
|---|---|---|
| 코드 완료 | 코드·테스트·문서가 브랜치 dev 에 머지되고 CI 가 통과, 릴리스 후보 보고서가 있다 | PR 번호·CI run, `task-11/release-candidate.md` 판정 |
| 배포 완료 | 운영 프로세스가 릴리스 SHA 로 돌고 있다 | 운영 `/health` 의 `build`(SHA·태그), 프로세스 목록, 마이그레이션 상태 |
| 운영 완료 | 관찰 기간(§5)을 중단 없이 넘겼고 롤백 훈련(§7.4)과 복원 확인(§8)을 했으며 F1~F4(부록 A)가 승인됐다 | `task-12/deployment-receipt.md`, `operations-handoff.md` |

이 묶음은 **코드 완료까지**다(설계 D7). 배포 완료·운영 완료는 사용자 승인과 달력 시간이 필요하며, 아래 §11 표에 날짜가 채워지기 전에는 "운영 반영" 이라고 보고하지 않는다. 스테이징·운영 배포, 관찰, 롤백 훈련은 사용자 승인 뒤에만 실행한다 — 그 전까지 §11 의 "배포 완료"·"운영 완료" 칸은 비워 둔다.

## 1. 구조도

```
                    ┌──────────────────────── API 프로세스 (PM2 openmake-llm, fork 1개) ───────────────────────┐
 브라우저/앱 ─HTTP─▶│ routes ──addonGuard──▶ add-on 라우트           채팅 턴(WS·REST) ──integrationGate──▶ 기능 훅 │
 API 키   ──/v1───▶│   │                                              │ 동기 훅: 상태 캐시(isAddonEnabledSync)        │
                    │   ▼                                              ▼ 보호 훅: isSessionMemoryIsolated(계속 돈다)  │
                    │ Base(services/addon: addon-state·entitlement)  Add-on Host(addon-host: 부팅·lifecycle·handle)│
                    │   │                                              │  handle.stop({drain}) / resume()            │
                    │   │      Knowledge poller (inprocess 모드일 때만 claim)   MCP supervisor   Skill seed        │
                    └───┼──────────────────────────┬───────────────────────────────────────────────────────────────┘
                        │                          │ claim(모드·generation 대조, actor·사용권 재검사)
                        ▼                          ▼
                 PostgreSQL ── addon_installations · user_extensions(permission_state) · knowledge_ingestion_jobs
                        ▲                          ▲   knowledge_worker_mode(mode, generation) · knowledge_worker_heartbeats
                        │                          │
                    ┌───┴──────────────────────────┴───┐
                    │ Knowledge worker (PM2 openmake-knowledge-worker) │  external 모드일 때만 기동
                    │  /health(KNOWLEDGE_WORKER_HEALTH_PORT) · heartbeat 행 │
                    └──────────────────────────────────┘
```

## 2. 권한·상태표

| 축 | 값 | 저장 위치 | 바꾸는 방법 | 반영 시점 |
|---|---|---|---|---|
| add-on 의도 | `installed`·`enabled`·`disabled`·`failed` | `addon_installations.state` | 관리 화면 / `PATCH /api/admin/addons/:addonId/state` | 라우트·기능 훅: 다음 요청. 동기 훅: 캐시 TTL(`ADDON_STATE_CACHE_TTL_MS`, 기본 30초) 뒤 |
| 런타임 상태 | `not_loaded`·`registering`·`ready`·`stopping`·`stopped`·`failed` | 프로세스 메모리 | 토글(같은 프로세스) · 재시작 | 토글 응답 `runtime`: `stopped`·`resumed`·`restart_required`·`unchanged`·`not_loaded` |
| 실효 가용성 | `available`·`disabled`·`not_ready`·`failed`·`incompatible`·`state_unknown` | 계산값 | — | 라우트 응답 404 `ADDON_DISABLED`·503 `ADDON_FAILED`·403 `ADDON_NOT_ENTITLED`·503 `ADDON_STATE_UNKNOWN` |
| 조직 사용권 | `ADDON_ALLOWLIST` 정책 | `organization_policies` | 조직 관리자 | 조직 캐시 `ORG_CONTEXT_CACHE_TTL_MS`(기본 60초) 뒤 |
| 설치형 확장 권한 | `reviewed`·`legacy_unreviewed`·`review_required` | `user_extensions.permission_state`, `permissions_granted`, `permissions_requested` | 소유자·관리자 `POST /api/users/me/extensions/:id/permissions/approve`·`…/revoke` | API 응답은 즉시. MCP 서버 반영은 다음 기동부터 |
| Knowledge 소비자 모드 | `inprocess`·`external` + `generation` | `knowledge_worker_mode` 1행 | `scripts/knowledge-worker-mode.sh set <모드>`(generation+1) | 다음 claim 부터(모드가 다른 소비자는 집지 않는다) |
| Knowledge 작업 | `queued`·`running`·`done`·`failed`·`cancelled` | `knowledge_ingestion_jobs.state`, `cancel_requested_at` | 취소 `POST /api/knowledge/jobs/:id/cancel`(소유자·관리자) | 대기 작업 즉시, 실행 중 작업은 heartbeat 한 주기 안 |

## 3. 단계 배포

운영은 PM2 `openmake-llm` fork 1개(`instances: 1`)다. 무중단 전환·트래픽 비율 canary 는 없다 — "canary" 는 새 빌드를 **별도 포트**(`CANARY_HEALTH_PORT`, 기본 API 포트+1000)에서 먼저 기동해 헬스만 확인하는 단계다(`openmake_llm.sh` `cmd_canary_deploy`). 불가능한 트래픽 canary 를 완료로 보고하지 않는다.

**순서: 스테이징 → (스테이징 관찰 24시간) → 운영 canary 포트 기동 확인 → 운영 전환(유지보수 창) → 운영 관찰.** Knowledge worker 의 `external` 전환은 이 순서와 **분리된 별도 승인 단계**(§3.4)다 — 릴리스 배포는 `inprocess` 그대로 한다.

### 3.1 배포 전 preflight (스테이징·운영 공통)

Run(대상 환경의 설치 경로에서):
```bash
cd <설치 경로>
git fetch --tags && git rev-parse HEAD && git describe --tags
( cd apps/api && npx ts-node src/data/migrations/cli.ts status ) | tail -5
grep -c '^KNOWLEDGE_WORKER_MODE=external' .env || echo worker-mode-env-not-external
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(a=>`${a.name}:${a.pm2_env.status}`).join(" ")))'
psql "$DATABASE_URL" -tAc "SELECT mode, generation FROM knowledge_worker_mode"
psql "$DATABASE_URL" -tAc "SELECT addon_id, state FROM addon_installations ORDER BY addon_id"
```
Expected:
- 배포할 SHA·태그가 릴리스 후보 보고서(`task-11/release-candidate.md`)의 SHA 와 같다.
- 마이그레이션 status 에 `190_user_extensions_permission_state` 가 "pending" 또는 "applied" 로 보인다(처음 배포면 pending). add-on 마이그레이션 `004_jobs_actor_cancel_mode` 는 API 부팅이 적용한다.
- `worker-mode-env-not-external`(또는 `0`) — 릴리스 배포 시점에 `.env` 의 `KNOWLEDGE_WORKER_MODE` 는 없거나 `inprocess` 다.
- PM2 목록에 `openmake-llm:online`, 웹 앱 online, `openmake-knowledge-worker` 는 **없다**(external 전환 전에는 등록되지 않는다).
- `knowledge_worker_mode` 는 처음 배포면 표가 아직 없어 오류(`relation … does not exist`)이고, 재배포면 `inprocess|<n>`.
- add-on 상태 목록을 증거(`task-12/preflight-<환경>.txt`)로 저장한다 — 배포 뒤 같은 목록이어야 한다.

중단 기준: SHA 불일치, `KNOWLEDGE_WORKER_MODE=external` 이 이미 설정돼 있음, `openmake-llm` 이 online 이 아님.

### 3.2 스테이징 배포

Run:
```bash
cd <스테이징 설치 경로>
./scripts/backups/db-backup.sh
./openmake_llm.sh canary-deploy --dry-run
./openmake_llm.sh canary-deploy --yes
curl -fsS http://127.0.0.1:<API 포트>/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s).data;console.log(b.version,b.build&&b.build.gitSha)})'
curl -fsS http://127.0.0.1:<API 포트>/api/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).knowledge)))'
```
Expected: 백업 파일 경로 출력, dry-run 이 1)~6) 순서를 출력, canary-deploy exit 0(카나리 헬스 → 전환 → 전환 후 헬스 통과), `/health` 의 버전·SHA 가 릴리스 값, `/api/health` 의 `knowledge` 가 `{"mode":"inprocess","generation":<n>,"workerHeartbeatAgeMs":<15000 미만>,"queueOldestAgeMs":<null 또는 숫자>,"inflight":<0 이상>}`.

스테이징 기능 확인(배포 직후 1회):
```bash
cd <스테이징 저장소 체크아웃>
E2E_BASE_URL=http://127.0.0.1:<스테이징 API 포트> TEST_DATABASE_URL=<스테이징 DB URL> \
  npx playwright test tests/e2e/plugin-boundary.spec.ts tests/e2e/extension-permissions.spec.ts --project=chromium
```
`--project=chromium` 으로만 돈다 — webkit 브라우저는 로컬에 설치돼 있지 않다(`playwright.config.ts` 의 webkit 프로젝트는 쓰지 않는다). `E2E_BASE_URL` 은 셸 값이 `tests/e2e/.env.e2e` 보다 우선한다.
Expected: 모두 passed. 스테이징 API 가 `USER_MEMORY_AUTO_EXTRACT=true`·`ORG_CONTEXT_CACHE_TTL_MS=1000` 이 아니면 plugin-boundary 의 메모리·조직 테스트는 대조군 단계에서 실패한다 — 그 경우 이 두 테스트 결과는 "환경 불일치" 로 기록하고, 메모리 격리는 §5 의 SQL 감시로 확인한다.

스테이징 성능 기준선(빌드 산출물, 같은 부하):
```bash
BENCH_ADMIN_EMAIL=<스테이징 관리자> BENCH_ADMIN_PASSWORD=<…> npm run bench:api -- \
  --base-url http://127.0.0.1:<API 포트> --label staging-before --target-sha <이전 SHA> --environment 스테이징 --runtime node-dist \
  --out .omo/evidence/base-plugin-separation/<run-id>/task-12/staging-before.json
```
이전 SHA 로 한 번(배포 전), 새 SHA 로 한 번(배포 후, `--label staging-after`) 재고 `npm run bench:compare -- --baseline …/staging-before.json --current …/staging-after.json` 이 exit 0 이어야 한다. 대상 API 를 일반 리미터 해제(`RL_GENERAL_IP`·`RL_GENERAL_USER`) 없이 재면 429 가 오류율로 잡혀 비교가 무효가 된다 — 스테이징에서는 측정 동안만 두 env 를 크게 잡아 재시작하고, 측정 뒤 원래 값으로 되돌린다.

### 3.3 운영 전환(유지보수 창)

스테이징 관찰 24시간(§5)이 중단 기준 없이 지났을 때만 한다.
```bash
cd <운영 설치 경로>
./scripts/backups/db-backup.sh
./openmake_llm.sh canary-deploy --dry-run
./openmake_llm.sh canary-deploy --yes
```
Expected: §3.2 와 같은 출력. 전환 후 헬스 실패 시 스크립트가 직전 빌드로 되돌린다(코드만 — 마이그레이션은 되돌리지 않는다, §7.3).

전환 직후 확인:
```bash
curl -fsS http://127.0.0.1:<API 포트>/api/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);console.log(b.status, JSON.stringify(b.knowledge))})'
psql "$DATABASE_URL" -tAc "SELECT addon_id, state FROM addon_installations ORDER BY addon_id" | diff - <(cat .omo/evidence/base-plugin-separation/<run-id>/task-12/preflight-운영.txt) && echo addon-states-unchanged
psql "$DATABASE_URL" -tAc "SELECT permission_state, count(*) FROM user_extensions GROUP BY permission_state ORDER BY 1"
```
Expected: `ok {"mode":"inprocess",…}`, `addon-states-unchanged`, 권한 상태 분포(처음 배포면 `legacy_unreviewed` 와 manifest 가 있던 행의 `reviewed`; `review_required` 는 0 이어야 한다 — 배포만으로 권한이 바뀌지 않는다).

### 3.4 Knowledge worker external 전환(별도 승인)

릴리스 운영 관찰 48시간이 끝난 뒤, 별도 승인으로만 한다. 순서는 `docs/architecture/addon-platform.md` §9.6 그대로다 — **`.env` 의 `KNOWLEDGE_WORKER_MODE` 를 목표 모드로 먼저 바꾸고 → 드릴 스크립트를 실행 → 실패하면 반대 방향으로 되돌리고 `.env` 도 되돌린다.** 드릴은 시작 전(① 앞)과 ④ 직전에 `.env` 의 `KNOWLEDGE_WORKER_MODE`(없으면 inprocess)가 목표인지 보고 다르면 7 로 멈춘다. `.env` 값은 따옴표 없이 쓴다(`KNOWLEDGE_WORKER_MODE=external`) — 드릴은 그 줄을 grep 으로 읽어 따옴표까지 값으로 본다. 드릴의 접속·대상은 환경변수다: `DATABASE_URL`(또는 `KNOWLEDGE_PSQL`), API 포트가 기본과 다르면 `KNOWLEDGE_API_HEALTH_URL`(`http://127.0.0.1:<API 포트>/api/health`), 인스턴스가 있으면 `OMK_INSTANCE`.

1. `.env` 의 `KNOWLEDGE_WORKER_MODE` 줄을 `KNOWLEDGE_WORKER_MODE=external` 로 바꾼다(없으면 추가). worker `/health` 를 보려면 `KNOWLEDGE_WORKER_HEALTH_PORT` 도 0 이 아닌 포트로 둔다(기본 0 = 끔). 떠 있는 API 는 재시작 전까지 `.env` 를 다시 읽지 않으므로 이 단계만으로는 아무것도 바뀌지 않는다.
2. 실행:
```bash
cd <설치 경로>
bash scripts/knowledge-worker-mode.sh show
DRILL_DRY_RUN=1 bash scripts/knowledge-worker-rollback-drill.sh to-external
bash scripts/knowledge-worker-rollback-drill.sh to-external; echo "exit=$?"
curl -fsS http://127.0.0.1:<KNOWLEDGE_WORKER_HEALTH_PORT>/health
pm2 save
```
Expected: dry-run 이 시작 전 확인과 ①~④ 순서를 출력, 실제 실행 `exit=0`(끝 줄 "완료. DB 모드와 .env 의 KNOWLEDGE_WORKER_MODE=external 가 같다"), worker `/health` 가 `"kind":"external"`·`"dbMode":"external"`. `pm2 save` 는 `exit=0` 뒤에만 한다 — worker 앱 등록이 재부팅 뒤에도 남는다.

종료 코드(드릴 머리말): `0` 성공 · `2` 사용법·도구 없음 · `3` DB 오류 · `4` lease 대기 초과 · `5` generation 불일치 · `6` 헬스 확인 실패 · `7` `.env` 의 `KNOWLEDGE_WORKER_MODE` 가 목표와 다름 · `8` 단계 명령(API 재시작·worker 기동) 실패.
- 시작 전 확인에서 난 `7`(또는 `2`)은 아무것도 바꾸지 않은 상태다 — `.env` 를 고쳐 다시 실행한다.
- ① 뒤 실패(`3`~`8`, ④ 직전의 `7` 포함)는 드릴이 복구 안내 한 줄을 남긴다. 원인을 바로 고칠 수 없으면 반대 방향으로 되돌린다: `.env` 를 `KNOWLEDGE_WORKER_MODE=inprocess` 로 되돌리고 `bash scripts/knowledge-worker-rollback-drill.sh to-inprocess`(§7.1). 같은 방향을 다시 실행하는 것도 안전하다(① 은 generation 만 하나 더 올린다).
- worker 가 뜨지 않으면 종료 코드를 본다(설계 문서 §9.5): `78` 은 설정 오류(add-on 마이그레이션 004 행 없음·`ADDON_BUILTIN_DISABLED` 로 꺼짐·`KNOWLEDGE_WORKER_HEALTH_PORT` 를 묶지 못함)라 PM2 가 다시 띄우지 않는다. 스키마 확인 조회의 DB 오류는 78 이 아니라 대기 상한 뒤 `1` 로 끝나 PM2 가 다시 띄운다. worker 로그는 API 로그와 따로 `apps/api/logs/knowledge-worker-combined.log`·`knowledge-worker-error.log` 다.

## 4. 관측 항목

헬스 엔드포인트는 둘이다. `/health` 는 버전·`build`(SHA·태그)를, `/api/health` 는 `knowledge` 절(모드·generation·heartbeat 나이·최장 대기·진행 중 건수 — 인증 없이 보인다)과 관리자 쿠키로 부를 때만 붙는 `process` 필드(pid·rss·heapUsed·uptimeSec)를 준다. 아래 조회의 `knowledge`·`process` 는 모두 `/api/health` 다.

| 항목 | 조회 | 정상 | 중단 기준 |
|---|---|---|---|
| admission 거절 사유 | `pm2 logs openmake-llm --nostream --lines 5000 \| grep -c "컨텍스트 준비 건너뜀"` 와 `… \| grep -oE "ADDON_(DISABLED\|FAILED\|NOT_ENTITLED\|STATE_UNKNOWN)" \| sort \| uniq -c` | 관리자가 끈 add-on 에 대해서만 나온다 | `ADDON_STATE_UNKNOWN` 이 5분 넘게 계속 나온다(상태 조회 장애) — 즉시 중단 |
| add-on 런타임 active/draining | `curl -fsS -H "Cookie: <관리자 쿠키>" http://127.0.0.1:<API 포트>/api/admin/addons` 의 각 항목 `runtimeStatus` | 켜진 add-on 은 `ready`, 끈 것은 `stopped` | `stopping` 이 `ADDON_DRAIN_TIMEOUT_MS`(기본 5초) × 10 넘게 남는다 |
| worker heartbeat | `/api/health` 의 `knowledge.workerHeartbeatAgeMs`, SQL `SELECT worker_id, mode, generation, EXTRACT(EPOCH FROM now()-last_seen)::int AS age_s, inflight FROM knowledge_worker_heartbeats ORDER BY last_seen DESC LIMIT 5` | `KNOWLEDGE_WORKER_HEARTBEAT_STALE_MS`(기본 15000) 미만 | null 또는 15000 이상이 15분 간격 연속 3회 |
| lease 재할당 | SQL `SELECT count(*) FROM knowledge_ingestion_jobs WHERE fencing_token >= 2 AND state IN ('queued','running')` | 0 또는 배포·재시작 직후 잠깐 | 1시간 안에 줄지 않고 늘어난다(연속 3회 측정) |
| 큐 나이 | `/api/health` 의 `knowledge.queueOldestAgeMs`, SQL `SELECT state, count(*) FROM knowledge_ingestion_jobs GROUP BY state` | 600000(10분) 미만 | 600000 이상이 연속 3회 |
| 오류율·p95 | 스테이징: §3.2 의 `bench:api`·`bench:compare`. 운영: 한산한 시간에 `npm run bench:api -- --connections 2 --duration 30 --warmup 5 --scenarios health,knowledge-spaces --environment 운영 --runtime node-dist …` | `bench:compare` exit 0(p95 +10% 이내, 처리율 95% 이상, 오류율 1% 이하) | exit 1 이 연속 3회 측정(각 15분 간격) |
| RSS | `curl -fsS -H "Cookie: <관리자 쿠키>" http://127.0.0.1:<API 포트>/api/health` 의 `process.rss`(관리자만), 공개 `services.memory.rssMB` | 배포 전 값 × 1.10 이하 | 초과가 15분 간격 연속 3회 |
| 메모리 격리(정합성) | `user_memories` 는 원 대화 id 를 저장하지 않아 SQL 로 출처를 가를 수 없다. 로그 `pm2 logs openmake-llm --nostream --lines 5000 \| grep -c "메모리 격리 판정 실패"`(판정 오류 시 격리로 간주한 횟수)와 §3.2 의 plugin-boundary 메모리 테스트 결과로 본다 | 판정 실패 0, 메모리 테스트 통과 | 연결 대화의 메시지가 `user_memories` 에 들어간 사례가 하나라도 확인됨 — 즉시 중단 |
| 확장 권한(보안) | SQL `SELECT permission_state, count(*) FROM user_extensions GROUP BY 1`, 로그 `grep -c "PERMISSION_REVIEW_REQUIRED"` | 배포 직후 분포와 같다. `review_required` 확장의 초과 권한 실행 0 | `review_required` 확장이 초과 권한으로 네트워크를 쓴 흔적 — 즉시 중단 |

**즉시 중단(보안·정합성)**: 꺼진 add-on 라우트가 200 으로 응답, 다른 사용자의 Space·문서가 보임, 연결 대화의 메시지가 전역 메모리로 들어감, lease 를 잃은 실행자의 확정 쓰기(같은 문서 버전에 서로 다른 fencing token 의 청크가 섞임), `review_required` 확장의 초과 권한 실행. 하나라도 보이면 §7 롤백을 시작한다.

**성능 이탈 중단**: 위 표의 "연속 3회(15분 간격)" 규칙. 한 번의 튐은 기록만 한다.

## 5. 관찰 기간

| 단계 | 최소 시간 | 포함해야 하는 것 |
|---|---|---|
| 스테이징 | 24시간 | 하루 피크 시간대 1회, Knowledge 정리(cleanup) 주기 1회 이상, 예약 작업(`CAPABILITY_JOB_POLLER_ENABLED=true` 인 환경) 주기 1회 이상 |
| 운영 전환 직후(제한 관찰) | 24시간 | 피크 1회, §4 표 전 항목을 15분 간격 기록 |
| 운영 전체 | 48시간 | 피크 2회, 주간 이하 빈도의 주기 작업은 실제로 돌았는지 로그로 확인 — 돌지 않았으면 "미관찰" 로 §11 표에 적는다(통과로 계산하지 않는다) |

저빈도 주기는 스테이징에서 주기 env 를 짧게 잡은 시간 제어 실행으로 보완하되, 그것도 운영 미관찰 범위로 남긴다.

## 6. 관찰 중 결정 기록

관찰 중 판단(중단·연장·계속)은 `task-12/operations-handoff.md` 에 시각·근거 수치·판단자와 함께 적는다.

## 7. 롤백

### 7.1 Knowledge 소비자 모드 롤백(external → inprocess)

§3.4 와 같은 순서다(`docs/architecture/addon-platform.md` §9.6): `.env` 를 먼저 목표 모드로 바꾸고 → 드릴 실행 → 실패하면 반대 방향 + `.env` 되돌림.

1. `.env` 의 `KNOWLEDGE_WORKER_MODE` 줄을 `KNOWLEDGE_WORKER_MODE=inprocess`(따옴표 없이)로 바꾸거나 지운다(없으면 inprocess 로 본다).
2. 실행:
```bash
cd <설치 경로>
DRILL_DRY_RUN=1 bash scripts/knowledge-worker-rollback-drill.sh to-inprocess
bash scripts/knowledge-worker-rollback-drill.sh to-inprocess; echo "exit=$?"
bash scripts/knowledge-worker-mode.sh show
pm2 jlist | grep -c openmake-knowledge-worker
pm2 save
```
Expected: 시작 전 `.env` 확인 → ① mode=inprocess·generation+1(별도 worker 의 새 claim 즉시 차단) ② worker 정지(SIGTERM → drain) ③ 살아 있는 lease 0·generation 확인 ④ `.env` 재확인 → API 재시작(`KNOWLEDGE_WORKER_MODE=inprocess`)·`/api/health` 헬스 → worker 등록 삭제 순서로 진행, `exit=0`, `show` 의 모드 `inprocess`·generation `<n+1>`, worker 앱 `0`. `pm2 save` 는 `exit=0` 뒤에만 한다.

실패 시: 종료 코드는 §3.4 와 같다(0 · 2~8). 드릴이 남긴 복구 안내대로 원인을 고쳐 `to-inprocess` 를 다시 실행하는 것이 기본이다(별도 worker 가 내려가 있고 API 가 inprocess 설정으로 떠야 수집이 재개된다). 원인을 바로 고칠 수 없고 external 로 돌아가야 수집이 이어지면 반대 방향으로 간다: `.env` 를 `KNOWLEDGE_WORKER_MODE=external` 로 되돌리고 `bash scripts/knowledge-worker-rollback-drill.sh to-external`.

### 7.2 코드 롤백

```bash
cd <설치 경로>
ls -1t .releases/pre-canary-*.tar.gz | head -3
```
canary-deploy 는 전환 후 헬스 실패 시 자동으로 직전 빌드로 되돌린다. 관찰 중 롤백은 직전 릴리스 태그로 다시 배포한다: `git checkout <직전 태그> && ./openmake_llm.sh canary-deploy --yes --no-migrate`. external 모드였다면 **먼저 §7.1** 을 한다 — 004 이전 코드는 모드 표를 모른다.

### 7.3 마이그레이션 롤백

| 마이그레이션 | 롤백 파일 | 되돌리면 잃는 것 | 기본 판단 |
|---|---|---|---|
| `db/migrations/190_user_extensions_permission_state.sql` | `db/migrations/rollbacks/190_user_extensions_permission_state_rollback.sql` | 권한 상태·승인 기록 전체(재승인 이력) | 하지 않는다 — 열은 additive 라 이전 코드가 무시한다 |
| `apps/api/addons/builtin/knowledge-runtime/migrations/004_jobs_actor_cancel_mode.sql` | 없음 | — | 하지 않는다 — additive. 이전 코드는 새 열·표를 쓰지 않는다. `cancelled` 상태 행은 남는다(§10 잔여 위험 12) |

190 을 되돌려야만 하는 경우(열 자체가 장애 원인으로 확인된 경우)에만, 스테이징 복제본에서 먼저:
```bash
pg_dump "$DATABASE_URL" -t user_extensions -Fc -f <백업 경로>/user_extensions-before-190-rollback.dump
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/rollbacks/190_user_extensions_permission_state_rollback.sql
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='user_extensions' AND column_name='permission_state'"
```
Expected: 덤프 파일 생성, 롤백 exit 0, 마지막 값 `0`.

### 7.4 롤백 훈련(운영 완료 조건)

스테이징에서 한 번: §3.4 to-external → 업로드 1건 처리 확인 → §7.1 to-inprocess → 업로드 1건 처리 확인 → §7.2 직전 태그로 코드 롤백 → `/health` 버전 확인 → 릴리스 태그로 재배포. 각 명령의 exit 와 소요를 `task-12/rollback-drill.txt` 에 남긴다.

## 8. backup 복원과 재승인 상태 보존 확인(스테이징)

```bash
cd <스테이징 설치 경로>
psql "$DATABASE_URL" -tAc "SELECT id, permission_state, permissions_granted::text, permissions_reviewed_at FROM user_extensions ORDER BY id" > /tmp/ext-before.txt
psql "$DATABASE_URL" -tAc "SELECT addon_id, state FROM addon_installations ORDER BY addon_id; SELECT mode, generation FROM knowledge_worker_mode" > /tmp/state-before.txt
./scripts/backups/db-backup.sh
./scripts/backups/db-restore.sh --latest --dry-run
./scripts/backups/db-restore.sh --latest --yes
psql "$DATABASE_URL" -tAc "SELECT id, permission_state, permissions_granted::text, permissions_reviewed_at FROM user_extensions ORDER BY id" | diff /tmp/ext-before.txt - && echo permissions-preserved
psql "$DATABASE_URL" -tAc "SELECT addon_id, state FROM addon_installations ORDER BY addon_id; SELECT mode, generation FROM knowledge_worker_mode" | diff /tmp/state-before.txt - && echo states-preserved
```
Expected: dry-run 이 복원할 파일을 보여 주고, 복원 뒤 `permissions-preserved`·`states-preserved`. 복원은 대상 DB 를 통째로 바꾸므로(`db-restore.sh` 머리말) 스테이징에서만 한다. 문서 파일 저장소(Knowledge 업로드)는 DB 덤프에 없다 — 파일 백업 경로의 복원은 그 환경의 파일 백업 절차로 하고, 복원 뒤 `SELECT count(*) FROM knowledge_documents WHERE status='ready'` 의 문서 하나를 열어 본다.

## 9. 플러그인 개발 가이드

1. **계약만 import 한다**: `import type { AddonRuntimeHandle, AddonRuntimeHost, Actor, AddonAvailability } from '@openmake/plugin-contracts';` — `apps/api` 안에서는 `import type` 만 허용된다(eslint). 앱 내부(`data/**`·`services/**`·`routes/**`·`sockets/**`·`controllers/**`·`middlewares/**`·`auth/**`·`chat/**`) 직접 import 는 `npm run check:addon-boundary` 가 새 쌍이면 실패시킨다(래칫, 설계 문서 §8.5).
2. **매니페스트**(`apps/api/addons/builtin/<id>/openmake-addon.json`): `entry.routes`(전용 라우트, `addonGuard` 가 자동으로 붙는다), `entry.chatIntegration`(채팅 턴 통합), `entry.runtime`(부팅 진입점), `entry.workers`(별도 프로세스 진입점, 최대 5개, 이름 `^[a-z][a-z0-9-]*$`), `entry.contributions`, `addonPermissions`(`network:internet`·`database:addon`).
3. **수명주기 handle**: 런타임 진입점은 handle 을 돌려준다. 새 일 받기를 멈추는 것(stop-admission)과 진행 중 일을 기다리는 것(drain)을 나눈다. 타이머는 `host.setInterval`/`host.setTimeout` 으로 걸어야 시작 실패·종료 때 회수된다. 긴 초기화는 단계마다 `host.signal.aborted` 를 본다.
```ts
import type { AddonRuntimeHandle, AddonRuntimeHost } from '@openmake/plugin-contracts';

export async function startExampleRuntime(host: AddonRuntimeHost): Promise<AddonRuntimeHandle> {
    let accepting = true;
    const inflight = new Set<Promise<void>>();
    host.setInterval(() => {
        if (!accepting || host.signal.aborted) return;
        const unit: Promise<void> = processOneUnit(host.signal).finally(() => { inflight.delete(unit); });
        inflight.add(unit);
    }, 5_000);
    return {
        async stop({ drain, signal }) {
            accepting = false;
            if (!drain) return;
            await Promise.race([
                Promise.allSettled([...inflight]),
                new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
            ]);
        },
        async resume() { accepting = true; },
        health() { return { status: accepting ? 'running' : 'stopped', inflight: inflight.size }; },
    };
}

async function processOneUnit(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
}
```
4. **권한**: 네트워크·DB 를 쓰는 add-on 은 매니페스트 `addonPermissions` 에 선언한다. 설치형 확장은 선언이 승인 범위를 넘으면 `review_required` 가 되고 초과분은 소유자·관리자 재승인 전까지 막힌다(설계 문서 §11).
5. **데이터**: Base 테이블(`conversation_sessions`·`users`·`user_memories`·`organizations`)을 SQL 로 직접 읽지 않는다 — `runtime-ports/base-data-port.ts` 의 `baseDataPort.conversationSessions.{listIdsForUser, exists, ownerOf, summaries}` 를 쓴다(`addons-no-base-table-sql.test.ts` 가 검사). 자기 테이블은 `apps/api/addons/builtin/<id>/migrations/NNN_*.sql`(additive, 기존 파일 수정 금지)로 만들고 `npx ts-node apps/api/src/data/migrations/cli.ts migrate:addons` 로 적용한다.
6. **경계 검사**: 커밋 전 `npm run check:addon-boundary`, `npx jest -c apps/api/jest.config.js apps/api/src/__tests__/addons-no-base-table-sql.test.ts apps/api/src/config/__tests__/addon-boundary.test.ts`.

## 10. 잔여 위험

| # | 위험 | 출처 | 현재 완화 |
|---|---|---|---|
| 1 | 코드 언로드가 없다 — Skill Runtime 과 handle 없는 add-on 은 관리자 토글이 라우트·게이트로만 반영되고 등록(도구·스킬 주입·채팅 모드) 변경은 재시작해야 한다. MCP 를 끄면 연결은 정리되지만 포트 등록·supervisor 타이머는 재시작까지 남는다 | 수명주기 묶음 | 관리 화면 `restartNote`, 토글 응답 `restart_required` |
| 2 | 다른 프로세스(canary 포트·별도 worker)는 상태 캐시 TTL(최대 30초) 뒤에 토글을 본다. 토글과 실행 시작의 원자적 직렬화는 없다 | 수명주기 묶음(설계 문서 §7.2) | worker claim 은 매번 strict 판정 |
| 3 | DB 밖 부작용(임베딩 호출·파일 삭제·외부 MCP 호출)은 멈출 뿐 되돌리지 않는다 — exactly-once 아님 | 수명주기·worker 묶음 | fencing 으로 DB 확정 쓰기만 보호 |
| 4 | 물리 SQL 권한 격리 없음(같은 DB 의 코드 경계). add-on → Base 내부 import 는 래칫 allowlist 로 남아 있다 | 계약 묶음 | `check:addon-boundary`, Base 테이블 SQL 검사 |
| 5 | 대화 세션 밖 Base 테이블용 포트는 없다. 스킬 런타임의 스킬 스키마 SQL 은 래칫 예외 | 계약 묶음 | 필요해질 때 포트 추가 |
| 6 | `TEST_DATABASE_URL` 을 보는 `*.db.test.ts` 밖 테스트 7개(MCP 저장소·마이그레이션·라우트)는 CI Gate 1.5 밖이다 | 계약 묶음 | 후속 후보 |
| 7 | 설치형 확장 권한의 MCP 반영은 다음 기동부터. 설치 때 제외된 원격 서버는 확장을 지우고 다시 설치해야 돌아온다. 190 롤백은 승인 기록을 지운다 | 권한 묶음 | 응답의 `excludedRemoteServers`, 롤백 기본 판단 "하지 않는다" |
| 8 | e2e(`plugin-boundary`·`extension-permissions`)는 CI 에서 돌지 않는다 | 권한·검증 묶음 | 릴리스마다 로컬·스테이징 실행(§3.2) |
| 9 | 실행 중 작업 취소는 heartbeat 한 주기(기본 최대 48초) 걸린다. 사용자 화면의 "수집 취소" 버튼은 없다 | worker 묶음 | API 로 취소 가능 |
| 10 | 관리자 토글은 별도 worker 프로세스의 handle 을 직접 멈추지 않는다 | worker 묶음 | claim 게이트가 TTL 안에 막는다 |
| 11 | 다중 API 프로세스(PM2 cluster) 배치는 검증하지 않았다 | 배치 구성(`ecosystem.config.js` `instances: 1`) | 운영은 fork 1개 |
| 12 | 004 롤백 SQL 이 없다 — 코드만 되돌리면 `cancelled` 상태 행과 새 열·표가 남는다 | worker 묶음 | additive, 이전 코드는 그 행을 집지 않는다(상태 조건) |
| 13 | 로컬 부하 수치는 ts-node 로 띄운 API 라 RSS 에 컴파일러 메모리가 섞인다 | 검증 묶음 | 운영 판단용 RSS 는 스테이징 `node-dist` 로 다시 잰다(§3.2) |
| 14 | 기여 도구의 거절 문구는 모델이 그 도구를 불러야 나와 e2e 로 결정적으로 재현할 수 없다 | 검증 묶음 | Jest `orchestration-gate.test.ts` 가 문구를 고정 |
| 15 | canary 포트 기동은 "새 코드가 이 DB 에서 뜨는가" 만 본다. 전환(pm2 restart)은 짧은 다운타임이 있다 | `openmake_llm.sh` | 유지보수 창 |
| 16 | 관찰 기간 안에 돌지 않는 저빈도 주기 작업은 운영에서 미관찰로 남는다 | 로드맵 | 스테이징 시간 제어 실행, §11 표에 미관찰 범위 기록 |

## 11. 완료 기록 표

| 묶음 | 코드 완료(PR·dev 머지·CI) | 배포 완료(스테이징) | 배포 완료(운영, SHA·시각) | 운영 완료(관찰·롤백 훈련·F1~F4) |
|---|---|---|---|---|
| 수명주기 | | | | |
| 계약·데이터 포트·테스트 DB | | | | |
| 레거시 권한 | | | | |
| worker 잔여·별도 프로세스 | | | | |
| 검증·배포 문서(이 runbook) | | | | |
| Knowledge external 전환(별도 승인) | 해당 없음 | | | |

칸에는 날짜·증거 경로(`task-11/release-candidate.md`·`task-12/deployment-receipt.md`·`task-12/rollback-drill.txt`·`task-12/operations-handoff.md` 중 해당 파일)·기록자를 적는다. 빈 칸은 "아직 아님" 이다. 이 runbook 이 들어간 묶음은 코드 완료까지다 — 스테이징·운영 배포, 관찰, 롤백 훈련은 사용자 승인 뒤에만 실행하므로 "배포 완료"·"운영 완료" 칸은 그 전까지 비워 둔다.

## 부록 A. 최종 검증 F1~F4 자가 점검

모든 항목은 실제 산출물·증거·SHA 로 확인한다. 계획 문구나 테스트 개수만으로 체크하지 않는다. 미관찰·승인 대기는 미완료로 둔다.

**F1 계획 준수**
- [ ] 로드맵 작업 1~12 각각에 대해 산출물 경로와 증거(`task-N/`)가 있다 — 표로 대조한다.
- [ ] 각 묶음 PR 의 머지 SHA 가 릴리스 후보 보고서의 SHA 의 조상이다(`git merge-base --is-ancestor <PR SHA> <후보 SHA>`).
- [ ] 이상 상태 IS-1~5 각 행에 증명 시나리오의 통과 증거가 있다(IS-1 경로·토글: plugin-boundary e2e·jest-addon / IS-2 격리·drain: plugin-boundary 메모리 테스트·lifecycle Jest / IS-3 계약·포트·재승인: contract compat·base-data-port·extension-permissions / IS-4 lease·장애: db-tests 의 worker-process / IS-5 배포·관찰: §11 표).

**F2 코드 품질**
- [ ] policy·ACL·lifecycle 경합, 의존성(autocannon 추가 포함), 마이그레이션·롤백 안전성 검토에서 중대한 미해결 결함 0.
- [ ] `release-candidate.md` 의 "판단이 필요한 항목" 이 전부 수용(사유·증거) 또는 해결됐다.

**F3 실제 수동 QA**
- [ ] 실제 UI 에서 관리자 add-on 끄기 → "정지됨" 표시 → 켜기, 확장 권한 배지와 재승인 버튼을 눈으로 확인했다(스크린샷 경로 기록).
- [ ] 격리 DB 와 독립 worker 에서 disable·재승인·종료·복구를 관측했다(§7.4 훈련 기록).

**F4 이상 상태 충실도**
- [ ] 사용자·개발자·운영자 관점의 IS-1~5 를 **배포된** 결과와 1:1 로 비교했다. 운영 미배포면 F4 는 미완료다.

## 부록 B. 로컬 e2e 대상 API 띄우기

개발 스택(:52418)을 대상으로 plugin-boundary 를 돌리지 않는다 — 토글이 개발 DB 의 add-on 의도를 바꾼다. 격리 테스트 DB(:5433)에 붙인 e2e 전용 API 를 띄운다.
```bash
docker --context colima-openmake run -d --name omk-e2e-test-pg -e POSTGRES_USER=openmake -e POSTGRES_PASSWORD=openmake_test \
  -e POSTGRES_DB=openmake_llm_test -p 127.0.0.1:5433:5432 pgvector/pgvector:0.8.3-pg16-trixie
export TEST_DATABASE_URL=postgresql://openmake:openmake_test@localhost:5433/openmake_llm_test
bash scripts/setup-test-db.sh
OMK_API_PORT=52438 PORT=52438 DATABASE_URL="$TEST_DATABASE_URL" USER_MEMORY_AUTO_EXTRACT=true ORG_CONTEXT_CACHE_TTL_MS=1000 \
RL_GENERAL_IP=1000000 RL_GENERAL_USER=1000000 CAPABILITY_JOB_POLLER_ENABLED=false TS_NODE_TRANSPILE_ONLY=true \
  nohup npm --workspace apps/api run dev > /tmp/omk-e2e-api.log 2>&1 &
echo $! > /tmp/omk-e2e-api.pid
for i in $(seq 1 90); do curl -fsS http://localhost:52438/health >/dev/null 2>&1 && { echo "up after ${i}x2s"; break; }; sleep 2; done
cp tests/e2e/.env.e2e.example tests/e2e/.env.e2e
E2E_BASE_URL=http://localhost:52438 npx playwright test tests/e2e/plugin-boundary.spec.ts --project=chromium
```
Expected: `10 passed`. 로컬은 `--project=chromium` 으로만 돈다 — webkit 브라우저는 로컬에 설치돼 있지 않다.

끝나면 이 절차로 띄운 API 만 끈다 — `pkill -f` 처럼 이름으로 찾아 죽이지 않는다(개발 스택 프로세스까지 걸린다). pid 파일의 프로세스와, 남은 경우 :52438 에서 듣고 있는 프로세스만 끈다:
```bash
kill "$(cat /tmp/omk-e2e-api.pid)" 2>/dev/null; rm -f /tmp/omk-e2e-api.pid
lsof -ti tcp:52438 -sTCP:LISTEN | xargs -r kill
docker --context colima-openmake rm -f omk-e2e-test-pg
```
