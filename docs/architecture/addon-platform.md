# Add-on 플랫폼 — 경계·정책·계약

> 코드(main 184f2b3b)에서 정리한 문서(2026-10-16). 코드 주석이 참조하는 원문 "계획서"(2026-09-18~23 의 Add-on 전환 P1·P01·P03)는 저장소에 없다 — 이 문서는 그 원문을 복원한 것이 아니라 **현재 구현과 목표 계약을 코드 기준으로 적은 것**이며, 절 번호(7.1·7.2·8.3)는 주석과 맞추기 위한 것이다.

## 1. 소유 경계

| 영역 | 소유 | 코드 |
|---|---|---|
| 인증·조직 정책·승인·예산·감사·작업 상태·비밀정보·모델 전송 | Base | `auth/`, `services/org/`, `services/agent-task/`, `llm/` |
| 발견·호환성·등록·런타임 상태·부팅 절차 | Add-on Host | `addon-host/` |
| 상태 저장·사용권·실행 게이트 | Base(`services/addon/`) | `addon-state.ts`, `entitlement.ts`, `integration-gate.ts` |
| 기능 구현(라우트·채팅 통합·런타임·팩 콘텐츠) | 각 add-on | `addons/<id>/`, `apps/api/addons/builtin/<id>/` |

Base 는 개별 add-on 을 import 하지 않는다. 확장점은 매니페스트 `entry` 의 세 가지 — `routes`(전용 라우트), `chatIntegration`(채팅 턴 통합), `runtime`(부팅 때 호출되는 진입점) — 와 팩 콘텐츠(스킬·카탈로그·마이그레이션)뿐이다.

## 7.1 부팅 절차 (`addon-host/index.ts`)

① 매니페스트 발견·strict 검증 → ② 앱 버전 호환 → ③ env(`ADDON_BUILTIN_DISABLED`) ∧ DB 의도(`addon_installations.desired_state`)로 대상 확정 → ④ 허용된 add-on 의 migration → ⑤ 성공한 add-on 만 `entry.runtime` 호출 → ⑥ 팩 설치(스킬·카탈로그, 백그라운드·fail-open) → ⑦ 대상 밖 add-on 의 시스템 스킬 보관.
실패한 add-on 의 후속 단계는 차단하고 `last_failure_code` 로 남긴다. 다른 add-on 과 서버 기동은 계속된다.

## 7.2 활성 축 (`addon-host/activation.ts`)

| 축 | 뜻 | 반영 시점 |
|---|---|---|
| `enabledByEnv` | 배포 환경의 비상 차단 | 재시작 |
| `desiredState` | 관리자의 사용 의도(DB) | 실시간(캐시 TTL `ADDON_STATE_CACHE_TTL_MS`, 기본 30초; 쓰기 직후 캐시 비움) |
| `runtimeStatus` | 이 프로세스가 코드를 어디까지 세웠나(not_loaded·registering·ready·stopping·stopped·failed) | 프로세스마다 다름 |
| `effectiveAvailability` | 위 셋 + 조회 성공 여부의 합성(available·disabled·not_ready·failed·incompatible·state_unknown) | — |

**실시간인 것과 아닌 것**: 라우트 노출·사용권·채팅의 `prepareTurnContext`·기여 도구 실행은 요청(턴)마다 DB 의도를 본다. 순수 동기 훅(프롬프트 조각·도구 노출·의도 판정)은 턴마다 상태 캐시(`isAddonEnabledSync`)로 판정한다 — 캐시는 턴 시작(`runMessagePipeline` 의 `ensureAddonStates`)과 라우트 게이트(strict 판정)가 적재하고(TTL 30초), 비워도 마지막 값을 유지하며, 첫 적재 전(부팅 직후)에만 켜짐으로 본다. 런타임 등록·내장 도구 기여·스킬 시드는 부팅 시점이라 재시작이 필요하다(관리 화면 `restartNote`). 다만 런타임이 돌려준 handle 이 있으면 같은 프로세스에서 토글 즉시 정지(drain)·재개된다(§7.3).

**토글 전파 범위**: 관리자 토글(`PATCH /api/admin/addons/:id/state`)은 같은 프로세스의 캐시를 만료시킨다 — 다음 턴·요청이 다시 읽고(적재 도중 비워지면 그 스냅숏은 버리고 다시 읽는다), 진행 중인 턴은 마지막 값을 쓰되 같은 턴의 strict 판정이나 다른 요청이 다시 적재하면 이후 동기 훅은 새 값을 본다(턴 단위 스냅숏은 §10). 운영은 PM2 단일 fork(`instances: 1`) 프로세스 하나라 토글은 그 프로세스에 즉시 반영된다 — 프로세스를 여럿 띄우는 배치(canary 포트·별도 worker)에서는 **다른 프로세스가 캐시 TTL(최대 30초) 뒤에** 새 의도를 보고, 런타임 정지·재개는 토글을 받은 프로세스에만 일어난다(다른 프로세스는 재시작). 즉시·원자적 철회(상태 변경과 실행 시작 기록의 직렬화)는 보장하지 않으며 2차 범위다. 캐시 TTL 을 "즉시 반영"이라고 쓰지 않는다.

## 7.3 수명주기 (`addon-host/lifecycle.ts`, 계약 `@openmake/plugin-contracts` — 재수출 `addon-host/lifecycle-types.ts`)

코드 언로드는 하지 않는다(재시작 필요 유지). 런타임 진입점은 `AddonRuntimeHost` 를 받고 `void` 또는 `AddonRuntimeHandle { stop({drain, signal}), resume?(), health?() }` 을 돌려준다 — `void` 인 기존 add-on 은 그대로 동작한다. 호스트는 add-on 별 기록(handle·정리 함수 목록·host.signal)을 두고, 상태는 `activation.ts` 표가 단일 원천이다.

**상태 전이**

| 지금 | 사건 | 다음 | 비고 |
|---|---|---|---|
| not_loaded | 부팅 ⑤ 진입점 호출 | registering | 시간 제한 `ADDON_START_TIMEOUT_MS`(기본 120초) |
| registering | 진입점 성공 + 게시 대조 통과 | ready | handle 이 있으면 기록 |
| registering | 진입점 실패·시간 초과·게시 불일치 | failed | 아래 "실패 보상" |
| ready | 관리자 disabled · 프로세스 종료 | stopping | handle.stop({drain:true, signal}) — handle 이 없으면 관리자 disabled 는 상태를 바꾸지 않는다(`ready`, 응답 `unchanged`) |
| stopping | stop 완료 또는 drain 시간 초과 | stopped | 상한 `ADDON_DRAIN_TIMEOUT_MS`(기본 5초) — 넘으면 signal 로 취소하고 더 기다리지 않는다 |
| stopped | 관리자 enabled + handle.resume 있음 | ready | 응답 `runtime: 'resumed'` |
| stopped | 관리자 enabled + resume 없음·실패 | stopped | 응답 `runtime: 'restart_required'`, `restartRequired: true` |

