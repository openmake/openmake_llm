/**
 * 채팅 턴 도구 선별 (F26.2 분리) — 상시 노출(always-on)·의도 턴 강제 포함을 결정한다.
 *
 * ChatService.getAllowedTools 에서 옮긴 순수 판정(로깅만 부수효과): 토글·스킬 머지(merged)와 사용자 MCP 자동 노출
 * 결과를 받아 이 턴에 모델에 실을 도구 목록을 돌려준다. 도구 선택 평가(evaluation/tool-selection-evaluator)가
 * 운영과 같은 판정으로 노출 누락·과다 회귀를 잡는다.
 *
 * @module services/chat-service/chat-tool-selection
 */
import { CHAT_ALWAYS_ON_TOOL_NAMES } from '../../mcp/agent-task-tools';
import { OPS_METRICS_TOOL_ENABLED, OPS_METRICS_INTENT_PATTERNS } from '../../config/ops-metrics';
import { MCP_META_TOOL_NAMES, MCP_RESOURCE_META_TOOL_NAMES } from '../../mcp/mcp-meta-tools';
import {
    MCP_PROGRESSIVE_DISCLOSURE_ENABLED, MAP_INTENT_PATTERNS, ROUTE_INTENT_PATTERNS, WEB_SEARCH_INTENT_PATTERNS, PLAN_INTENT_PATTERNS,
    EXTENSION_IMPORT_INTENT_PATTERNS, CHAT_TOOL_INTENT_GATE_ENABLED, AGENT_TASK_INTENT_PATTERNS, MCP_RESOURCE_INTENT_PATTERNS,
} from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import type { ToolDefinition } from '../../llm';

const logger = createLogger('ChatService');

