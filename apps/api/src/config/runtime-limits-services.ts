/**
 * 런타임 제한값 — 채팅 질문·서브에이전트·스폰·오케스트레이션, 샌드박스·Add-on·쿼터·멱등성, 보존·지표·MCP 리소스·작업 런타임.
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-services
 */

import { MAX_TOOL_RESULT_CHARS } from './runtime-limits-tools';
import { boolEnvDefault } from './secure-defaults';

/**
 * 채팅 사용자 확인 질문(ask_user) — 요청이 모호할 때 모델이 산출물을 만들기 전에 질문으로 턴을 끝낸다.
 * 배경(2026-09-15): "미국 시간" 시계 아티팩트 요청에서 모델이 본문으로 시간대를 물어놓고 그대로
 * 진행해 5분 40초 뒤 완성본이 왔다 — 생성 중엔 입력창이 잠겨 사용자가 답할 길이 없었다.
 * 노출은 아티팩트·보고서 의도 턴에만(상시 노출 금지 — LLM 판단 경계 B 형).
 */
export const CHAT_ASK_USER = {
    /** 기본 ON. CHAT_ASK_USER_ENABLED=false 로 끈다. */
    ENABLED: process.env.CHAT_ASK_USER_ENABLED !== 'false',
    /** 질문 본문 상한(자) — 모델이 산출물 전체를 질문에 싣는 이탈 방어. CHAT_ASK_USER_MAX_CHARS. */
    MAX_CHARS: parseInt(process.env.CHAT_ASK_USER_MAX_CHARS || '1500', 10),
} as const;

/** 채팅 서브에이전트(delegate_expert) — 채팅 도구 루프에서 전문가 위임(depth=1 tool-loop). */
export const CHAT_SUBAGENT = {
    /** 기본 OFF — 지연(위임 1회 = 서브 LLM 최대 3턴) UX 영향을 관찰 후 조정. CHAT_SUBAGENT_ENABLED=true. */
    ENABLED: process.env.CHAT_SUBAGENT_ENABLED === 'true',
    /** 메시지당 위임 호출 캡(남용·지연 억제, 기본 1). CHAT_SUBAGENT_MAX_CALLS. */
    MAX_CALLS: parseInt(process.env.CHAT_SUBAGENT_MAX_CALLS || '1', 10),
} as const;

/** 병렬 서브에이전트 fan-out(spawn_agents) — 하위 작업 N 개를 병렬 위임하는 범용 오케스트레이션.
 *  채팅·에이전트 작업 양 경로 공용 (services/agent-spawn). depth=1 — 서브가 재위임 불가. */
export const AGENT_SPAWN = {
    /** 기본 OFF — GPU 처리량 분할·지연 영향을 벤치 후 운영 활성화(사용자). AGENT_SPAWN_ENABLED=true. */
    ENABLED: process.env.AGENT_SPAWN_ENABLED === 'true',
    /** 동시 실행 서브에이전트 수(기본 2) — vLLM 동시성 벤치 결과로 조정. AGENT_SPAWN_MAX_PARALLEL. */
    MAX_PARALLEL: parseInt(process.env.AGENT_SPAWN_MAX_PARALLEL || '2', 10),
    /** 1회 호출당 태스크 상한(기본 4) — 초과분은 잘라내고 결과에 명시(silent cap 금지). AGENT_SPAWN_MAX_TASKS. */
    MAX_TASKS_PER_CALL: parseInt(process.env.AGENT_SPAWN_MAX_TASKS || '4', 10),
    /** spawn_agents 결과 전체의 글자 예산 — 태스크 수로 나눠 각 결과를 앞·뒤로 줄인다(spawn-result).
     *  기본은 도구 결과 상한과 같다(그 안에 들면 하류 절단이 걸리지 않는다). AGENT_SPAWN_RESULT_BUDGET_CHARS. */
    RESULT_BUDGET_CHARS: parseInt(process.env.AGENT_SPAWN_RESULT_BUDGET_CHARS || '', 10) || MAX_TOOL_RESULT_CHARS,
    /** 채팅 메시지당 호출 캡(기본 1) — CHAT_SUBAGENT.MAX_CALLS 관행(남용·지연 억제). AGENT_SPAWN_MAX_CALLS. */
    MAX_CALLS_PER_MESSAGE: parseInt(process.env.AGENT_SPAWN_MAX_CALLS || '1', 10),
    /** 채팅 경로 서브 도구 이름 키워드 필터(CSV) — 부모 활성 도구 중 이름에 이 키워드가 포함된
     *  것만 서브에 전달. 라이브 관측: 혼합 19종 전달 시 qwen 서브가 무관 도구(메모리 등)로 턴을
     *  낭비해 스텁만 반환(도구폭주 패턴). 매칭 0개면 전체 폴백. AGENT_SPAWN_SUB_TOOL_KEYWORDS. */
    SUB_TOOL_KEYWORDS: (process.env.AGENT_SPAWN_SUB_TOOL_KEYWORDS || 'search,extract,scrape,fetch,crawl,browse')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
} as const;

/**
 * 오케스트레이션 자동 배정 (Stage 1, 2026-08-01) — 모델이 토론(start_discussion)·
 * 백그라운드 작업(delegate_agent_task)을 도구 호출로 직접 배정한다.
 *
 * 설계 원칙 (실측 근거):
 *  - 앞단 라우터 LLM 금지(Phase B 제거 이력) — 메인 모델의 tool_choice:auto 한 턴으로 결정.
 *  - 도구 상시 노출 금지(도구폭주 함정) — 아래 *_INTENT_PATTERNS 프리필터에 걸릴 때만 노출.
 *  - 고비용 경로 가드 — delegate 작업은 기존 승인 정책(TASK_SANDBOX_APPROVAL_POLICY)을
 *    그대로 타고, 토론은 축소 프로파일(전문가 수·라운드 캡)로 실행.
 */