**실패 보상(시작 실패)**: 등록 역순으로 ① 돌려준 handle 즉시 정지(drain=false) ② `host.registerDisposable`·`host.setInterval`·`host.setTimeout` 으로 건 정리 함수(역순, 한 번씩) ③ 기여 도구(`unregisterToolContributions`) ④ capability(`unregisterOwner`), 그리고 host.signal 을 끊는다. 두 번 불러도 안전하다. 포트 등록(`registerToolRuntime`·`registerSkillRuntime`)은 Base 의 단일 포트라 회수하지 않는다. 시작 시간 초과 뒤에도 진입점 자체는 멈추지 않는다 — 그 뒤에 늦게 돌아온 handle 은 호스트가 즉시 정지(drain=false)하고, host.signal 이 끊긴 뒤의 `registerDisposable`·`setInterval`·`setTimeout` 은 등록하지 않고 바로 정리하며, `registerCapabilities` 는 게시하지 않는다(경고 로그). 그 밖의 부작용(기여 도구 등)은 회수되지 않으므로 런타임은 긴 초기화 단계마다 `host.signal` 을 보고 끊겼으면 빠져나와야 한다.

**host.signal**: 시작 시간 초과·시작 실패·프로세스 종료 때 끊긴다. 관리자 토글 정지에는 끊지 않는다(재개할 수 있어야 한다). 호스트 타이머·정리 함수도 토글 정지에서는 남고 종료·실패 때 회수된다.

**토글 전파**: `PATCH /api/admin/addons/:id/state` 가 저장 뒤 `applyDesiredState(addonId, desired)` 로 **같은 프로세스**의 런타임을 바로 정지·재개한다(응답 `runtime`: stopped·resumed·restart_required·unchanged·not_loaded). 런타임 진입점이 없는 add-on 과 진입점이 handle 을 돌려주지 않은 add-on(실제로 멈춘 것이 없다)은 양방향 `unchanged`(상태 `ready` 유지 — 슬롯 가용성 즉시 유지), 이 프로세스의 레지스트리에 없는 id 는 켜면 `restart_required`·끄면 `not_loaded` 다. 끄는 응답은 drain 만큼(최대 5초) 늦을 수 있다. 다른 프로세스의 런타임은 재시작으로 반영한다.

**종료**: graceful-shutdown 의 "add-on 런타임 정지(drain)" 단계가 에이전트 작업 정리 뒤, 도구 런타임·Redis·DB 풀 종료 앞에서 `stopAllAddons({drain:true, budgetMs: ADDON_DRAIN_TIMEOUT_MS})` 를 부른다(연결 유예 10초 + 작업 12초 + add-on 5초 < 전체 30초). `budgetMs` 는 정지·직렬화 큐 대기·정리 전체에 걸린 단일 마감이다. MCP 는 이 단계와 ③ 도구 런타임 정리 양쪽에서 정리된다(두 번째는 빈 반복).

**편입 현황**

| add-on | handle | 정지 | 재개 |
|---|---|---|---|
| Knowledge | 있음 | 새 claim 중단(stop-admission), 진행 작업 drain, 넘으면 lease 상실 처리·반납(`lease_expires_at = NOW()`, 상태 쓰기 없음). claim 도중 정지되면 집은 작업은 실행하지 않고 반납하며, heartbeat 는 잃은 lease 를 다시 늘리지 않는다 | 있음 — 다음 폴링부터 claim |
| MCP Runtime | 있음 | `mcpToolRuntime.shutdown()` 위임(외부 연결·사용자 풀) | 없음 — 재시작 |
| Skill Runtime | 없음 | 런타임 상태 그대로(시드는 host.signal 로 중단) | 즉시(`unchanged`) |
| 그 밖의 runtime add-on | 없음 | 런타임 상태 그대로(`ready`, 응답 `unchanged`) — 라우트·사용권 게이트로 즉시 반영 | 즉시(`unchanged`) — 등록(도구·스킬 주입·채팅 모드) 변경은 재시작 |

관리자가 MCP 런타임을 끄면 외부 연결·child 프로세스는 정리되지만 도구 포트 등록(`registerToolRuntime`)과 supervisor 타이머는 남는다 — 완전한 반영은 재시작이 필요하다(포트·supervisor 회수는 다음 묶음 D1 범위).

DB 밖 부작용(임베딩 호출·파일 삭제)은 멈출 뿐 되돌리지 않는다.

## 7.4 계약 패키지 (`packages/plugin-contracts`, `@openmake/plugin-contracts`)

Base ↔ Add-on 계약의 원천이다. **타입과 상수만** 담고 런타임 의존이 없다(eslint 가 apps·외부 패키지·자기 디렉터리 밖 import 를 막는다). 버전 `PLUGIN_CONTRACT_VERSION`(1.0.0) — 필드 삭제·의미 변경은 major, 선택 필드·새 DTO 는 minor.

| 파일 | 내용 |
|---|---|
| `actor.ts` | `Actor` = user·org·system — 포트가 "누구의 것을" 돌려줄지 정한다 |
| `availability.ts` | 설치 상태·관리자 의도·실패 코드 어휘, `AddonRuntimeStatus`·`AddonAvailability`, 부팅이 읽는 `AddonInstallationIntent` |
| `lifecycle.ts` | `AddonRuntimeHandle`·`AddonRuntimeHost<THandler>`·`AddonRuntimeEntry<THandler>`(§7.3) |
| `manifest.ts` | `AddonManifestDTO`(검증기 zod 스키마는 Base `addon-host/manifest.ts`) |
| `contributions.ts` | capability metadata·소유자·실행 문맥 DTO, 스킬 포트 DTO(`SkillRecordDTO`·`ActiveSkillBinding`·`SkillUsageEvent`·`ManifestPromptResult`·`SkillSummary`·`SkillCatalogOptions`), 도구 포트 DTO(`ToolUserInputResult`·`ToolUserInputContext`·`ToolSummary`) |

**Base 가 계약을 쓰는 규칙**
- `apps/api` 소스는 계약 패키지를 `import type` / `export type` 으로만 쓴다(eslint `@typescript-eslint/no-restricted-imports`). 배포(`openmake_llm.sh deploy`)는 `npm install` 없이 build→restart 라 새 워크스페이스 링크가 없을 수 있기 때문이다. 타입은 `apps/api/tsconfig.json` 의 `paths` 가 `packages/plugin-contracts/dist/index.d.ts` 로 푼다(src 로 물리면 rootDir 위반) — 그래서 apps/api 의 tsc 앞에는 `npm run build:packages` 가 있어야 한다. Jest 는 `moduleNameMapper` 로 src 를 본다.
- 상수 값은 Base 가 들고 타입을 계약 상수의 `typeof` 로 고정한다(`ADDON_STATES`·`CAPABILITY_CONTRACT_VERSION`·`LOAD_SKILL_TOOL_NAME`·`TOOL_USER_INPUT_APPROVAL_NAME`) — 한쪽만 바꾸면 tsc 가 막는다.
- 기존 경로(`addon-host/lifecycle-types`·`addon-host/activation`·`runtime-ports/*`·`capability-contract/types`)는 재수출 facade 다. `CapabilityHandler`·`CapabilityContext`·`ToolRuntime`·`SkillRuntime` 인터페이스는 Base 포트(승인 handle·제한 호출·LLM 도구 정의) 타입에 묶여 Base 에 남는다 — 계약의 `AddonRuntimeHost` 는 handler 형을 제네릭으로 받고 Base facade 가 `CapabilityHandler` 로 채운다.
- 오케스트레이터 타입(`services/orchestrator/*`)과 계약 DTO 의 동등성, zod 매니페스트와 `AddonManifestDTO` 의 동등성은 `apps/api/src/__tests__/plugin-contracts-compat.test.ts` 가 tsc 로 고정한다. 계약만 쓰는 샘플 add-on(`packages/plugin-contracts/__tests__/compile-sample.ts`)은 패키지 빌드 때 컴파일된다.
- 저장소 행 → 계약 DTO 변환은 `runtime-ports/contract-mappers.ts`(`toSkillRecordDTO`·`toAddonInstallationIntent`) 한 곳이다.

