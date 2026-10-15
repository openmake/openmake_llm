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

**실시간인 것과 아닌 것**: 라우트 노출·사용권·채팅의 `prepareTurnContext`·기여 도구 실행은 요청(턴)마다 DB 의도를 본다. 순수 동기 훅(프롬프트 조각·도구 노출·의도 판정)은 턴마다 상태 캐시(`isAddonEnabledSync`)로 판정한다 — 캐시는 턴 시작(`runMessagePipeline` 의 `ensureAddonStates`)과 라우트 게이트(strict 판정)가 적재하고(TTL 30초), 비워도 마지막 값을 유지하며, 첫 적재 전(부팅 직후)에만 켜짐으로 본다. 런타임 등록·내장 도구 기여·스킬 시드는 부팅 시점이라 재시작이 필요하다(관리 화면 `restartNote`).

**토글 전파 범위**: 관리자 토글(`PATCH /api/admin/addons/:id/state`)은 같은 프로세스의 캐시를 만료시킨다 — 다음 턴·요청이 다시 읽고(적재 도중 비워지면 그 스냅숏은 버리고 다시 읽는다), 진행 중인 턴은 마지막 값을 쓰되 같은 턴의 strict 판정이나 다른 요청이 다시 적재하면 이후 동기 훅은 새 값을 본다(턴 단위 스냅숏은 §10). 운영은 PM2 cluster 라 **다른 워커 프로세스는 캐시 TTL(최대 30초) 뒤에** 새 의도를 본다. 즉시·원자적 철회(상태 변경과 실행 시작 기록의 직렬화)는 보장하지 않으며 2차 범위다. 캐시 TTL 을 "즉시 반영"이라고 쓰지 않는다.

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

진행 작업 drain·타이머·연결 회수·부분 시작 실패 정리(2차), manifest 없는 확장의 권한 상태 명시화(→ §11 에서 구현), 기여 작업 도구(`agentTaskTools`) 실행 게이트·작업 도중 토글 반영(2차), 턴 단위 활성 통합 스냅숏(한 턴 안에서 훅 집합이 바뀌지 않게, 2차), 계약 패키지·데이터 포트·별도 worker 프로세스(3차 — Knowledge 처리량·API 지연 측정 뒤 조건부).

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
