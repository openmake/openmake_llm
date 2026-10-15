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
| `runtimeStatus` | 이 프로세스가 코드를 어디까지 세웠나(not_loaded·registering·ready·failed) | 프로세스마다 다름 |
| `effectiveAvailability` | 위 셋 + 조회 성공 여부의 합성(available·disabled·not_ready·failed·incompatible·state_unknown) | — |

**실시간인 것과 아닌 것**: 라우트 노출·사용권·채팅의 `prepareTurnContext`·기여 도구 실행은 요청(턴)마다 DB 의도를 본다. 순수 동기 훅(프롬프트 조각·도구 노출)과 런타임 등록·내장 도구 기여·스킬 시드는 부팅 시점이라 재시작이 필요하다(관리 화면 `restartNote`).

**토글 전파 범위**: 관리자 토글(`PATCH /api/admin/addons/:id/state`)은 같은 프로세스의 캐시를 즉시 비운다. 운영은 PM2 cluster 라 **다른 워커 프로세스는 캐시 TTL(최대 30초) 뒤에** 새 의도를 본다. 즉시·원자적 철회(상태 변경과 실행 시작 기록의 직렬화)는 보장하지 않으며 2차 범위다. 캐시 TTL 을 "즉시 반영"이라고 쓰지 않는다.

## 8.3 실행 판정 — 한 규칙

"상태를 확인하지 못한 것"과 "꺼진 것"을 섞지 않는다. 확인 불가는 **차단하되 재시도 가능한 장애**로 알린다.

| 경로 | 판정 함수 | 켜짐 | 관리자가 끔 | 부팅 실패(`failed`) | 조직 allowlist 밖 | 확인 불가(DB 장애) |
|---|---|---|---|---|---|---|
| add-on 전용 라우트(`addonGuard`) | `checkAddonEntitlement` | 통과 | **404 `ADDON_DISABLED`** | **503 `ADDON_FAILED`**(`Retry-After` 없음 — 관리자 조치 필요) | **403 `ADDON_NOT_ENTITLED`** | **503 `ADDON_STATE_UNKNOWN`** + `Retry-After: 5` |
| capability 실행(`admitCapability`) | `readAddonStateStrict` | ok | `ADDON_DISABLED` | `ADDON_FAILED` | (해당 없음) | `ADDON_STATE_UNKNOWN` |
| 채팅 기능 훅 `prepareTurnContext` | `integrationGate` | 호출 | 건너뜀(info 로그) | 건너뜀(info 로그, reason `failed`) | (해당 없음 — 사용자 단위 정책은 라우트가 맡음) | 건너뜀 |
| 채팅 오케스트레이션 도구 `run` | `integrationGate` | 실행 | `Error: … 중지되어 실행할 수 없습니다` | `Error: … 부팅에 실패해 이 도구를 실행할 수 없습니다` | (해당 없음) | `Error: … 확인할 수 없어 실행하지 않았습니다` |
| 팩 스킬 주입 필터 | `entitledAddonIds` | 주입 | 제외 | 제외 | 제외 | **주입 유지(fail-open)** — 선언형 콘텐츠, 피해 없음 |

**판정 기준 열**: 라우트·채팅 훅 게이트의 strict 판정(`readAddonEnabledStrict`)은 `addon_installations.state`(installed·enabled·disabled·failed)를 읽어 `enabled` 가 아니면 차단한다. 그중 부팅 실패(`failed`)는 판정의 `state` 로 구분해 라우트가 503 `ADDON_FAILED`(`Retry-After` 없음 — 재시도로 풀리지 않고 관리자 조치가 필요하다)로 알리고, 웹은 '준비되지 않았습니다(부팅 실패)' 문구(`knowledge.notReady`)를 보인다. 채팅 훅은 건너뛰고 오케스트레이션 도구는 부팅 실패 문구를 돌려준다. `installed`·`disabled` 는 종전대로 404 `ADDON_DISABLED`.

env 차단은 모든 경로에서 "관리자가 끔"과 같게 취급한다(항상 알 수 있다).

## 8.4 채팅 훅의 분류

| 훅 | 종류 | 꺼진 add-on | 판정 실패 |
|---|---|---|---|
| `prepareTurnContext`, 오케스트레이션 도구 `run` | 기능 | **멈춘다(턴마다 `integrationGate`)** | 그 통합만 건너뜀 |
| 순수 동기 훅 `detectIntent`·`forceIncludeTools`·`forcedFirstTurnTool`·`systemPromptParts`·`enhancedMessagePrefix`·`mcpSelectionHint`·`extractBlocks`·`scrubFinalContent` | 기능(프롬프트·노출) | **계속 돈다** — 부팅 시점(env) 판정, 재시작 필요; 턴 게이트는 2차 | 해당 없음(동기, DB 안 봄) |
| `isMemoryIsolatedSession` | 보호 | **계속 돈다** | 격리로 간주(fail-closed) |
| `listHiddenSessionIds` | 표시 | 계속 돈다 | 숨김만 건너뜀(본인 목록 배치, 누출 아님) |

순수 훅(`detectIntent` 등)은 동기라 턴마다 DB 를 묻지 않는다 — 관리자가 꺼도 재시작 전까지 프롬프트 조각·도구 노출은 남지만, 기여 도구가 노출돼도 실행 시점(`runOrchestrationTool`)에서 막힌다.

## 9. Knowledge 작업 큐의 lease·fencing (`addons/knowledge-runtime/jobs/`)

claim 은 `UPDATE … fencing_token = fencing_token + 1 … FOR UPDATE SKIP LOCKED` 로 만료 lease 를 포함해 집는다. 실행자는 받은 token(BIGINT — 문자열로 들고 다니며 `Number` 로 바꾸지 않는다)을 `JobLease` 로 끌고 가 **job 행 갱신(finish·retry·heartbeat)과 모든 확정 쓰기(청크 교체·임베딩 삽입·문서 ready 게시·실패 기록·index 전환)** 의 트랜잭션 첫 문장에서 `assertLeaseHeld`(`SELECT … WHERE id AND fencing_token AND lease_owner AND state='running' FOR SHARE`)로 검사한다 — 검사와 쓰기가 같은 트랜잭션·같은 행 잠금 아래 있어 "선조회 뒤 무조건 쓰기"(TOCTOU)가 아니다. heartbeat 갱신이 0행이거나, 갱신 오류가 lease 기간을 넘겨 이어지면 lease 상실로 표시하고 핸들러는 단계 경계에서 멈춘다. lease 를 잃은 실행자는 job 행·문서 상태(ready·failed) 어느 것도 쓰지 않는다. DB 밖 부작용(임베딩 호출·파일 삭제)은 멈출 뿐 되돌리지 않는다 — exactly-once 가 아니다.

## 10. 범위 밖(다음 묶음)

진행 작업 drain·타이머·연결 회수·부분 시작 실패 정리(2차), manifest 없는 확장의 권한 상태 명시화(2차), 순수 동기 채팅 훅의 턴 게이트(2차 — §8.4), 계약 패키지·데이터 포트·별도 worker 프로세스(3차 — Knowledge 처리량·API 지연 측정 뒤 조건부).