## 7.5 마이그레이션 소유권

| 소유 | 위치 | `migration_versions.version` | 부팅 때 적용 | 수동·테스트 DB 명령(apps/api 에서) |
|---|---|---|---|---|
| Base(코어) | `db/init/002-schema.sql`(baseline) + `db/migrations/NNN_*.sql` | `NNN` | `applyPendingWithLock`(서버 부팅) | `npx ts-node src/data/migrations/cli.ts migrate` |
| add-on | `apps/api/addons/builtin/<id>/migrations/NNN_*.sql` — 매니페스트 `components.migrations` 와 권한 `database:addon` 이 둘 다 있을 때만 | `addon:<id>:NNN` | 부팅 ④ `applyAddonMigrationsWithLock` — env ∧ DB 의도로 켜진 add-on 만 | `npx ts-node src/data/migrations/cli.ts migrate:addons` — env 로 켜진 add-on(DB 의도는 보지 않는다), 코어 `migrate` 뒤에 |

- 두 실행기는 같은 advisory lock 으로 직렬화된다. add-on 마이그레이션은 코어 테이블을 만들거나 바꾸지 않는다 — 코어 테이블을 FK 로 **참조**하는 것은 되므로 코어 뒤에 돈다.
- 기존 마이그레이션 파일은 고치지 않는다. 바꿀 것은 새 번호로 additive 하게(열 추가·새 표) 하고, 롤백은 코드만 되돌려도 동작하도록 기본값을 둔다(설계 D8).
- `migrate:addons` 는 부팅 ④ 와 같은 대상 선택(`selectMigrationTargets`)·같은 잠금을 쓰되 하나라도 실패하면 종료 코드 1 이다(부팅은 실패한 add-on 만 막고 서버는 계속 뜬다).
- 테스트 DB 는 `scripts/setup-test-db.sh` 가 코어와 add-on 마이그레이션을 모두 적용한다(`TEST_DATABASE_URL` 을 주면 그 DB 에 바로, 이름은 `_test` 로 끝나야 한다).

## 8.3 실행 판정 — 한 규칙

"상태를 확인하지 못한 것"과 "꺼진 것"을 섞지 않는다. 확인 불가는 **차단하되 재시도 가능한 장애**로 알린다.

| 경로 | 판정 함수 | 켜짐 | 관리자가 끔 | 부팅 실패(`failed`) | 조직 allowlist 밖 | 확인 불가(DB 장애) |
|---|---|---|---|---|---|---|
| add-on 전용 라우트(`addonGuard`) | `checkAddonEntitlement` | 통과 | **404 `ADDON_DISABLED`** | **503 `ADDON_FAILED`**(`Retry-After` 없음 — 관리자 조치 필요) | **403 `ADDON_NOT_ENTITLED`** | **503 `ADDON_STATE_UNKNOWN`** + `Retry-After: 5` |
| capability 실행(`admitCapability`) | `readAddonStateStrict` | ok | `ADDON_DISABLED` | `ADDON_FAILED` | (해당 없음) | `ADDON_STATE_UNKNOWN` |
| 채팅 기능 훅 `prepareTurnContext` | `integrationGate`(→ `checkAddonEntitlement`) | 호출 | 건너뜀(info 로그) | 건너뜀(info 로그, reason `failed`) | 건너뜀(info 로그, reason `not_entitled`) | 건너뜀 |
| 채팅 오케스트레이션 도구 `run` | `integrationGate`(→ `checkAddonEntitlement`) | 실행 | `Error: … 중지되어 실행할 수 없습니다` | `Error: … 부팅에 실패해 이 도구를 실행할 수 없습니다` | `Error: … 이 조직에서 사용할 수 없습니다(허용 목록 밖)` | `Error: … 확인할 수 없어 실행하지 않았습니다` |
| 에이전트 작업 기여 도구(`agentTaskTools`) `precheck`·`run` | `integrationGate`(→ `checkAddonEntitlement`, `getActiveAgentTaskTools` 가 씌움) | 실행 | 승인 카드 없이 위와 같은 문구로 거절 | 같음 | 같음 | 같음 |
| 팩 스킬 주입 필터 | `entitledAddonIds` | 주입 | 제외 | 제외 | 제외 | **주입 유지(fail-open)** — 선언형 콘텐츠, 피해 없음 |

**판정 기준 열**: 라우트·채팅 훅 게이트의 strict 판정(`readAddonEnabledStrict`)은 `addon_installations.state`(installed·enabled·disabled·failed)를 읽어 `enabled` 가 아니면 차단한다. 그중 부팅 실패(`failed`)는 판정의 `state` 로 구분해 라우트가 503 `ADDON_FAILED`(`Retry-After` 없음 — 재시도로 풀리지 않고 관리자 조치가 필요하다)로 알리고, 웹은 '준비되지 않았습니다(부팅 실패)' 문구(`knowledge.notReady`)를 보인다. 채팅 훅은 건너뛰고 오케스트레이션 도구는 부팅 실패 문구를 돌려준다. `installed`·`disabled` 는 종전대로 404 `ADDON_DISABLED`.

env 차단은 모든 경로에서 "관리자가 끔"과 같게 취급한다(항상 알 수 있다).

## 8.4 채팅 훅의 분류

| 훅 | 종류 | 꺼진 add-on | 판정 실패 |
|---|---|---|---|
| `prepareTurnContext`, 오케스트레이션 도구 `run` | 기능 | **멈춘다(턴마다 `integrationGate`)** | 그 통합만 건너뜀 |
| 순수 동기 훅 `detectIntent`·`forceIncludeTools`·`forcedFirstTurnTool`·`systemPromptParts`·`userLocationHint`·`enhancedMessagePrefix`·`mcpSelectionHint`·`extractBlocks`·`scrubFinalContent`·`preserveFromRawResult`·`agentTaskTools`·기여 도구 노출 | 기능(프롬프트·노출) | **턴마다 캐시 판정으로 건너뜀**(`getActiveChatTurnIntegrations` → `isAddonEnabledSync`, 턴 시작에 적재·TTL 30초, 첫 적재 전에만 켜짐; 조직 사용권 축은 안 봄) | 해당 없음(동기 — 적재 실패 시 마지막 값, 첫 적재 전엔 켜짐) |
| `isMemoryIsolatedSession` | 보호 | **계속 돈다** | 격리로 간주(fail-closed) |
| `listHiddenSessionIds` | 표시 | 계속 돈다 | 숨김만 건너뜀(본인 목록 배치, 누출 아님) |

채팅 기능 훅 게이트(`integrationGate`)는 라우트 게이트와 같은 판정(`checkAddonEntitlement` — 상태 + 조직 사용권)을 쓴다 — 조직 allowlist 밖 add-on 은 라우트 403 과 함께 채팅 기능 훅도 멈춘다(사용자가 없는 게스트 턴은 조직 축을 보지 않는다).