export const ORCHESTRATION_DISPATCH = {
    /** 기본 OFF — 셰도우 관찰(노출·호출 로그) 후 운영 활성화. ORCHESTRATION_AUTO_DISPATCH=true. */
    ENABLED: process.env.ORCHESTRATION_AUTO_DISPATCH === 'true',
    /** 도구 결과 문자열 캡 — 토론 합성 결과의 컨텍스트 폭주 방지. */
    RESULT_CAP_CHARS: parseInt(process.env.ORCH_RESULT_CAP_CHARS || '8000', 10),
    /** 메시지당 오케스트레이션 도구 호출 캡(종류 무관 합산, 기본 1). */
    MAX_CALLS_PER_MESSAGE: parseInt(process.env.ORCH_MAX_CALLS_PER_MESSAGE || '1', 10),
} as const;

/** 백그라운드 작업 위임 의도 프리필터 — delegate_agent_task 노출 게이트.
 *  ⚠️ '보고서' 는 P1 인라인 보고서 파이프라인과 충돌하므로 의도적으로 제외.
 *  프론트 Option B(파일 첨부+연산 → 자동 위임)와 상보적 — 여긴 텍스트-온리 중작업 커버.
 *
 *  2026-08-01 벤치마크 교정: 초판은 산출물 명사와 생성 동사가 **인접**해야만 매칭돼
 *  "xlsx 파일을 만들어줘"(조사)·"스크립트를 만들어서 돌려줘"·"텍스트 파일로 회의록을 생성"
 *  같은 실제 어순을 놓쳤다(미탐 5건). 명사~동사 사이 최대 20자를 허용하되 동사는
 *  생성 계열로 한정해 "이 파일 설명해줘" 류 조회 질의는 계속 배제한다. */
export const TASK_DELEGATE_INTENT_PATTERNS: readonly RegExp[] = [
    /백그라운드|에이전트\s*작업/i,
    /(파일|엑셀|스프레드시트|xlsx|csv|pdf|pptx?|docx?|스크립트|프로그램)[^\n]{0,20}?(만들|생성|작성|저장|변환|출력)/i,
    /코드를?\s*(실행|돌려|구동)|스크립트를?\s*(실행|돌려|구동)/i,
    /장시간|(시간이?\s*)?오래\s*걸(리|려)|시간\s*오래/i,
    /in\s+the\s+background|as\s+an?\s+agent\s+task|(create|generate|build|write)\s+(a\s+)?[^\n]{0,15}?(file|excel|csv|pdf|script)/i,
];

/** 계획수립 의도 프리필터 — create_plan 강제 포함 + 첫 턴 tool_choice 강제 게이트.
 *  create_plan(review role 소비처)은 always-on/스킬바인딩/토글 어디에도 없어 채팅에서
 *  도달 불가능했다(2026-08-11 진단). 구현/개발 계획의 명시 요청만 매칭 — "여행 계획" 같은
 *  일반 계획은 배제해 tool_choice 강제 오탐(도구 이탈)을 막는다. */
export const PLAN_INTENT_PATTERNS: readonly RegExp[] = [
    /(구현|개발|실행|작업|리팩터링|마이그레이션)\s*계획[^\n]{0,10}?(세워|수립|짜|만들|작성)/i,
    /(기능|시스템|모듈|서비스|프로젝트)[^\n]{0,25}?계획[^\n]{0,10}?(세워|수립|짜|만들|작성)/i,
    /create_plan/i,
    /implementation\s+plan/i,
];

/** 확장 설치 의도 프리필터 — import_extension_from_git 강제 포함 게이트.
 *  확장/플러그인/마켓플레이스 설치는 always-on/토글 어디에도 없어 채팅에서 도달
 *  불가능했다(2026-08-16 라이브 실측 — 모델이 filesystem MCP 로 이탈). Settings
 *  확장 탭의 안내("채팅에서 '이 확장 설치해줘: URL' 로 요청")와 UX 계약을 맞춘다.
 *  git URL/저장소 언급 + 설치/업데이트 동사의 결합만 매칭 (오탐 억제). */
export const EXTENSION_IMPORT_INTENT_PATTERNS: readonly RegExp[] = [
    /(확장|플러그인|extension|plugin)[^\n]{0,40}?(설치|추가|가져와|업데이트|install|import|update)/i,
    /(설치|추가|install)[^\n]{0,20}?(확장|플러그인|extension|plugin)/i,
    /(마켓플레이스|marketplace)[^\n]{0,30}?(설치|목록|보여|열어|install|list)/i,
    /import_extension_from_git/i,
];

/** 병렬 위임 의도 프리필터 — spawn_agents 사용 가이드 주입 게이트 (도구는 상시 노출).
 *  spawn 자발 채택 0 의 원인 = description 의 보수적 경고 + 사용 가이드 부재
 *  (2026-08-11 진단, 명시 유도 시엔 fan-out 정상 동작 실증 2026-07-17). */
export const SPAWN_INTENT_PATTERNS: readonly RegExp[] = [
    /(병렬|동시)(로|에)?\s*(조사|검색|리서치|분석|처리|수행|실행|진행)/i,
    /(서브|하위)\s*에이전트|subagent|sub-agent/i,
    /spawn_agents/i,
    /(각각|나눠서|나누어)\s*(조사|검색|분석|알아보)/i,
    /in\s+parallel|parallel\s+(research|search|tasks)/i,
];


/**
 * 에이전트 자가개선 루프 (F2) — 피드백 수집 → 품질 분석 → 프롬프트 제안 → 관리자 승인 → 주입.
 *
 * 운영에서 제안이 0건이던 원인이 세 갈래였다(마이그 099 주석 + 아래 항목):
 *   ① 입력 부재 — 채팅 thumbs 신호가 학습 시스템으로 흘러들지 않았다 (SIGNAL_RATING 배선으로 해소).
 *   ② 휘발 — 피드백이 인메모리 배열에만 있고 부팅 시 복원되지 않았다 (HYDRATE_LIMIT).
 *   ③ 미실행 — 24h setInterval 뿐이라 재시작이 잦은 환경에선 사실상 돌지 않았다 (FIRST_RUN_DELAY_MS).
 *
 * SIGNAL_RATING: 채팅 피드백 신호를 학습 시스템의 1~5 평점으로 환산하는 매핑.
 *   regenerate 는 명시적 불만은 아니나 재생성을 부른 응답이므로 낮게 둔다.
 * HYDRATE_LIMIT: 부팅 시 agent_feedback 에서 복원할 최근 피드백 수 (인메모리 상한도 겸함).
 * FIRST_RUN_DELAY_MS: 부팅 후 첫 사이클까지의 지연 — 부팅 폭주를 피하면서도 24h 를 기다리지 않는다.
 * INTERVAL_MS: 이후 사이클 주기.
 */
