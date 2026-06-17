# Claude Code 패턴 도입 — 대형 기능 설계 제안서  〔CLOSED〕

> 작성일 2026-06-18 · **종료(closed) 2026-06-18** · 근거: Piebald-AI/claude-code-system-prompts(512개) ↔ openmake_llm 전체 소스 비교 분석
>
> **최종 결정**:
> - ✅ **완료(v1)**: P-1 Code-Review · P-2 Security-Review · P-3 Plan Mode · P-4 Slash-Command. (+ G1~G3, P-6 핵심 2건)
> - ❌ **폐기**: P-5 Skill Dimensions(스킬 폭증·G1과 모순), token-usage WS(순수 UX·파이프라인 회귀위험), PR 코멘트 연동(챗 제품 부적합).
> - ⏸️ **트리거 기반**(상시 로드맵에서 제거, 조건 충족 시에만 재론): 다중투표 적대검증 = v1 오탐 실측 시 / Agent Task plan 생명주기 통합 = 자율 write 도구 추가 시 / REST 슬래시 배선 = REST 챗 실사용 시.
>
> **비용/편익 판정 결과 남은 항목은 순편익이 음수이거나 투기적이라 상시 계획으로서는 종료한다.**

본 문서는 비교 분석에서 "프롬프트/스티어링 수준을 넘어 **신규 서브시스템**이 필요"한 항목들의 설계 스케치다. P-1~P-4는 v1 구현이 완료되었고, 나머지는 위 최종 결정대로 폐기/트리거 기반으로 종료.

이미 적용 완료된 소규모 항목(중복 아님): G1 Skill 과포화 가드, G2 agent_task_get trust-but-verify, G3 Skill triggers 활성화. 그리고 직전 작업의 F1 산출물 검증 게이트 / 에러 분류 / tool-call 관측성은 본 문서 범위 밖(이미 반영). **F2 자가개선 폐루프**는 영속화·주입에 더해 관리자 승인 라우트(`/api/admin/agent-suggestions` GET·approve·reject)까지 추가되어 **인간 승인 게이트가 닫힌 완전 종료 상태**(2026-06-18).

## 트리거 항목 재개 조건 (이것 외에는 진행하지 않음)

아래 3건은 **상시 로드맵에서 제거**됐고, 명시된 트리거가 실제로 발생한 시점에만 그 항목을 단건으로 새 플랜화하여 재개한다. 트리거 미발생 시 선제 구현 금지(비용·위험 > 편익).

| 항목 | 재개 트리거(조건) | 보류 사유(지금 하면) |
|---|---|---|
| 다중투표 적대검증 | v1(security/code review)에서 **거짓양성이 실측으로 문제**가 될 때 | 토큰·지연 3~5×, 효과 미측정(투기적). v1의 결정론 필터+신뢰도 게이트가 이미 대부분 흡수 |
| Agent Task plan 생명주기 통합 | 자율 Agent Task에 **write 도구가 추가**될 때(그때 resume gate 필수해짐) | 민감한 자율 실행기·resume 수술 + status enum + 프론트 승인 UI 필요. 현재 read-only 도구뿐이라 막을 위험 자체가 없음 |
| REST 슬래시 배선 | **REST 인터랙티브 챗**이 실사용될 때 | WS가 주 경로. 프로그래매틱 REST엔 가치 낮고 `/` 메시지 변환의 API 놀람 위험 |

---

## 공통 원칙
- openmake_llm는 vLLM/LiteLLM 기반 **멀티모델 제품 런타임**이며 Claude Code는 **단일 코딩 에이전트**다. 패턴은 "그대로 이식"이 아니라 제품 맥락으로 **재해석**한다.
- 모든 신규 LLM 호출 기능은 토큰 비용을 수반 → per-user 쿼터(`llm/user-quota.ts`)·context-fit 안전망과 정합해야 한다.
- 신규 서브시스템은 **기본 OFF 플래그 + 점진 롤아웃**으로 도입한다.

---

## P-1. Code-Review 다각도 서브에이전트 (효과 高 / 노력 高 / 위험 中) — ✅ v1 구현완료
> v1: `code_review` MCP 도구(`mcp/code-review-tool.ts`, `services/code-review/`, `config/code-review.ts`) — 버그/성능/유지보수/에러처리/재사용 단일패스 + 결정론 후처리(스타일 nitpick 필터·신뢰도 게이트). 보안은 security_review 위임.
> **v2 처리**: 다중 투표 적대검증 = ⏸️ 트리거(오탐 실측 시) · diff/git ref 입력 = ⏸️ 트리거(요구 시) · GitHub PR 코멘트 = ❌ 폐기(챗 제품 부적합).