순수 훅(`detectIntent` 등)은 동기라 턴마다 DB 를 묻지 않고 상태 캐시로 판정한다 — 관리자가 끄면(DB 의도 disabled·부팅 실패 failed·env) 캐시가 갱신된 뒤의 턴부터 프롬프트 조각·도구 노출·의도 판정이 빠진다(같은 프로세스는 다음 턴부터, 다른 워커는 TTL 뒤 첫 턴부터). 첫 적재 전(부팅 직후)에만 켜짐으로 본다(fail-open — 선언형 노출; `prepareTurnContext`·오케스트레이션 도구 실행·기여 작업 도구(`agentTaskTools`)의 승인 전 검사와 실행은 `integrationGate` 가 막는다). 조직 사용권 축은 동기 훅이 보지 않으며 실행 시점(`runOrchestrationTool`·`prepareTurnContext`·`getActiveAgentTaskTools` 가 씌운 `precheck`·`run`)의 게이트가 맡는다. 기여 작업 도구의 노출은 작업을 만들 때 정해지므로, 작업 도중 add-on 을 꺼도 도구 목록에는 남고 호출이 거절된다. 보호 훅(`isMemoryIsolatedSession`)·표시 훅(`listHiddenSessionIds`)·구 클라이언트 필드 매핑(`collectContextRefs`)은 꺼진 add-on 도 전체 목록으로 계속 돈다. 꺼진 add-on 의 기여 도구가 호출되면(`isOrchestrationTool` 은 전체 목록으로 분류) 실행 시점에서 거절 문구를 돌려준다.

## 8.5 Add-on ↔ Base 경계 규칙

| 규칙 | 집행 | 실패 조건 |
|---|---|---|
| Base 는 add-on 모듈을 import 하지 않는다 | eslint `no-restricted-imports`(`**/addons/**`, addon-host 제외) | 위반 즉시 |
| 계약 패키지는 apps·외부 패키지·자기 디렉터리 밖을 import 하지 않는다 | eslint(`packages/plugin-contracts/src/**`) | 위반 즉시 |
| apps/api 는 계약 패키지를 type-only 로만 쓴다(테스트 예외) | eslint `@typescript-eslint/no-restricted-imports` | 값 import·재수출 |
| add-on → Base 내부 계층(data·services·routes·sockets·controllers·middlewares·auth·chat) import 는 **줄어들기만** 한다 | `npm run check:addon-boundary`(CI Gate 4), 허용 목록 `scripts/lint/addon-import-allowlist.json` | 목록 밖의 새 (파일, 대상) 쌍. 사라진 쌍은 권고만 — `npm run gen:addon-boundary` 로 목록을 줄인다 |
| add-on 소스는 Base 테이블을 SQL 로 쓰지 않는다 | Jest `__tests__/addons-no-base-table-sql.test.ts`(테이블 목록은 코어 스키마의 CREATE TABLE) | SQL 키워드 뒤의 Base 테이블 이름. 예외(래칫): 스킬 런타임의 스킬 스키마 6개 표 |

add-on 이 써도 되는 문은 `runtime-ports/*`(포트)·`addon-host`·`config`·`utils`·`@openmake/plugin-contracts` 다. 허용 목록·SQL 검사는 테스트(`__tests__`·`*.test.ts`)와 평가 시드 도구(`evaluation/`)를 보지 않는다. 초기 허용 목록은 141쌍/67파일(2026-10-16) — 새 import 를 목록에 더하는 diff 는 리뷰에서 거절한다.

ratchet 은 `BASE_LAYERS`(`scripts/lint/addon-boundary-lib.mjs`) 8개 디렉터리 — `data`·`services`·`routes`·`sockets`·`controllers`·`middlewares`·`auth`·`chat` — 로 가는 import 만 센다. `tools/`·`agents/`·`llm/`·`security/`·`workflow/` 등 그 밖의 Base 디렉터리로 가는 import 는 세지 않으며, 범위 확장은 2차 후보다.

## 8.6 Base 데이터 포트 (`runtime-ports/base-data-port.ts`)

add-on 이 Base 소유 테이블을 읽어야 할 때의 문이다. 지금은 대화 세션만 있다.

| 함수 | 인가 | 결과 |
|---|---|---|
| `conversationSessions.listIdsForUser(actor)` | actor 의 것만 — user actor 만 세션을 소유하므로 org·system 은 `[]` | 소유 세션 id |
| `conversationSessions.exists(actor, sessionId)` | 같음 — user 가 아니면 false | 세션이 있고 그 user 소유면 true |
| `conversationSessions.ownerOf(sessionId)` | **없음** — 호출부가 상위 자원(예: Knowledge Space)으로 인가한 뒤에만 | 소유자 id, 익명·없는 세션은 null |
| `conversationSessions.summaries(sessionIds)` | **없음** — 같음 | 제목·갱신 시각(ISO), 최근 갱신 순, 없는 id 는 빠짐, 빈 입력은 조회 없이 `[]` |

Knowledge 는 바인딩(연결·해제·해석·사이드바 숨김)과 Space 대화 목록의 소유·제목 조회를 이 포트로 한다 — 종전의 `conversation_sessions` JOIN 5곳을 바꿨고 결과·404 는 같다. 제목·갱신 시각이 없는 세션은 null 그대로 내려간다(`KnowledgeConversation.title`·`updatedAt` 은 `string | null`; `conversation_sessions.updated_at` 은 NOT NULL 이 아니다). 바인딩 연결의 소유 확인은 actor 범위의 `exists` 를 쓴다. 쿼리는 `data/conversation-session-lookup.ts` 에 있다. Base 테이블 SQL 스캔(§8.5)은 schema-qualified 이름·따옴표 식별자·문자열 보간으로 만든 이름·콤마 조인을 잡지 못하고 `evaluation/` 은 제외한다. **같은 DB·같은 풀의 코드 경계**이며 물리 SQL 권한 격리(별도 DB 역할)를 주장하지 않는다.

포트의 actor 범위도 코드 경계다. `ownerOf`·`summaries` 는 actor 를 받지 않고, `exists`·`listIdsForUser` 의 actor 는 호출자(add-on)가 만든다 — Base 가 요청 문맥에서 발급한 actor 가 아니다. 물리 SQL 권한 격리와 Base 발급 actor 는 2차 후보다.

**DB 테스트**: `*.db.test.ts` 는 `TEST_DATABASE_URL` 이 있을 때만 돈다. CI 는 Gate 1.5 에서 job 안의 일회용 PostgreSQL(`pgvector/pgvector:0.8.3-pg16-trixie`)에 `scripts/setup-test-db.sh` 로 코어+add-on 마이그레이션을 적용하고 `npm run test:db` 로 그 파일들만 `--runInBand` 로 돌린다 — 마지막 줄 `db tests ran: N` 이 0 이면(전부 skip) 실패다. 로컬도 같은 두 명령이다. CI 에서 실제로 도는 DB 테스트는 `*.db.test.ts` 뿐이다 — `TEST_DATABASE_URL||DATABASE_URL` 로 게이트된 다른 테스트 7개(027_mcp_server_draft·128_org_scoped_sharing·mcp-catalog-repository.metrics·mcp-server-draft-repository·mcp-catalog-admin.routes·mcp-server-ingest.routes·mcp-server-ingest-service)는 이름 변경(`*.db.test.ts`)이 후속이다.

## 9. Knowledge 작업 큐 (`addons/knowledge-runtime/jobs/`)

### 9.1 lease·fencing