export const AGENT_SELF_IMPROVE = {
    SIGNAL_RATING: {
        thumbs_up: 5,
        thumbs_down: 1,
        regenerate: 2,
    } as Record<string, 1 | 2 | 3 | 4 | 5>,
    HYDRATE_LIMIT: parseInt(process.env.AGENT_SELF_IMPROVE_HYDRATE_LIMIT || '2000', 10),
    FIRST_RUN_DELAY_MS: parseInt(process.env.AGENT_SELF_IMPROVE_FIRST_RUN_DELAY_MS || '300000', 10),
    INTERVAL_MS: parseInt(process.env.AGENT_SELF_IMPROVE_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10),
} as const;

/**
 * 주간 게이트 판정 리포트 — measure-first 게이트(워크플로우·오케스트레이션·tail 셰도우)의
 * 판정 근거를 무-LLM 결정적 렌더로 주 1회 스냅샷한다 (monitoring/gate-report.ts).
 * 예약 리포트의 공개 정적 게시(schedule-publish)를 재사용하지 않는 이유: 그 경로는 인증
 * 없이 서빙되는데 이 리포트는 운영 지표라 admin push + admin 전용 라우트로만 노출한다.
 */
export const GATE_REPORT = {
    /** 기본 ON — 읽기 전용 집계 + admin 전용 노출. GATE_REPORT_ENABLED=false 로 해제. */
    ENABLED: process.env.GATE_REPORT_ENABLED !== 'false',
    /** 생성 요일 (ISO 1=월 ~ 7=일). GATE_REPORT_WEEKDAY(기본 1=월). */
    WEEKDAY: parseInt(process.env.GATE_REPORT_WEEKDAY || '1', 10),
    /** due 체크 주기(ms) — 해당 요일에 당일 스냅샷 부재 시 생성(멱등). GATE_REPORT_CHECK_INTERVAL_MS(기본 1h). */
    CHECK_INTERVAL_MS: parseInt(process.env.GATE_REPORT_CHECK_INTERVAL_MS || '', 10) || 60 * 60 * 1000,
    /** 집계 기간(일). GATE_REPORT_WINDOW_DAYS(기본 7). */
    WINDOW_DAYS: parseInt(process.env.GATE_REPORT_WINDOW_DAYS || '7', 10),
    /** 판정 힌트 최소 표본 — 미만이면 '표본 부족 — 계속 관측'. GATE_REPORT_MIN_SAMPLE(기본 30). */
    MIN_SAMPLE: parseInt(process.env.GATE_REPORT_MIN_SAMPLE || '30', 10),
    /** 스냅샷 저장 디렉토리 — 레포 루트 /data/ 는 gitignore 런타임 영역. GATE_REPORT_DIR. */
    DIR: process.env.GATE_REPORT_DIR || `${process.cwd()}/data/gate-reports`,
    /** 날짜·요일 판정 기준 TZ. GATE_REPORT_TZ(기본 Asia/Seoul). */
    TZ: process.env.GATE_REPORT_TZ || 'Asia/Seoul',
} as const;

/**
 * MCP 샌드박스 부트스트랩 (mcp/sandbox-bootstrap.ts) — 부팅 자세 점검 + 셋업 기본 활성화.
 */
export const MCP_SANDBOX_BOOTSTRAP = {
    /**
     * `docker image inspect` 프로브 timeout(ms) — Docker VM 스토리지 정지 시 exec 는 되는데
     * 조회가 hang 하는 실사례가 있어(2026-08 EINTR 다운) 셋업 요청을 물고 늘어지지 않게 제한.
     * MCP_SANDBOX_DOCKER_PROBE_TIMEOUT_MS
     */
    DOCKER_PROBE_TIMEOUT_MS: parseInt(process.env.MCP_SANDBOX_DOCKER_PROBE_TIMEOUT_MS || '', 10) || 5000,
    /**
     * 고아 컨테이너 스윕의 `docker stop` timeout(ms) — stop 은 grace 10s 후 KILL 이라
     * 프로브보다 길게. MCP_SANDBOX_DOCKER_STOP_TIMEOUT_MS
     */
    DOCKER_STOP_TIMEOUT_MS: parseInt(process.env.MCP_SANDBOX_DOCKER_STOP_TIMEOUT_MS || '', 10) || 20000,
    /**
     * 서버 삭제 뒤 캐시 볼륨 정리 — 컨테이너(--rm)가 내려가는 동안은 "사용 중"으로 실패하므로 간격을 두고 다시 시도한다.
     * MCP_SANDBOX_CACHE_VOLUME_CLEANUP=false 로 끈다(볼륨을 남긴다).
     */
    CACHE_VOLUME_CLEANUP_ENABLED: process.env.MCP_SANDBOX_CACHE_VOLUME_CLEANUP !== 'false',
    CACHE_VOLUME_RM_ATTEMPTS: 3,
    CACHE_VOLUME_RM_RETRY_MS: 2000,
    /** 부팅 고아 스윕 게이트 — MCP_SANDBOX_ORPHAN_REAP=false 로 해제 (기본 on) */
    ORPHAN_REAP_ENABLED: process.env.MCP_SANDBOX_ORPHAN_REAP !== 'false',
    /** 1회 스윕에서 처리할 최대 컨테이너 수 (폭주 안전판) */
    ORPHAN_REAP_MAX: parseInt(process.env.MCP_SANDBOX_ORPHAN_REAP_MAX || '', 10) || 50,
} as const;

/**
 * 민감 파일 글롭 — 단일 출처는 @openmake/config (디바이스 코어와 공유). 두 소비처:
 *  ① 코드 탐색(grep_code·repo_map) 제외 — 승인이 도구 단위라 사용자는 어떤 파일을 읽을지
 *     보지 못한다. 정책과 무관하게 훑기에서 제외한다(봉쇄가 아니라 위생 — file_ops read 는 별도 게이트).
 *  ② 쓰기 승인 상향(approval-gate) — high-risk 정책에서 이 경로에 쓰는 호출은 승인 대상.
 */