**무엇**: PR/diff를 여러 독립 관점(정확성·보안·성능·타입·에러처리·재사용성)으로 병렬 검토 → 발견을 적대적으로 검증(확정/불확실/거짓양성 3-state) → 신뢰도 임계 이상만 리포트. Claude Code의 `agent-prompt-code-review-*` 8단계.

**openmake_llm 현황**: `discussion-engine`은 다중 전문가 토론이나 **코드 리뷰 전용·diff 인지·검증 단계 없음**. 갭.

**설계 스케치**:
- `agents/code-reviewer.ts` — `discussion-engine`의 fan-out/synthesize 인프라 재사용. 차원(dimension)별 finder → 적대적 verifier → 합성.
- 입력: diff(텍스트) 또는 git ref. 출력: `{findings:[{dimension,file,line,severity,confidence,verdict}]}` 구조화(Zod).
- 진입: 신규 MCP 도구 `code_review` 또는 Agent Task 템플릿. GitHub 연동은 선택(2단계).

**의존성/위험**: 토큰 비용(PR당 N×검증). 오탐 시 신뢰 저하 → 신뢰도 게이팅 필수. **기본 OFF**.

---

## P-2. Security-Review 서브에이전트 (효과 高 / 노력 高 / 위험 低) — ✅ v1 구현완료
> v1: `security_review` MCP 도구(`mcp/security-review-tool.ts`, `services/security-review/`, `config/security-review.ts`) — 취약점 분류 + 거짓양성 룰셋 + 신뢰도 게이트.
> **v2 처리**: 다중 투표 적대검증 = ⏸️ 트리거(오탐 실측 시) · git/sandbox 파일 입력 = ⏸️ 트리거(요구 시) · PR 코멘트 = ❌ 폐기.

**무엇**: 취약점 카테고리(SQLi/cmd injection/XSS/auth bypass/crypto/SSRF) 분류 + **거짓양성 필터 규칙셋** + 신뢰도 점수 → 고신뢰만 리포트. 읽기 전용이라 위험 낮음.

**openmake_llm 현황**: `security/ssrf-guard`, `chat/security-hooks`(런타임 입력 방어)는 있으나 **코드 정적 보안 리뷰는 없음**. 갭.

**설계 스케치**:
- P-1과 동일 하니스 재사용, 차원=취약점 카테고리. 거짓양성 필터는 config 룰셋(`config/`)으로 외부화(No-Hardcoding).
- `/security-review` 슬래시 또는 MCP 도구. 결과는 audit 로그 연동.

**권고**: P-1보다 위험 낮고(읽기 전용) 엔터프라이즈 가치 큼 → 대형 기능 중 **우선 후보**.

---

## P-3. Plan Mode (읽기 전용 설계 + 승인 게이트) (효과 中 / 노력 中 / 위험 低) — ✅ v1 구현완료
> v1: `create_plan` MCP 도구(`mcp/plan-tool.ts`, `services/plan-mode/`, `config/plan-mode.ts`) — 단계별(작업+검증)·핵심파일·위험·미해결질문 구조화 계획. 승인 게이트=채팅 흐름.
> **v2 처리**: Agent Task 생명주기 통합(status `plan_pending_approval` + resume + 승인 UI) = ⏸️ 트리거(자율 작업에 write 도구 추가 시 — 그때 resume gate 필수해짐).

**무엇**: 구현 전 읽기 전용 탐색 → 아키텍처/단계/Critical Files 계획 산출 → 사용자 승인 후 실행. Claude Code `agent-prompt-plan-mode-*`.

**openmake_llm 현황**: `ExecutionPlanBuilder`는 **라우팅 정책 plan**이지 사용자 대면 작업 계획이 아님. Agent Task는 실행 전용(`AgentTaskService`). 부분적.

**설계 스케치**:
- Agent Task에 `plan` 단계 추가: write 도구 차단 상태로 탐색→계획 산출→사용자 승인 시 resume(기존 resume gate 재사용 — 메모리 `project_agent_task_resume_design`).
- 출력 스키마: `{steps[], criticalFiles[], risks[]}`.