claim 은 `UPDATE … fencing_token = fencing_token + 1 … FOR UPDATE SKIP LOCKED` 로 만료 lease 를 포함해 집는다. 실행자는 받은 token(BIGINT — 문자열로 들고 다니며 `Number` 로 바꾸지 않는다)을 `JobLease` 로 끌고 가 **job 행 갱신(finish·retry·heartbeat·마감)과 모든 확정 쓰기(청크 교체·임베딩 삽입·문서 ready 게시·실패 기록·index 전환)** 의 트랜잭션 첫 문장에서 `assertLeaseHeld`(`SELECT … WHERE id AND fencing_token AND lease_owner AND state='running' FOR SHARE`)로 검사한다 — 검사와 쓰기가 같은 트랜잭션·같은 행 잠금 아래 있어 "선조회 뒤 무조건 쓰기"(TOCTOU)가 아니다. heartbeat 갱신이 0행이거나, 갱신 오류가 lease 기간을 넘겨 이어지면 lease 상실로 표시하고 핸들러는 단계 경계에서 멈춘다. lease 를 잃은 실행자는 job 행·문서 상태(ready·failed) 어느 것도 쓰지 않는다. 핸들러가 정상 반환해도 그 사이 lease 를 잃었으면 `done` 을 쓰지 않는다. DB 밖 부작용(임베딩 호출·파일 삭제)은 멈출 뿐 되돌리지 않는다 — exactly-once 가 아니다.

### 9.2 접수 주체(actor)와 claim 재검사

| 접수 지점 | actor | claim 때 재검사 |
|---|---|---|
| 문서 업로드·재시도 | 개인 Space `user` / 조직 Space `org`(조직 id) | 상태 + 조직 사용권(`checkUserEntitlement`) |
| 관리자 재색인·재청킹 | 그 관리자 `user` | 같음 |
| 문서·Space 삭제의 정리(cleanup) | `system`(요청자는 기록용) | add-on 단위 게이트만 |
| 평가 하네스 | `system` | add-on 단위 게이트만 |
| 004 이전 행(actor NULL) | `system` 으로 본다 | add-on 단위 게이트만 |

접수 때 `policy_revision`(그 시점 `addon_installations.state_revision`, 조회 실패면 NULL)을 함께 남긴다 — 추적용이며 판정은 claim 때 늘 다시 한다. tick 은 먼저 add-on 단위 strict 판정(`readAddonRunVerdict` — 꺼짐·실패·env 차단은 stopped, 조회 실패는 unknown)을 보고 run 이 아니면 그 tick 은 집지 않는다. 집은 사용자·조직 작업의 판정: `ok` 실행, `not-entitled` 최종 실패(작업 `failed`, 문서 버전 `ADDON_NOT_ENTITLED`), `disabled`·`failed`·`state-unknown` 보류(queued 로 되돌리고 attempts −1, `KNOWLEDGE_JOB_ADMISSION_DEFER_MS` 뒤). add-on 은 이 판정을 `runtime-ports/addon-admission` 으로만 묻는다.

### 9.3 취소

`POST /api/knowledge/jobs/:id/cancel` — 접수한 사용자(user·org 작업) 또는 관리자만, 그 밖은 404. queued 는 바로 `cancelled`(수집이면 문서 버전 `CANCELLED`) 200, running 은 `cancel_requested_at` 만 찍고 202 `cancelling`, 끝난 작업은 409 `JOB_NOT_CANCELLABLE`. 감사 `knowledge.job_cancelled`. 실행자의 heartbeat 갱신(`RETURNING cancel_requested_at`, 주기 `max(1초, jobLeaseMs × 0.4)`)이 요청을 읽으면 `lease.markCancelled` 로 신호를 끊고, 핸들러는 다음 단계 경계에서 `JobCancelledError`(`LeaseLostError` 의 하위형 — 상실 경로의 "상태를 쓰지 않고 던진다"를 그대로 탄다)로 멈춘다. lease 는 여전히 그 실행자의 것이므로 실행자가 token·owner 조건으로 `cancelled` 를 쓴다. 핸들러가 이미 끝난 뒤 도착한 취소는 `done` 으로 둔다. 취소 요청된 채 다시 집힌 작업(앞 실행자가 죽음)은 핸들러 없이 `cancelled`. 진행 중이던 DB 밖 호출은 끝까지 가고 그 결과만 버린다. 취소 요청 뒤 실행자의 heartbeat 가 멈춰(프로세스 정지 등) lease 가 만료되면 다른 소비자가 다시 집을 수 있고 그때 attempts 가 1 늘어난다 — 다시 집힌 작업은 위 규칙대로 핸들러 없이 `cancelled` 로 마감하므로 상태 정합성은 유지된다.

### 9.4 소비자 모드와 generation

`knowledge_worker_mode`(id=1 단일 행: `mode` inprocess|external, `generation`)가 claim 권한의 authority 다. claim SQL 은 `WITH m AS (SELECT mode FROM knowledge_worker_mode WHERE id = 1 FOR SHARE)` 로 읽어 자기 종류와 같을 때만 집는다 — 모드 전환(UPDATE)은 진행 중 claim 이 끝날 때까지 기다리고, 전환 커밋 뒤 시작한 claim 은 새 값을 본다. 행이 없으면 아무도 집지 않는다. 설정 `KNOWLEDGE_WORKER_MODE`(기본 inprocess)는 "이 API 프로세스가 poller 를 띄우는가"만 정한다 — external 이면 API 는 poller 없이 정지·재개할 것이 없는 handle 을 돌려준다. 전환은 `scripts/knowledge-worker-mode.sh set <mode>`(generation+1)이고, 그 앞뒤 순서는 9.6 이다. 소비자는 `knowledge_worker_heartbeats` 에 worker_id·종류·generation·inflight 를 주기(`KNOWLEDGE_WORKER_HEARTBEAT_MS`)로 쓴다. API 안(inprocess) 소비자는 관리자 정지(handle.stop) 뒤 heartbeat 행 갱신을 멈춘다(resume 하면 다시 쓴다) — 그래서 `/api/health`·롤백 스크립트의 "살아 있음"(heartbeat 나이 15초 미만)이 정지를 반영하기까지 최대 15초 늦다.

### 9.5 별도 worker 프로세스

PM2 앱 `openmake-knowledge-worker`(`apps/api/dist/workers/knowledge-worker.js`) — `KNOWLEDGE_WORKER_MODE=external` 일 때만 ecosystem 에 등록된다. Base 진입점은 루트 .env·설정·시스템 설정 overlay·종료 신호만 맡고, add-on 본체는 매니페스트 `entry.workers[name=knowledge-ingest]` 로 찾는다(`addon-host/worker-entry` — Base 는 add-on 코드를 import 하지 않는다). 본체는 add-on 마이그레이션 004 를 기다렸다가(`KNOWLEDGE_WORKER_SCHEMA_WAIT_MS`) 행이 끝내 없으면 종료 코드 78(PM2 `stop_exit_codes` — 다시 띄우지 않는다), 있으면 상태 캐시를 채우고 `127.0.0.1:<KNOWLEDGE_WORKER_HEALTH_PORT>/health`(0 이면 끔 — 포트를 묶지 못하면 타이머를 걸기 전에 78)를 연 뒤 external 소비자로 폴링하며 heartbeat 행을 둔다. API listen·add-on 전체 부팅·마이그레이션 적용은 하지 않는다. 스키마 확인 조회가 DB 오류로 실패하면 "없음"과 나눠 대기 상한(기본 60초)까지 다시 시도하고, 상한에서 마지막 조회가 여전히 오류면 종료 코드 1 로 끝나 PM2 가 다시 띄운다(재부팅 때 DB 가 늦게 뜨는 경우 — 한 번의 시도가 `min_uptime` 10초보다 길어 재시작 상한에 걸리지 않는다). 로그 파일은 API 와 나눈다 — 진입점이 `LOG_FILE_PREFIX=knowledge-worker-` 를 정해 `apps/api/logs/knowledge-worker-combined.log`·`knowledge-worker-error.log` 를 쓴다(winston 회전은 프로세스마다 크기를 따로 세므로 한 파일을 두 프로세스가 쓰면 회전이 엇갈린다). SIGTERM → 새 claim 중단 → 진행 작업 drain(`KNOWLEDGE_WORKER_DRAIN_TIMEOUT_MS` 20초, 넘으면 lease 반납) → heartbeat 행 삭제 → DB 풀 종료(전체 25초 < PM2 kill_timeout 30초). 관리자 토글은 이 프로세스에 handle 로 닿지 않는다 — 상태 캐시 TTL(`ADDON_STATE_CACHE_TTL_MS`) 안에 claim 게이트가 보고 새 claim 을 멈추며, 진행 중 작업은 끝까지 간다. `./openmake_llm.sh deploy`·`canary-deploy` 는 등록된 worker 를 API 가 뜬 뒤 재시작하고, 카나리 API 는 poller 를 띄우지 않는다(external). 임베딩 capability 를 add-on driver 의 direct transport 로 배정한 경우는 이 프로세스에서 지원하지 않는다(driver 를 등록하지 않으므로 게이트웨이 경로로 해석된다).