export { SENSITIVE_FILE_PATTERNS } from '@openmake/config';
import { SENSITIVE_FILE_PATTERNS } from '@openmake/config';

/**
 * Task 샌드박스 코드 탐색 도구(grep_code·repo_map, 2026-09-06) 상한.
 * 30일 실측: bash 호출 444건 중 탐색·읽기(grep/find/ls/cat)가 150건(34%)이고 결과가 통째로 대화에
 * 들어갔다. 전용 도구는 결과를 파일:줄 형태로 캡을 걸어 돌려준다(읽기 전용, 승인 대상 아님).
 * ⚠️ 이름에 'search' 를 쓰지 않는다 — AGENT_TASK_LIMITS.SEARCH_TOOL_KEYWORDS 가 웹검색 상한으로 센다.
 */
export const TASK_CODE_NAV = {
    /** grep_code 가 돌려주는 최대 매치 줄 수. TASK_CODE_NAV_GREP_MAX_RESULTS 로 오버라이드. */
    GREP_MAX_RESULTS: parseInt(process.env.TASK_CODE_NAV_GREP_MAX_RESULTS || '80', 10),
    /** 매치 줄 한 줄의 최대 글자(미니파이 파일 방어). */
    GREP_LINE_MAX_CHARS: parseInt(process.env.TASK_CODE_NAV_GREP_LINE_MAX_CHARS || '200', 10),
    /** 파일당 최대 매치 수(rg -m). */
    GREP_PER_FILE_MAX: parseInt(process.env.TASK_CODE_NAV_GREP_PER_FILE_MAX || '20', 10),
    /** repo_map 이 나열하는 최대 파일 수(줄 수 포함). */
    MAP_MAX_FILES: parseInt(process.env.TASK_CODE_NAV_MAP_MAX_FILES || '300', 10),
    /** repo_map 심볼 개요 최대 줄 수(function/class/def 선언). */
    MAP_MAX_SYMBOLS: parseInt(process.env.TASK_CODE_NAV_MAP_MAX_SYMBOLS || '200', 10),
    /** 탐색에서 제외하는 디렉토리(빌드 산출물·의존성·VCS). */
    EXCLUDED_DIRS: ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'coverage', '.openmake'] as readonly string[],
    /** 탐색에서 제외하는 파일(자격증명) — 위 SENSITIVE_FILE_PATTERNS 단일 목록. */
    EXCLUDED_FILES: SENSITIVE_FILE_PATTERNS,
} as const;

/**
 * 조직·테넌트 컨텍스트 (F22 Phase A, 2026-09-17).
 * 멤버십·활성 조직·예산 조직 조회 캐시 TTL — 변경 REST 는 clearOrgMembershipCache 로 즉시 무효화한다.
 */
/**
 * Add-on 상태 캐시 보존(ms) — 관리자 토글이 다른 프로세스에서 일어나도 이 시간 안에 반영된다.
 * 같은 프로세스의 쓰기는 캐시를 즉시 비운다. `ADDON_STATE_CACHE_TTL_MS` 로 오버라이드.
 */
export const ADDON_STATE_CACHE_TTL_MS = parseInt(process.env.ADDON_STATE_CACHE_TTL_MS || '30000', 10);

/**
 * Add-on 런타임 진입점(`entry.runtime`) 시작 상한(ms) — 넘으면 그 add-on 은 runtime_failed 로 회수하고 host.signal 을 끊는다.
 * 외부 서버 초기 연결(서버마다 연결 시도)을 하는 런타임이 가장 길다 — 그 경우를 실패로 만들지 않도록 넉넉히 둔다.
 * `ADDON_START_TIMEOUT_MS` 로 오버라이드.
 */
export const ADDON_START_TIMEOUT_MS = parseInt(process.env.ADDON_START_TIMEOUT_MS || '120000', 10);

/**
 * Add-on 정지(drain) 상한(ms) — 관리자 토글과 프로세스 종료가 진행 중 작업을 기다리는 시간. 넘으면 취소 신호를 보내고 더 기다리지 않는다.
 * 종료 경로 예산: 연결 유예 10초 + 에이전트 작업 12초 + 이 값이 전체 30초 안에 들고 뒤 단계(도구 런타임·OTel·DB) 몫 3초를 남기도록 5초.
 * `ADDON_DRAIN_TIMEOUT_MS` 로 오버라이드.
 */
export const ADDON_DRAIN_TIMEOUT_MS = parseInt(process.env.ADDON_DRAIN_TIMEOUT_MS || '5000', 10);

/**
 * `/api/health` 의 add-on 절 하나를 기다리는 상한(ms) — 넘으면 그 절만 `{ error: 'timeout …' }`. 헬스 응답이 DB 지연에 묶이지 않게.
 * `HEALTH_SECTION_TIMEOUT_MS` 로 오버라이드.
 */
export const HEALTH_SECTION_TIMEOUT_MS = parseInt(process.env.HEALTH_SECTION_TIMEOUT_MS || '1000', 10);

export const ORG_CONTEXT = {
    /** 사용자별 멤버십·활성 조직 캐시 보존(ms). ORG_CONTEXT_CACHE_TTL_MS 로 오버라이드. */
    CACHE_TTL_MS: parseInt(process.env.ORG_CONTEXT_CACHE_TTL_MS || '60000', 10),
} as const;

/**
 * 쿼터 예약(F25 PR-2) — LLM 호출 전에 추정 토큰을 버킷에 선반영하고 응답 후 실측으로 정산한다.
 */
export const QUOTA_RESERVE = {
    /** 출력 토큰 예약 기본값(num_predict 미지정 시). QUOTA_RESERVE_OUTPUT_TOKENS */
    OUTPUT_TOKENS: parseInt(process.env.QUOTA_RESERVE_OUTPUT_TOKENS || '1024', 10),
    /** 정산 잡 주기(ms, 기본 6시간). QUOTA_RECONCILE_INTERVAL_MS */
    RECONCILE_INTERVAL_MS: parseInt(process.env.QUOTA_RECONCILE_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10),
    /** 정산 잡 활성(기본 true). QUOTA_RECONCILE_ENABLED=false 로 끔 */
    RECONCILE_ENABLED: process.env.QUOTA_RECONCILE_ENABLED !== 'false',
} as const;