**위험**: 낮음(읽기 전용·승인 게이트). 기존 resume gate와 정합.

---

## P-4. Slash-Command 스킬 호출 라우팅 (효과 中 / 노력 中 / 위험 中) — ✅ v1 구현완료
> v1: `chat/slash-command.ts`(순수 파서+해석+증강) + ws-chat-handler 단일 진입점 배선. `/skill-slug ...`가 active 스킬과 정확 매칭 시 컨텍스트 주입, 비슬래시/미매칭/오류는 passthrough(무영향).
> **v2 처리**: REST 경로 동일 배선 = ⏸️ 트리거(REST 챗 실사용 시) · 프론트 자동완성 UI = ⏸️ 저우선 · 충돌방지 고도화 = ⏸️ 필요 시.

**무엇**: `/skill-name` 입력 → 해당 스킬을 명시적으로 호출/주입. Claude Code의 skill 호출 UX.

**openmake_llm 현황**: 스킬 CRUD/검색 API는 있으나 **채팅에서 `/명령` 호출 라우팅 없음**. 갭.

**설계 스케치**: `message-pipeline`에서 선행 `/<slug>` 파싱 → `skill-manager.searchSkills` → 해당 스킬만 주입. 네임스페이스 충돌·prompt injection 방지(슬러그 화이트리스트, 본문은 sanitize).

**위험**: 중(주입). G3(triggers 힌트)와 상호보완 — G3는 자동 발견, P-4는 명시 호출.

---

## P-5. Skill Dimensions 분해 — ❌ 폐기

**무엇**: 복합 스킬을 sub-skill 차원으로 분해(code-review를 8단계로 쪼개듯).

**폐기 사유**: ~100 스킬 단층 구조로 충분. 분해는 스킬 폭증(100→300+)·컨텍스트 관리 복잡도↑·UX 혼란을 부르며, **방금 도입한 G1 Skill 과포화 가드와 정면 모순**. 이 효과가 필요한 경우는 이미 P-1/P-2(전문 리뷰 도구)가 대체. 재론 불요.

---

## P-6. 부가 동적 리마인더 (개별 가치 판단 — 일부 구현)

- ✅ **파일 부분읽기 완전성 고지** (구현): `fs_read_file` 이 크기 제한 없이 전체를 반환 → 거대 파일이 다운스트림 context-fit 에서 조용히 잘리던 갭. `mcp/filesystem.ts` `applyReadLimit`(바이트 캡 `FS_READ_MAX_BYTES` + 잘림 명시 고지 + optional `max_bytes`). 멀티바이트 경계 안전.
- ✅ **비동기 에이전트 중복방지** (최소 구현): `POST /api/agent-tasks` 생성 시 진행 중(running/pending) 작업 수를 조회해 응답에 `concurrentActive`/`warnings` 추가(additive, 생성은 막지 않음). 프론트는 미소비 시 무영향.
- ❌ **token-usage 턴별 피드백 WS** (폐기): `message-pipeline`+WS 이벤트+프론트 동반, **순수 UX·정확성/안전 가치 0·핵심 파이프라인 회귀위험**. 정 필요하면 파이프라인 손 안 대고 `usage-tracker`/`user-quota` 기반 가벼운 REST 폴링으로 대체(별건). WS 버전은 폐기.

---

## 종료(CLOSED) 요약
- ✅ **구현 완료(v1)**: P-2 → P-3 → P-1 → P-4 (모두 검증 완료). + G1~G3, P-6 핵심 2건(파일 완전성 고지·비동기 중복인지), **F2 자가개선 폐루프**(영속화+승인 라우트+주입까지 완전 종료).
- ❌ **폐기**: P-5 Skill Dimensions · token-usage WS · PR 코멘트 연동.
- ⏸️ **트리거 기반(상시 로드맵 제외)**: 다중투표 적대검증(오탐 실측 시) · Agent Task plan 통합(자율 write 도구 추가 시) · REST 슬래시 배선(REST 챗 실사용 시) · 프론트 자동완성(저우선).

**이 계획은 종료되었다.** 트리거 항목은 명시된 조건이 실제로 발생할 때 그 시점에 새 플랜으로 재개한다 — 지금 선제 구현하지 않는다(순편익 음수·회귀위험).
