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

## 7.3 수명주기 (`addon-host/lifecycle.ts`, 계약 `addon-host/lifecycle-types.ts`)

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

## 8.3 실행 판정 — 한 규칙

"상태를 확인하지 못한 것"과 "꺼진 것"을 섞지 않는다. 확인 불가는 **차단하되 재시도 가능한 장애**로 알린다.

| 경로 | 판정 함수 | 켜짐 | 관리자가 끔 | 부팅 실패(`failed`) | 조직 allowlist 밖 | 확인 불가(DB 장애) |
|---|---|---|---|---|---|---|
| add-on 전용 라우트(`addonGuard`) | `checkAddonEntitlement` | 통과 | **404 `ADDON_DISABLED`** | **503 `ADDON_FAILED`**(`Retry-After` 없음 — 관리자 조치 필요) | **403 `ADDON_NOT_ENTITLED`** | **503 `ADDON_STATE_UNKNOWN`** + `Retry-After: 5` |
| capability 실행(`admitCapability`) | `readAddonStateStrict` | ok | `ADDON_DISABLED` | `ADDON_FAILED` | (해당 없음) | `ADDON_STATE_UNKNOWN` |
| 채팅 기능 훅 `prepareTurnContext` | `integrationGate`(→ `checkAddonEntitlement`) | 호출 | 건너뜀(info 로그) | 건너뜀(info 로그, reason `failed`) | 건너뜀(info 로그, reason `not_entitled`) | 건너뜀 |
| 채팅 오케스트레이션 도구 `run` | `integrationGate`(→ `checkAddonEntitlement`) | 실행 | `Error: … 중지되어 실행할 수 없습니다` | `Error: … 부팅에 실패해 이 도구를 실행할 수 없습니다` | `Error: … 이 조직에서 사용할 수 없습니다(허용 목록 밖)` | `Error: … 확인할 수 없어 실행하지 않았습니다` |
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

순수 훅(`detectIntent` 등)은 동기라 턴마다 DB 를 묻지 않고 상태 캐시로 판정한다 — 관리자가 끄면(DB 의도 disabled·부팅 실패 failed·env) 캐시가 갱신된 뒤의 턴부터 프롬프트 조각·도구 노출·의도 판정이 빠진다(같은 프로세스는 다음 턴부터, 다른 워커는 TTL 뒤 첫 턴부터). 첫 적재 전(부팅 직후)에만 켜짐으로 본다(fail-open — 선언형 노출; `prepareTurnContext`·오케스트레이션 도구 실행은 `integrationGate` 가 막지만, 기여 작업 도구(`agentTaskTools`)의 `run` 에는 실행 게이트가 없다 — §10). 조직 사용권 축은 동기 훅이 보지 않으며 실행 시점(`runOrchestrationTool`·`prepareTurnContext`)의 게이트가 맡는다. 보호 훅(`isMemoryIsolatedSession`)·표시 훅(`listHiddenSessionIds`)·구 클라이언트 필드 매핑(`collectContextRefs`)은 꺼진 add-on 도 전체 목록으로 계속 돈다. 꺼진 add-on 의 기여 도구가 호출되면(`isOrchestrationTool` 은 전체 목록으로 분류) 실행 시점에서 거절 문구를 돌려준다.

## 9. Knowledge 작업 큐의 lease·fencing (`addons/knowledge-runtime/jobs/`)

claim 은 `UPDATE … fencing_token = fencing_token + 1 … FOR UPDATE SKIP LOCKED` 로 만료 lease 를 포함해 집는다. 실행자는 받은 token(BIGINT — 문자열로 들고 다니며 `Number` 로 바꾸지 않는다)을 `JobLease` 로 끌고 가 **job 행 갱신(finish·retry·heartbeat)과 모든 확정 쓰기(청크 교체·임베딩 삽입·문서 ready 게시·실패 기록·index 전환)** 의 트랜잭션 첫 문장에서 `assertLeaseHeld`(`SELECT … WHERE id AND fencing_token AND lease_owner AND state='running' FOR SHARE`)로 검사한다 — 검사와 쓰기가 같은 트랜잭션·같은 행 잠금 아래 있어 "선조회 뒤 무조건 쓰기"(TOCTOU)가 아니다. heartbeat 갱신이 0행이거나, 갱신 오류가 lease 기간을 넘겨 이어지면 lease 상실로 표시하고 핸들러는 단계 경계에서 멈춘다. lease 를 잃은 실행자는 job 행·문서 상태(ready·failed) 어느 것도 쓰지 않는다. DB 밖 부작용(임베딩 호출·파일 삭제)은 멈출 뿐 되돌리지 않는다 — exactly-once 가 아니다.

## 10. 범위 밖(다음 묶음)

manifest 없는 확장의 권한 상태 명시화(2차), 기여 작업 도구(`agentTaskTools`) 실행 게이트·작업 도중 토글 반영(2차), 턴 단위 활성 통합 스냅숏(한 턴 안에서 훅 집합이 바뀌지 않게, 2차), 계약 패키지·데이터 포트·별도 worker 프로세스(3차 — Knowledge 처리량·API 지연 측정 뒤 조건부).