/** 쿼터 추가 한도·이월·초과 요청 (F25 PR-3b). */
export const QUOTA_GRANTS = {
    /** 직전 버킷 미사용분 이월 비율 0~1 (기본 0 = 비활성). QUOTA_ROLLOVER_RATIO */
    ROLLOVER_RATIO: parseFloat(process.env.QUOTA_ROLLOVER_RATIO || '0'),
    /** 이월 상한 토큰(0 = 상한 없음). QUOTA_ROLLOVER_CAP_TOKENS */
    ROLLOVER_CAP_TOKENS: parseInt(process.env.QUOTA_ROLLOVER_CAP_TOKENS || '0', 10),
    /** 초과 시 승인 요청 자동 생성 (기본 false). QUOTA_OVERAGE_AUTO_REQUEST=true */
    OVERAGE_AUTO_REQUEST: process.env.QUOTA_OVERAGE_AUTO_REQUEST === 'true',
    /** 초과 요청 유효 기간(ms, 기본 7일). QUOTA_OVERAGE_REQUEST_TTL_MS */
    OVERAGE_REQUEST_TTL_MS: parseInt(process.env.QUOTA_OVERAGE_REQUEST_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10),
    /** 자동 요청 시 요청량 = 설정 한도 × 이 비율 (기본 0.5). QUOTA_OVERAGE_AUTO_REQUEST_RATIO */
    OVERAGE_AUTO_REQUEST_RATIO: parseFloat(process.env.QUOTA_OVERAGE_AUTO_REQUEST_RATIO || '0.5'),
} as const;

/** 승인함 "최근 결정" 조회 창(ms, 기본 30분) — 철회 가능한 미소비 승인을 찾는 범위. APPROVAL_RECENT_WINDOW_MS */
export const APPROVAL_RECENT_WINDOW_MS = parseInt(process.env.APPROVAL_RECENT_WINDOW_MS || String(30 * 60 * 1000), 10);

/** 채팅 요청 멱등(140) — clientRequestId 기억 TTL·사용자당 상한. IDEMPOTENCY_TTL_MS / IDEMPOTENCY_MAX_PER_OWNER */
export const IDEMPOTENCY = {
    TTL_MS: parseInt(process.env.IDEMPOTENCY_TTL_MS || String(10 * 60 * 1000), 10),
    MAX_PER_OWNER: parseInt(process.env.IDEMPOTENCY_MAX_PER_OWNER || '200', 10),
} as const;

/**
 * 채팅의 도구 카드 — 도구 호출이 끝날 때마다 화면으로 보내는 요약의 길이 상한(글자). 결과 전문은 보내지 않는다.
 * CHAT_TOOL_CARD_PREVIEW_CHARS(결과 미리보기, 기본 600) / CHAT_TOOL_CARD_ARGS_CHARS(인자 요약, 기본 400).
 */
export const CHAT_TOOL_CARD = {
    PREVIEW_CHARS: parseInt(process.env.CHAT_TOOL_CARD_PREVIEW_CHARS || '600', 10),
    ARGS_CHARS: parseInt(process.env.CHAT_TOOL_CARD_ARGS_CHARS || '400', 10),
} as const;

/**
 * 에이전트 작업 진행 이벤트 보관(순번·재전송) — 재연결한 클라이언트에 놓친 이벤트를 다시 주기 위해 사용자별로 잠깐 둔다.
 * AGENT_TASK_PROGRESS_LOG_MAX_EVENTS(사용자당 개수, 기본 200) / AGENT_TASK_PROGRESS_LOG_TTL_MS(보관 시간, 기본 10분).
 * SWEEP_EVERY_APPENDS: 이만큼 기록할 때마다 이벤트가 없어진 사용자 기록을 정리한다.
 */
export const AGENT_TASK_PROGRESS_LOG = {
    MAX_EVENTS_PER_USER: parseInt(process.env.AGENT_TASK_PROGRESS_LOG_MAX_EVENTS || '200', 10),
    TTL_MS: parseInt(process.env.AGENT_TASK_PROGRESS_LOG_TTL_MS || String(10 * 60 * 1000), 10),
    SWEEP_EVERY_APPENDS: 500,
} as const;

/**
 * 에이전트 작업 생성 중복 방지 — 같은 Idempotency-Key 의 재요청(더블 클릭·네트워크 재전송)은 새로 만들지 않는다.
 * TTL_MS: 키 기억 시간. DELEGATE_WINDOW_MS: 채팅에서 위임한 작업(delegate_agent_task)은 키가 없어 같은 사용자·목표·턴 수를
 * 이 창 안에서 한 번만 만든다(0 이면 끔). AGENT_TASK_CREATE_IDEMPOTENCY_TTL_MS / _MAX_PER_OWNER / AGENT_TASK_DELEGATE_DEDUPE_WINDOW_MS
 */
export const AGENT_TASK_CREATE_IDEMPOTENCY = {
    TTL_MS: parseInt(process.env.AGENT_TASK_CREATE_IDEMPOTENCY_TTL_MS || String(10 * 60 * 1000), 10),
    MAX_PER_OWNER: parseInt(process.env.AGENT_TASK_CREATE_IDEMPOTENCY_MAX_PER_OWNER || '200', 10),
    DELEGATE_WINDOW_MS: process.env.AGENT_TASK_DELEGATE_DEDUPE_WINDOW_MS !== undefined && process.env.AGENT_TASK_DELEGATE_DEDUPE_WINDOW_MS !== ''
        ? Math.max(0, Number(process.env.AGENT_TASK_DELEGATE_DEDUPE_WINDOW_MS) || 0) : 60 * 1000,
} as const;

/**
 * 종료 알림 유실 재전송(174) — 종료 상태는 저장됐는데 알림(화면 이벤트·푸시)을 못 보낸 작업을 주기 점검이 다시 알린다.
 * SWEEP_MS: 점검 주기. GRACE_MS: 정상 경로가 방금 쓴 행을 가로채지 않게 두는 여유. WINDOW_MS: 이보다 오래된 것은 보내지 않는다.
 * AGENT_TASK_TERMINAL_NOTIFY_SWEEP_MS / _GRACE_MS / _WINDOW_MS / _BATCH
 */