`/api/health` 의 `knowledge`: `{ mode, generation, workerHeartbeatAgeMs, queueOldestAgeMs, inflight }` — `workerHeartbeatAgeMs` 는 현재 모드와 같은 종류 소비자의 가장 최근 heartbeat 나이(없으면 null), `queueOldestAgeMs` 는 실행할 때가 된 queued 작업의 최장 대기. external 인데 worker 가 없으면 앞이 null 이고 뒤가 자란다. `/api/health` 는 인증 없이 열려 있으므로 이 절은 누구에게나 보인다 — 내보내는 것은 모드·generation·heartbeat 나이·최장 대기 시간·진행 중 건수뿐이고 작업 id·문서·사용자·오류 문구는 없다.

### 9.6 전환·롤백 순서 (`scripts/knowledge-worker-rollback-drill.sh {to-inprocess|to-external}`)

순서는 언제나 DB 모드 전환 → 설정(`KNOWLEDGE_WORKER_MODE`) 변경 → API 재시작이다 — 설정이 external 인 채 떠 있는 API 는 DB 모드만 inprocess 로 되돌려도 재시작 전까지 poller 를 띄우지 않는다(작업이 쌓인다).

① DB 모드 변경 + generation+1(옛 소비자의 새 claim 즉시 차단) ② 옛 소비자 정지(SIGTERM → drain) ③ 살아 있는 lease 0 + generation 이 ① 의 값인지 확인 ④ 새 소비자 기동, `/api/health` 의 `knowledge` 가 새 모드·generation·살아 있는 heartbeat 인지 확인. API 재시작은 셸의 `KNOWLEDGE_WORKER_MODE` 를 넘기지만 다음 배포는 `.env` 값으로 API 를 다시 띄우므로, 스크립트는 시작 전(① 앞)과 ④ 직전에 `.env` 의 `KNOWLEDGE_WORKER_MODE`(없으면 inprocess)가 목표 모드인지 보고 다르면 종료 코드 7 로 멈춘다 — `.env` 를 먼저 바꾸고 실행한다. 앱 이름 기본값은 `OMK_INSTANCE` 로 `-<인스턴스>` 를 붙이고(ecosystem 과 같은 규칙), heartbeat 나이 상한은 API 와 같은 `KNOWLEDGE_WORKER_HEARTBEAT_STALE_MS` 를 읽는다. ① 뒤 단계가 실패하면 문서의 종료 코드(3 DB·4 lease·5 generation·6 헬스·8 단계 명령)로 끝나며 복구 안내 한 줄을 남긴다. 대상·명령은 환경변수로 받는다(서버 이름 없음, `DRILL_DRY_RUN=1` 로 순서만 출력). 코드 자체를 004 이전으로 되돌릴 때는 옛 코드가 모드 행을 보지 않으므로 별도 worker 를 먼저 내리고(to-inprocess) 되돌린다.

## 10. 범위 밖(다음 묶음)

manifest 없는 확장의 권한 상태 명시화(→ §11 에서 구현), 기여 작업 도구(`agentTaskTools`) 실행 게이트(→ §8.3·8.4 에서 구현 — 작업 도중 토글은 호출 거절로 반영, 도구 목록에서 빼지는 않는다), 턴 단위 활성 통합 스냅숏(한 턴 안에서 훅 집합이 바뀌지 않게, 2차), add-on → Base 내부 import 의 전수 이전(ratchet 으로 줄여 간다 — §8.5), 대화 세션 밖의 Base 테이블 포트(필요해질 때), 물리 SQL 권한 격리.

## 11. 설치형 확장의 권한 상태 (`user_extensions.permission_state`, 마이그레이션 190)

설치형 확장(Git·ZIP·마켓 갤러리)의 권한은 번들의 `openmake-addon.json` `permissions` 가 **요청**하고, 설치 기록이 **승인**을 들고 있다. 판정은 `services/extensions/permission-state.ts`(순수 함수), 저장은 `data/repositories/user-extension-permission-repository.ts`, 집행은 설치 때 `agents/git-ingest/extension-components.ts` 의 MCP 서버 저장(네트워크가 없으면 stdio 는 `sandbox_network='none'`, 원격 서버는 설치에서 제외)이다.

| 상태 | 뜻 | 집행 | 화면 |
|---|---|---|---|
| `legacy_unreviewed` | 매니페스트도 승인 기록도 없는 예전 설치(190 이전 행 전부의 기본값) | 없음 — 종전 동작(네트워크 허용) 보존 | "레거시 미검토" + 재승인 |
| `reviewed` | 승인 기록(`permissions_granted`) 안에서 동작 | 요청 ∩ 승인만 허용 | "권한 검토됨" |
| `review_required` | 업데이트가 승인 범위보다 넓게 요청 | 초과분만 막고 기존 승인 범위는 유지 | "재승인 필요" + 막힌 권한 + 재승인 |