export function selectTurnTools(params: {
    /** 역할 필터를 지난 전체 도구 */
    allTools: ToolDefinition[];
    /** 사용자 토글·프로파일 필수·스킬 바인딩 머지 결과 */
    merged: ToolDefinition[];
    /** 설치한 사용자 MCP 자동 노출분 */
    userMcpAutoOn: ToolDefinition[];
    message?: string;
    tailWebGround?: boolean;
}): ToolDefinition[] {
    const { allTools, merged, userMcpAutoOn, tailWebGround } = params;
    const msg = params.message ?? '';
    // 토글 없이 항상 제공: 에이전트 작업 조회 + (플래그 ON 시) MCP 진행적 공개 메타 도구.
    // 프롬프트 다이어트(2026-09-05): agent_task_list/get 은 작업 상태를 묻는 턴에만 —
    // 7일 실측 호출 0회인데 매 턴 ≈470 토큰. 게이트 OFF 면 종전(상시).
    const agentTaskWanted = !CHAT_TOOL_INTENT_GATE_ENABLED
        || AGENT_TASK_INTENT_PATTERNS.some((re) => re.test(msg));
    const baseAlwaysOn = agentTaskWanted
        ? CHAT_ALWAYS_ON_TOOL_NAMES
        : CHAT_ALWAYS_ON_TOOL_NAMES.filter((n) => !n.startsWith('agent_task_'));
    // resources/prompts 메타 도구(F13.2)는 의도 턴에만 — 상시 노출은 프롬프트 팽창(게이트 OFF 면 의도 판정 없이 포함).
    const resourceWanted = MCP_PROGRESSIVE_DISCLOSURE_ENABLED
        && (!CHAT_TOOL_INTENT_GATE_ENABLED || MCP_RESOURCE_INTENT_PATTERNS.some((re) => re.test(msg)));
    const alwaysOnNames: string[] = MCP_PROGRESSIVE_DISCLOSURE_ENABLED
        ? [...baseAlwaysOn, ...MCP_META_TOOL_NAMES, ...(resourceWanted ? MCP_RESOURCE_META_TOOL_NAMES : [])] : baseAlwaysOn;
    const alwaysOn = allTools.filter(t =>
        alwaysOnNames.includes(t.function.name) && !merged.some(m => m.function.name === t.function.name));
    // merged ∪ alwaysOn ∪ userMcpAutoOn — 이름 기준 중복 제거.
    const seen = new Set([...merged, ...alwaysOn].map(t => t.function.name));
    const combined = [...merged, ...alwaysOn, ...userMcpAutoOn.filter(t => !seen.has(t.function.name))];
    logger.debug(`MCP 도구 머지: all=${allTools.length} merged=${merged.length} alwaysOn=${alwaysOn.length} userMcpAutoOn=${userMcpAutoOn.length}`);

    // 지도/위치 의도면 카카오 장소 검색 도구를, 길찾기 의도면 find-route 를 강제 포함한다.
    // cap/relevance 선택에서 누락돼도 지도 렌더 체인(도구포함→tool_choice강제→블록주입)이
    // 끊기지 않게 한다.
    let finalCombined = combined;
    const forceIncludeKakao = (needle: string, label: string) => {
        const t = allTools.find((x) => x.function.name.includes(needle));
        if (t && !finalCombined.some((x) => x.function.name === t.function.name)) {
            finalCombined = [...finalCombined, t];
            logger.info(`[Map] ${label} — 카카오 ${needle} 강제 포함`);
        }
    };
    if (MAP_INTENT_PATTERNS.some((re) => re.test(msg))) {
        forceIncludeKakao('search-places', '지도 의도');
    }
    if (ROUTE_INTENT_PATTERNS.some((re) => re.test(msg))) {
        forceIncludeKakao('find-route', '길찾기 의도');
    }
    // 명시적 웹 검색 요청이면 web_search 를 강제 포함한다 — web_search 는 always-on 이
    // 아니라 에이전트 스킬 바인딩 경유로만 노출되므로, 에이전트 매칭이 안 되는 질문
    // (예: "인터넷 검색해서 날씨 알려줘")은 도구 자체가 목록에 없어 모델이 "검색 불가"
    // 로 답하던 결함(2026-07-17 Discord) 차단. 포함되면 외부 경로의 첫 턴 tool_choice
    // 강제(external-provider)까지 연쇄 작동한다. (카카오 강제 포함과 동일 선례)
    if (WEB_SEARCH_INTENT_PATTERNS.some((re) => re.test(msg))
        || tailWebGround === true) {
        const ws = allTools.find((x) => x.function.name === 'web_search');
        if (ws && !finalCombined.some((x) => x.function.name === ws.function.name)) {
            finalCombined = [...finalCombined, ws];
            logger.info(tailWebGround === true
                ? '[TailGate] Stage 2B factual tail — web_search 강제 포함'
                : '[WebSearch] 명시적 검색 요청 — web_search 강제 포함');
        }
    }
    // 명시적 계획수립 요청이면 create_plan 을 강제 포함한다 — create_plan(review role
    // 소비처)은 always-on 도, 스킬 바인딩도, 토글 UI 도 없어 채팅에서 도달 불가능하던
    // 갭 차단 (web_search 강제 포함과 동일 선례). 포함되면 외부 경로의 첫 턴
    // tool_choice 강제(external-tool-plan)까지 연쇄 작동한다.
    if (PLAN_INTENT_PATTERNS.some((re) => re.test(msg))) {
        const cp = allTools.find((x) => x.function.name === 'create_plan');
        if (cp && !finalCombined.some((x) => x.function.name === cp.function.name)) {
            finalCombined = [...finalCombined, cp];
            logger.info('[PlanMode] 계획수립 의도 — create_plan 강제 포함');
        }
    }
    // 확장/플러그인 설치 요청이면 import_extension_from_git 을 강제 포함한다 — import 계열은
    // always-on 이 아니라 토글로만 노출되는데, Settings 확장 탭 안내는 "채팅에서 요청" 이
    // 계약이라 노출 없이는 모델이 다른 도구로 이탈한다(2026-08-16 라이브 실측). 동일 선례:
    // web_search/create_plan 강제 포함.
    if (EXTENSION_IMPORT_INTENT_PATTERNS.some((re) => re.test(msg))) {
        const ie = allTools.find((x) => x.function.name === 'import_extension_from_git');
        if (ie && !finalCombined.some((x) => x.function.name === ie.function.name)) {
            finalCombined = [...finalCombined, ie];
            logger.info('[Extension] 확장 설치 의도 — import_extension_from_git 강제 포함');
        }
    }
    // 운영 지표 도구는 관리자 + 운영 질의 의도 턴에만(상시 노출 금지 — 프롬프트 다이어트).
    // allTools 는 이미 역할 필터를 지났으므로 비관리자에겐 애초에 없다(2차 방어는 실행 게이트).
    if (OPS_METRICS_TOOL_ENABLED && OPS_METRICS_INTENT_PATTERNS.some((re) => re.test(msg))) {
        const om = allTools.find((x) => x.function.name === 'ops_metrics');
        if (om && !finalCombined.some((x) => x.function.name === om.function.name)) {
            finalCombined = [...finalCombined, om];
            logger.info('[OpsMetrics] 운영 질의 의도 — ops_metrics 포함');
        }
    }
    return finalCombined;
}