export const AGENT_TASK_TERMINAL_NOTIFY = {
    SWEEP_MS: parseInt(process.env.AGENT_TASK_TERMINAL_NOTIFY_SWEEP_MS || String(60 * 1000), 10),
    GRACE_MS: parseInt(process.env.AGENT_TASK_TERMINAL_NOTIFY_GRACE_MS || String(30 * 1000), 10),
    WINDOW_MS: parseInt(process.env.AGENT_TASK_TERMINAL_NOTIFY_WINDOW_MS || String(24 * 60 * 60 * 1000), 10),
    BATCH: parseInt(process.env.AGENT_TASK_TERMINAL_NOTIFY_BATCH || '50', 10),
} as const;

/** 세션 복제·트리(F08 PR-6) — 복제 메시지 상한·조상 탐색 깊이. SESSION_CLONE_MAX_MESSAGES / SESSION_TREE_MAX_DEPTH */
export const SESSION_BRANCH = {
    CLONE_MAX_MESSAGES: parseInt(process.env.SESSION_CLONE_MAX_MESSAGES || '500', 10),
    TREE_MAX_DEPTH: parseInt(process.env.SESSION_TREE_MAX_DEPTH || '20', 10),
} as const;

/**
 * 노드 지표 스크레이프·큐 깊이(F24.4, 143). 대상은 VLLM_METRICS_URLS(쉼표 목록) — 비어 있으면 LLM_TOKENIZE_URL 의 origin + /metrics
 * (같은 vLLM 이 /metrics 를 노출). DCGM exporter(:9400) URL 을 목록에 더하면 GPU util·메모리·온도도 읽는다. 끄기 NODE_METRICS_ENABLED=false.
 */
export const NODE_METRICS = {
    ENABLED: process.env.NODE_METRICS_ENABLED !== 'false',
    URLS: (process.env.VLLM_METRICS_URLS || '').split(',').map((u) => u.trim()).filter(Boolean),
    POLL_MS: parseInt(process.env.NODE_METRICS_POLL_MS || '', 10) || 60_000,
    TIMEOUT_MS: 3_000,
    QUEUE_SAMPLE_MS: 30_000,
    RETENTION_DAYS: parseInt(process.env.NODE_METRICS_RETENTION_DAYS || '', 10) || 14,
    /** 이 시간 넘게 스크레이프가 실패하면 stale 로 표시 */
    STALE_AFTER_MS: 3 * 60_000,
    /** 관리자 추이 조회 기간(시간) 기본·상한과 기간별 집계 버킷(분) — [기간 상한, 버킷] 오름차순 */
    SERIES_DEFAULT_HOURS: 6,
    SERIES_MAX_HOURS: 14 * 24,
    SERIES_BUCKETS: [[6, 5], [48, 30], [Infinity, 180]] as ReadonlyArray<readonly [number, number]>,
} as const;

/** LLM 요청 셰도우 계측(F06.2 G0, 158) — 호출 1건당 1행(fire-and-forget), 90일 보존. 끄기 LLM_REQUEST_METRICS_ENABLED=false */
export const LLM_REQUEST_METRICS = {
    ENABLED: process.env.LLM_REQUEST_METRICS_ENABLED !== 'false',
    RETENTION_DAYS: parseInt(process.env.LLM_REQUEST_METRICS_RETENTION_DAYS || '', 10) || 90,
    ERROR_CODE_MAX_CHARS: 64,
} as const;