전이:
- 첫 설치: 매니페스트 없음 → `legacy_unreviewed`. 있음 → `reviewed`(설치한 사람이 그 권한을 승인한 것으로 기록 — 종전 deny-by-default 집행과 결과가 같다).
- `legacy_unreviewed` 업데이트: 매니페스트가 계속 없으면 그대로. 새로 생기면 레거시가 쓰던 권한(`network:internet`) 안이면 `reviewed`, 넘으면 `review_required`.
- `reviewed`·`review_required` 업데이트: 요청 ⊆ 승인이면 `reviewed`(승인 기록 유지), 아니면 `review_required`(초과분 차단). **매니페스트가 사라진 업데이트는 레거시 묵시 권한(network)을 요청한 것으로 본다** — 매니페스트를 빼서 집행을 피할 수 없다.
- 재승인 `POST /api/users/me/extensions/:id/permissions/approve`(소유자·관리자): 승인 = 요청(매니페스트가 없으면 network) → `reviewed`, 감사 `extension.permissions_approved`. 네트워크가 새로 열리면 권한 때문에 막았던 stdio 서버(`manifest_meta.networkRestrictedByPermission`)만 `full` 로 되돌린다. 설치 때 제외된 원격 서버는 확장을 제거·재설치해야 생긴다(응답 `excludedRemoteServers`).
- 철회 `POST …/revoke` `{ permissions: [...] }`: 승인에서 뺀 뒤 다시 판정, 감사 `extension.permissions_revoked`. 네트워크가 닫히면 연결된 stdio 는 `none`(`networkRestrictedByPermission`), 원격 서버는 `enabled=false`(`disabledByPermission`). stdio 의 `--network none` 집행은 `MCP_SANDBOX_ENABLED=true` 일 때만 효과가 있다(샌드박스가 꺼져 있으면 `sandbox_network` 값이 프로세스 기동에 쓰이지 않는다). 승인 범위에 철회 대상이 없어 저장하지 않는 철회(no-op)도 네트워크가 이미 닫혀 있으면 MCP 제한을 한 번 더 건다 — 저장 뒤 제한이 실패했을 때의 재시도다.
- 업데이트(ingest)는 읽어 둔 상태·승인이 저장 값과 같을 때만 쓴다. 업데이트 도중 철회됐으면 `EXTENSION_UPDATE_CONFLICT` 로 실패하고 철회가 남는다(다시 업데이트하면 철회된 승인 기준으로 판정).
- 재승인·철회는 읽은 요청 권한이 저장 값과 다르면(그 사이 업데이트) 409 — 오래된 화면으로 넓어진 권한을 승인하지 않는다.
- MCP 서버 반영은 **다음 기동부터**다. 이미 떠 있는 프로세스는 그대로 돈다.
- 조회 `GET …/permissions` 와 목록 응답은 상태·승인·요청 권한을 주고, 승인자 id(`permissions_reviewed_by`)는 목록 응답에서 뺀다.

롤백:
- **코드만 이전 버전으로 되돌리면** 새 열은 기본값이 있어 무시되고 승인 기록은 DB 에 남는다. 다시 올리면 그대로 이어진다. 되돌린 기간에 업데이트된 확장은 요청 권한이 갱신되지 않은 채라, 다음 업데이트 때 다시 판정된다.
- `db/migrations/rollbacks/190_user_extensions_permission_state_rollback.sql` 은 열을 지우므로 승인·철회 기록이 사라진다. 그 뒤 190 을 다시 적용하면 설치 기록에 `manifest.addonPermissions` 가 있는 행만 `reviewed`(승인자 `migration:190`)로 복원되고 나머지는 `legacy_unreviewed` 로 돌아간다.
- 재적용 백필은 `manifest.addonPermissions` **요청 원문**을 승인으로 복원한다. 롤백 전에 `review_required` 로 막혀 있던(미승인) 권한이나 철회한 권한까지 승인된 것으로 돌아가므로, 재적용 전에 해당 확장의 상태를 기록해 두고 재적용 뒤 확인·철회해야 한다.

## 12. 경로별 실행 책임표 (actor → 정책 → 실행 → 종료)

한 add-on 기능이 실행되는 모든 입구를 한 줄씩 적는다. "actor" 는 그 실행을 누구의 권한으로 하는가(사용자 user · 조직 org · 시스템 system), "판정 함수" 는 실행 직전에 상태·사용권을 보는 함수, "실행 주체" 는 코드가 실제로 도는 프로세스, "중지 방법" 은 관리자가 끄거나 프로세스가 끝날 때 그 경로가 멈추는 방식, "보호 훅" 은 기능을 꺼도 계속 도는 안전장치다. 오류 코드의 뜻은 §8.3, 수명주기는 §7.3, 큐는 §9 를 따른다.

| 경로 | actor | 판정 함수 | 실행 주체 | 중지 방법 | 보호 훅 |
|---|---|---|---|---|---|
| add-on 전용 HTTP 라우트(매니페스트 `routes` 로 건 모든 경로 — 예 `/api/knowledge/*`) | user(쿠키·Bearer), 조직 사용권은 user 의 활성 조직 | `addonGuard` → `checkAddonEntitlement`(strict DB 판정) — 404 `ADDON_DISABLED`·503 `ADDON_FAILED`·403 `ADDON_NOT_ENTITLED`·503 `ADDON_STATE_UNKNOWN` | API 프로세스(요청 처리) | 토글 저장 직후 다음 요청부터 거절(같은 프로세스·다른 프로세스 모두 — 라우트 판정은 캐시를 쓰지 않는다) | 없음(라우트 자체가 소유권 검사 — `resolveUserId`) |
| `/api/v1/*`(API 키) | user(API 키 소유자) | `requireApiKey`·`requireScope` → 채팅이면 아래 "채팅 턴" 행과 같은 파이프라인 | API 프로세스 | 키 폐기·scope 축소는 다음 요청부터. add-on 기능은 채팅 턴 행과 같다 | 채팅 턴 행과 같다 |
| 채팅 턴 — WS(`sockets/ws-chat-handler.ts`)·REST(`/api/chat`) 공통 `runMessagePipeline` | user 또는 guest | 기능 훅 `prepareTurnContext`: 턴마다 `integrationGate`(→ `checkAddonEntitlement`). 순수 동기 훅: `isAddonEnabledSync`(턴 시작 `ensureAddonStates` 적재, TTL `ADDON_STATE_CACHE_TTL_MS`) | API 프로세스 | 기능 훅은 다음 턴부터 건너뜀. 동기 훅은 캐시 갱신 뒤 턴부터. 진행 중 턴은 끝까지 가거나 사용자의 `abort` 로 멈춘다 | `isSessionMemoryIsolated`(Space 연결 대화는 전역 메모리 미기록, 판정 실패 시 격리 — fail-closed), `listHiddenSessionIds` |
| 채팅 오케스트레이션 도구 `run`(매니페스트 기여 도구) | user | `runOrchestrationTool` → `integrationGate` — 거절 문구 `Error: add-on '<id>' 이 관리자에 의해 중지되어 이 도구를 실행할 수 없습니다`(부팅 실패·조직 밖·확인 불가 문구는 §8.3) | API 프로세스 | 실행 시점 거절(노출은 동기 훅 캐시로 빠짐) | 없음 |
| 기여 작업 도구(`agentTaskTools`) | user(작업 소유자) | 노출은 동기 훅 캐시, 승인 전 검사·실행은 호출마다 `integrationGate`(§8.3·8.4) | 에이전트 작업 실행기(API 프로세스) | 작업 취소(`POST /api/agent-tasks/:taskId/cancel`) · graceful-shutdown 의 작업 drain(`AGENT_TASK_DRAIN_TIMEOUT_MS`) | 없음 |
| 팩 스킬 주입(선언형 콘텐츠) | user | `entitledAddonIds` — 확인 불가 시 주입 유지(fail-open, 선언형이라 피해 없음) | API 프로세스(프롬프트 구성) | 다음 턴부터 제외 | 없음 |
| 스킬 시드(부팅) | system | 부팅 ⑤ 진입점, `host.signal`(시작 시간 제한 `ADDON_START_TIMEOUT_MS`) | API 프로세스(부팅) | `host.signal` 끊김 → 시드 중단. 관리자 토글은 재시작 필요(Skill Runtime 은 handle 없음) | 없음 |
| MCP 도구(외부 서버·stdio child) | user(서버 소유자) | MCP add-on 상태(라우트·capability 판정) + 설치형 확장 권한 상태(`allowsNetwork` — `legacy_unreviewed` 는 기존 허용 유지, `review_required` 는 초과분 거절, §11) | API 프로세스의 MCP supervisor(외부 연결·child) | 관리자 disabled → handle.stop = `mcpToolRuntime.shutdown()`. 재개 없음(재시작). 포트 등록·supervisor 타이머는 재시작까지 남는다(§7.3) | 권한 상태 초과분 차단 |
| 산출물 코드 실행(`services/artifact-exec-service.ts` `executeArtifactCode`) | user | Base 소유 기능 — add-on 판정 대상 아님. 실행 가능 여부는 Base 설정(`ARTIFACT_EXEC`) | 샌드박스 컨테이너(읽기 전용, tmpfs) | 실행 시간 제한·컨테이너 종료 | 샌드박스 격리 |
| 예약 capability 작업(`services/job-poller.ts`, `CAPABILITY_JOB_POLLER_ENABLED=true` 일 때) | system(poller) 이 제출 user 대신 | `admitCapability`(job scope 재발급) — 소유 add-on 이 꺼졌거나 상태 불명이면 네트워크 호출 없이 다음 주기로 미룸 | API 프로세스 poller | 다음 주기부터 미룸. 확정 쓰기는 fencing token 조건부 | lease·fencing token |
| Knowledge 수집(ingest) | 개인 Space `user` / 조직 Space `org`(조직 id) — `actor_kind`·`actor_user_id`·`org_id`·`policy_revision` 기록, 평가 하네스 수집은 `system`(§9.2) | tick 마다 `readAddonRunVerdict`(add-on strict 판정 — run 이 아니면 그 tick 은 집지 않음) → 집은 user·org 작업은 `checkUserEntitlement`(사용권): `not-entitled` 최종 실패, `disabled`·`failed`·`state-unknown` 보류(`KNOWLEDGE_JOB_ADMISSION_DEFER_MS` 뒤). claim 은 소비자 모드가 자기 종류일 때만(`knowledge_worker_mode`, §9.4) | 모드에 따라 API 프로세스 poller(`inprocess`) 또는 별도 프로세스 `openmake-knowledge-worker`(`external`) | inprocess: 관리자 disabled → handle.stop = stop-admission + drain(`ADDON_DRAIN_TIMEOUT_MS`), 넘으면 lease 반납. external: handle 이 닿지 않음 — 상태 캐시 TTL(`ADDON_STATE_CACHE_TTL_MS`) 안에 claim 게이트가 새 claim 을 멈추고 진행 중 작업은 끝까지 감, 프로세스 종료는 SIGTERM drain(`KNOWLEDGE_WORKER_DRAIN_TIMEOUT_MS`, §9.5). 취소 `POST /api/knowledge/jobs/:id/cancel`(접수한 사용자 또는 관리자 — queued 즉시 `cancelled`, running 은 heartbeat 가 요청을 읽은 뒤 다음 단계 경계에서 `cancelled`, §9.3) | `assertLeaseHeld`(모든 확정 쓰기의 첫 문장) |
| Knowledge 재색인·재청크(reindex·rechunk) | 요청한 관리자 `user`(§9.2) | 수집과 같다 | 수집과 같다 | 수집과 같다 | 수집과 같다 |
| Knowledge 정리(cleanup — 삭제된 문서·Space 의 청크·파일) | `system`(요청자는 기록용) | add-on 단위 strict 판정만(사용권 재검사 없음) — §9.2 | 수집과 같은 소비자 | 수집과 같다(add-on 이 꺼지면 tick 이 집지 않음) | `assertLeaseHeld` |

**이 표가 보장하지 않는 것**: 같은 DB 안의 코드 경계이며 물리 SQL 권한 격리가 아니다(§8.6). DB 밖 부작용(임베딩 호출·파일 삭제·외부 MCP 호출)은 멈출 뿐 되돌리지 않는다 — exactly-once 가 아니다. 토글과 실행 시작의 원자적 직렬화는 하지 않는다(§7.2 "토글 전파 범위").

## 13. 검증 증거 규약

검증 도구(`scripts/bench/*`, `scripts/release/*`)와 e2e 는 결과를 저장소 밖 증거 디렉터리에 남긴다 — `.omo/` 는 `.gitignore` 에 있어 커밋되지 않는다.

- 위치: `.omo/evidence/base-plugin-separation/<run-id>/task-<N>/`. `<run-id>` 는 `<UTC YYYYMMDDTHHMMZ>-<git short sha 8자>`, `<N>` 은 로드맵 작업 번호(1 = 기준선·책임표, 3 = 전송 경로 e2e, 11 = 릴리스 후보 검증(작업 11 에서 추가), 12 = 배포 기록(작업 12 에서 추가)).
- 남기는 것: 명령 원문, exit code, 소요 시간, git SHA, 설정 **이름**(값 아님), assertion 결과, 로그 꼬리. 남기지 않는 것: 비밀값(토큰·비밀번호·API 키·DB 비밀번호가 든 URL) — 도구는 URL 의 비밀번호 부분을 `***` 로 바꿔 쓴다.
- 부하 receipt(`baseline.json`·`current.json`) 스키마 `schemaVersion: 1`: `runId`·`label`·`gitSha`·`createdAt`·`environment`(로컬/개발/스테이징/운영)·`target`·`runtime`(`ts-node` 또는 `node-dist`)·`settings{connections,durationSec,warmupSec,settleSec,v1RatePerSec,scenarios[]}`·`envNames[]`·`scenarios[{name,method,path,requests,ok,errorRate,throughputRps,p50Ms,p95Ms,p99Ms,statusCounts,transportErrors}]`·`rss{samples,failedSamples,beforeBytes,afterBytes,peakBytes,pid,restarted,source}`(`failedSamples` 는 실패한 표본 요청 수 — 기록용).
- 성능 게이트(설계 D6): 같은 `settings` 에서 시나리오별 p95 ≤ 기준선 × 1.10(작은 값의 측정 잡음을 위해 기준선 + 2ms 까지는 허용), 처리율 ≥ 기준선 × 0.95, 오류율 ≤ max(기준선, 1%), RSS 최고값 ≤ 기준선 × 1.10. `settings`·`runtime`·`environment` 가 다르거나, `target` 이 다르거나, 측정 중 pid 가 바뀌거나, 어느 쪽이든 오류율 ≥ 50% 또는 처리율 0 인 시나리오가 있으면 비교하지 않는다(무효 — 깨진 기준선이면 오류율 한계가 늘 통과한다). 측정 단계(`api-load.mjs`)는 2xx 0건 시나리오가 있으면 receipt 를 남기지 않고 exit 3 이다.
- 로컬 수치는 ts-node 로 띄운 API 라 RSS 에 컴파일러 메모리가 섞인다 — 로컬 RSS 비교는 참고값이고, 운영 판단용 RSS 는 스테이징에서 빌드 산출물(`node-dist`)로 다시 잰다(`docs/architecture/addon-platform-runbook.md` §3.2).
- 릴리스 후보 검증(작업 11 에서 추가): `node scripts/release/verify-matrix.mjs --run-id <id> --local`(개발자 맥에서는 `--local` 필수 — 로컬 정책상 돌리지 않는 명령을 "미측정" 으로 남긴다) → `node scripts/release/release-candidate.mjs --run-id <id>`. receipt 들의 git SHA 가 섞이면 보고서 머리말에 모두 적고 판정은 "판단 대기" 를 넘지 않는다.
- 배포·관찰·롤백 절차와 완료 기록은 `docs/architecture/addon-platform-runbook.md`(작업 12 의 운영 기록 칸은 그 문서 §11).