/** 0 이상 정수 env(일·건수) — 비었거나 잘못되면 기본값. 0 은 "끔"으로 그대로 둔다. */
const nonNegIntEnv = (v: string | undefined, def: number): number => {
    const n = parseInt(v || '', 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
};

/**
 * 에이전트 작업 보존(Companion 설계 01장 — 작업 기록·감사 로그 90일, 화면 캡처 30일). 주기 작업은 schedulers/index.ts,
 * 본체는 services/agent-task/task-retention.ts. 전체 스위치 AGENT_TASK_RETENTION_ENABLED 는 운영 기본 ON(W3),
 * dev/test 기본 OFF — 끄려면 false 명시. 각 기간은 0 이면 그 항목만 끈다. DRY_RUN 이면 건수만 세고 지우지 않는다.
 */
export const AGENT_TASK_RETENTION = {
    ENABLED: boolEnvDefault(process.env.AGENT_TASK_RETENTION_ENABLED, true),
    /** true 명시 때만 — 지우는 대신 같은 조건의 건수만 세어 로그에 남긴다(ENABLED 가 꺼져 있어도 스윕은 돈다) */
    DRY_RUN: process.env.AGENT_TASK_RETENTION_DRY_RUN === 'true',
    /** 끝난(completed·failed·cancelled) 지 N일 지난 작업의 작업·단계·승인 기록, 같은 기간 지난 작업 감사 로그 삭제 */
    RECORD_RETENTION_DAYS: nonNegIntEnv(process.env.AGENT_TASK_RECORD_RETENTION_DAYS, 90),
    /** 서버 샌드박스 작업 공간의 화면 캡처(이미지 파일) — 수정된 지 N일 지난 것 삭제(작업 기록은 남김) */
    SCREENSHOT_RETENTION_DAYS: nonNegIntEnv(process.env.AGENT_TASK_SCREENSHOT_RETENTION_DAYS, 30),
    /** 한 회차에 항목별로 지우는 건수 상한(작업·감사 로그·이미지 파일 각각) — 남은 것은 다음 주기에 */
    BATCH_LIMIT: nonNegIntEnv(process.env.AGENT_TASK_RETENTION_BATCH_LIMIT, 500) || 500,
    /** 화면 캡처로 보는 확장자(소문자) — 브라우저 도구 screenshot 은 jpeg/png */
    SCREENSHOT_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp'] as readonly string[],
    /** 끝난(completed·failed·cancelled) 작업의 체크포인트를 작업마다 마지막 턴만 남기고 지운다 — 운영 기본 ON(W3) */
    CHECKPOINT_COMPACT_ENABLED: boolEnvDefault(process.env.AGENT_TASK_CHECKPOINT_COMPACT_ENABLED, true),
    /** 끝난 지 이만큼(ms) 지난 작업만 압축 — 기본 24시간 */
    CHECKPOINT_COMPACT_AFTER_MS: nonNegIntEnv(process.env.AGENT_TASK_CHECKPOINT_COMPACT_AFTER_MS, 24 * 60 * 60_000),
};

/** 메시지 웹검색 출처(F19.4, 156) — 스트리밍 중 모아 assistant 행 저장 때 영속. 인메모리 대기는 TTL·개수 상한 */
export const MESSAGE_SOURCES_LIMITS = {
    TTL_MS: 30 * 60_000,
    MAX_PENDING: 500,
    /** 턴 누적 상한 — 사전 주입(10) 뒤로 web_search 호출마다 10건씩 번호가 이어진다. 넘는 번호는 본문 [N] 칩이 빈다 */
    MAX_SOURCES: 60,
    MAX_TITLE_CHARS: 300,
    MAX_URL_CHARS: 2_000,
    MAX_SNIPPET_CHARS: 400,
} as const;

/** 디버그 큐 재현 번들(F24.7, 144) — 세션별 마지막 LLM 요청 본문을 메모리에 잠깐 들고 있다가 오류·신고 시 보관. */
export const REPLAY_CAPTURE = {
    ENABLED: process.env.REPLAY_CAPTURE_ENABLED !== 'false',
    /** 번들 최대 바이트 — 넘으면 도구 결과부터, 그다음 오래된 대화부터 자른다. REPLAY_BUNDLE_MAX_BYTES */
    MAX_BYTES: parseInt(process.env.REPLAY_BUNDLE_MAX_BYTES || '', 10) || 256 * 1024,
    /** 세션당 보관 턴 수(도구 루프 안의 마지막 LLM 호출들) */
    TURNS_PER_SESSION: 2,
    /** 메모리 보관 시간·세션 수 상한 — 신고는 보통 응답 직후라 짧게 */
    TTL_MS: 30 * 60 * 1000,
    MAX_SESSIONS: 300,
    /** 관리자 REST 리플레이 분당 상한 — 실제 LLM 호출 비용 */
    REPLAY_PER_MINUTE: 3,
    /** 관리자 디버그 큐 목록 — 한 번에 돌려주는 최대 행 수·본문 미리보기 글자 수 */
    LIST_MAX: 100,
    LIST_PREVIEW_CHARS: 160,
} as const;

/** 채팅 요청 사실 테이블(F24.2, 142) — 요청당 1행 지문·결과. CHAT_REQUESTS_ENABLED=false 로 끔. */
export const CHAT_REQUESTS = {
    ENABLED: process.env.CHAT_REQUESTS_ENABLED !== 'false',
    /** 요청 행 보존(일). CHAT_REQUESTS_RETENTION_DAYS */
    RETENTION_DAYS: parseInt(process.env.CHAT_REQUESTS_RETENTION_DAYS || '90', 10),
    /** 지문 원문 보존 — 마지막 사용 후(일) */
    FINGERPRINT_RETENTION_DAYS: 180,
    /** 프로세스가 이미 upsert 한 지문 기억 수 — 매 요청 원문(~10KB) 재기록을 막는다 */
    FINGERPRINT_SEEN_MAX: 500,
} as const;

/** 로그 자격증명 마스킹(F24.6) — utils/logger 가 출력 직전에 적용. LOG_REDACT_SECRETS=false 로 끔. */
export const LOG_REDACT = {
    ENABLED: process.env.LOG_REDACT_SECRETS !== 'false',
    /** 이보다 짧은 문자열은 검사하지 않는다(토큰은 12자 이상) */
    MIN_LEN: 12,
} as const;

/** 아티팩트 댓글(F20.6, 147) — 본문 상한은 147 CHECK 와 짝. */
export const ARTIFACT_COMMENT_LIMITS = {
    BODY_MAX_CHARS: 4000,
    /** 아티팩트당 목록 최대 행. ARTIFACT_COMMENT_LIST_MAX */
    LIST_MAX: parseInt(process.env.ARTIFACT_COMMENT_LIST_MAX || '500', 10),
    /** 작성·수정 레이트 리밋(분당). ARTIFACT_COMMENT_RATE_USER / ARTIFACT_COMMENT_RATE_IP */
    RATE_WINDOW_MS: 60_000,
    RATE_USER: parseInt(process.env.ARTIFACT_COMMENT_RATE_USER || '30', 10),
    RATE_IP: parseInt(process.env.ARTIFACT_COMMENT_RATE_IP || '60', 10),
} as const;

/** 외부 MCP resources/prompts 메타 도구(F13.2) — 목록 상한. MCP_RESOURCE_LIST_MAX */
export const MCP_RESOURCE_LIMITS = {
    LIST_MAX: parseInt(process.env.MCP_RESOURCE_LIST_MAX || '100', 10),
} as const;

/**
 * 외부 MCP elicitation(서버→클라이언트 사용자 입력 요청) → 에이전트 작업 승인함(F13.10, 2026-09-17).
 * 기본 OFF — 켜면 사용자 풀 서버에만 `elicitation.form` 을 광고한다(연결 시점에 정해지므로 재기동 후 반영).
 * 채팅 경로·작업 문맥이 모호한 호출은 decline 으로 즉시 응답한다. MCP_ELICITATION_ENABLED
 */
export const MCP_ELICITATION_ENABLED = process.env.MCP_ELICITATION_ENABLED === 'true';

export const MCP_ELICITATION_LIMITS = {
    /** 사용자 입력 대기가 아닐 때의 도구 호출 마감(ms) — SDK 기본 요청 타임아웃과 같다. 입력 대기 중엔 연장. MCP_ELICITATION_CALL_TIMEOUT_MS */
    CALL_TIMEOUT_MS: parseInt(process.env.MCP_ELICITATION_CALL_TIMEOUT_MS || '60000', 10),
    /** SDK 요청 자체의 절대 상한(ms) — 연장이 끝없이 이어지지 않게. 승인 대기 상한(TASK_SANDBOX_APPROVAL_TIMEOUT_MS)보다 커야 한다. MCP_ELICITATION_CALL_MAX_MS */
    CALL_MAX_MS: parseInt(process.env.MCP_ELICITATION_CALL_MAX_MS || String(2 * 60 * 60 * 1000), 10),
    /** 승인함에 싣는 서버 메시지 최대 길이(문자). MCP_ELICITATION_MESSAGE_MAX_CHARS */
    MESSAGE_MAX_CHARS: parseInt(process.env.MCP_ELICITATION_MESSAGE_MAX_CHARS || '2000', 10),
} as const;

/** elicitation boolean 필드의 자유텍스트 답변 해석표(F13.10) — 소문자 비교. */
export const MCP_ELICITATION_BOOLEAN_WORDS: Readonly<Record<string, boolean>> = {
    true: true, yes: true, y: true, '1': true, '예': true, '네': true,
    false: false, no: false, n: false, '0': false, '아니오': false, '아니요': false,
};

/** resources/prompts 메타 도구를 노출할 의도 턴 판정(F13.2) — 상시 노출 금지(프롬프트 다이어트). */
export const MCP_RESOURCE_INTENT_PATTERNS: readonly RegExp[] = [
    /리소스|resource|프롬프트\s*(템플릿|목록)|prompt\s*template|mcp.*(읽|read|목록|list)/i,
];

/** getAllTools 진입 시 stale 도구 재조회 동시성(F13.12). MCP_TOOL_REFRESH_CONCURRENCY */
export const MCP_TOOL_REFRESH_CONCURRENCY = parseInt(process.env.MCP_TOOL_REFRESH_CONCURRENCY || '4', 10);

/**
 * 인바운드 웹훅 트리거(F16.5, 132) — 서명 검증·남용 방지 상한.
 */
export const TRIGGER_LIMITS = {
    /** 타임스탬프 허용 창(초) — 재전송 방어. AGENT_TASK_TRIGGER_SIGNATURE_WINDOW_SEC */
    SIGNATURE_WINDOW_SEC: parseInt(process.env.AGENT_TASK_TRIGGER_SIGNATURE_WINDOW_SEC || '300', 10),
    /** 트리거당 분당 수신 상한. AGENT_TASK_TRIGGER_PER_MINUTE */
    PER_MINUTE: parseInt(process.env.AGENT_TASK_TRIGGER_PER_MINUTE || '30', 10),
    /** 수신 본문 상한(bytes). AGENT_TASK_TRIGGER_MAX_BODY_BYTES */
    MAX_BODY_BYTES: parseInt(process.env.AGENT_TASK_TRIGGER_MAX_BODY_BYTES || '', 10) || 64 * 1024,
    /** 유저당 트리거 수 상한. AGENT_TASK_TRIGGER_MAX_PER_USER */
    MAX_PER_USER: parseInt(process.env.AGENT_TASK_TRIGGER_MAX_PER_USER || '20', 10),
    /** 연속 실패 이 횟수면 자동 비활성. AGENT_TASK_TRIGGER_DISABLE_AFTER_FAILURES */
    DISABLE_AFTER_FAILURES: parseInt(process.env.AGENT_TASK_TRIGGER_DISABLE_AFTER_FAILURES || '5', 10),
} as const;

/**
 * 생성 산출물(Artifact Store, P04) — 파일 크기 상한과 전달 티켓 수명.
 * 티켓은 bearer 전용 클라이언트(iOS)가 `<img>` 로 쿠키 없이 받을 때 쓰는 짧은 수명·파일명 고정 HMAC 이다.
 */
export const GENERATED_ARTIFACT_LIMITS = {
    MAX_BYTES: parseInt(process.env.GENERATED_ARTIFACT_MAX_BYTES || String(64 * 1024 * 1024), 10),
    TICKET_TTL_MS: parseInt(process.env.GENERATED_ARTIFACT_TICKET_TTL_MS || String(10 * 60 * 1000), 10),
} as const;

/**
 * 서버 공용 키로 나가는 미디어 호출의 예약 토큰 추정치(P04, 계획서 9.2). 이미지·영상은 토큰을 돌려주지 않으므로 이 값을
 * **선예약**하고, provider 가 usage 를 주면 그 값으로 정산한다. 주지 않으면 예약분이 남는다 — unknown 을 0(무료)으로 정산하지 않는다.
 */
export const SERVER_KEY_MEDIA_RESERVE_TOKENS = parseInt(process.env.SERVER_KEY_MEDIA_RESERVE_TOKENS || '1000', 10);

/**
 * 공통 Job Runtime(P07/P07b) — 백그라운드 poller 는 기본 OFF(lease·재시작·중복 실행자 시험을 통과한 뒤 켠다).
 * 꺼져 있으면 종전처럼 다음 요청이 같은 job 을 재조회한다. 부팅 복구(submitting → submission_unknown)는 항상 돈다.
 */
export const JOB_RUNTIME = {
    POLLER_ENABLED: process.env.CAPABILITY_JOB_POLLER_ENABLED === 'true',
    POLL_INTERVAL_MS: parseInt(process.env.CAPABILITY_JOB_POLL_INTERVAL_MS || '30000', 10),
    LEASE_TTL_MS: parseInt(process.env.CAPABILITY_JOB_LEASE_TTL_MS || '120000', 10),
    BATCH: parseInt(process.env.CAPABILITY_JOB_POLL_BATCH || '5', 10),
    /** 이보다 오래된 submitting 만 부팅 복구 대상 — 다른 프로세스가 지금 보내는 중일 수 있다 */
    SUBMIT_RECOVERY_GRACE_MS: parseInt(process.env.CAPABILITY_JOB_SUBMIT_RECOVERY_GRACE_MS || '300000', 10),
    /** 결과 수집 연속 실패 상한 — 넘으면 collecting 에 멈춰 errorCode 만 남긴다(생성 실패로 닫지 않는다, 수동 재요청 가능) */
    COLLECT_MAX_RETRIES: parseInt(process.env.CAPABILITY_JOB_COLLECT_MAX_RETRIES || '5', 10),
} as const;
