/**
 * ============================================================
 * External Tool Plan — 채팅 턴의 도구 노출·억제·강제 결정
 * ============================================================
 *
 * external-provider 에서 분리(파일 크기 가드): 의도 프리필터 기반으로
 * "이 턴에 어떤 도구를 노출/억제하고 첫 턴에 무엇을 강제할지"를 한 곳에서 결정한다.
 *
 * - distractor 억제: 아티팩트/보고서 의도 → generate_image 등 제외 (2026-06-23 통제실험)
 * - 지도 의도 → 카카오 도구 강제(tool_choice), 명시 검색 의도 → web_search 강제
 * - 서브에이전트: delegate_expert(CHAT_SUBAGENT) · spawn_agents(AGENT_SPAWN)
 * - 오케스트레이션 자동 배정(Stage 1): 토론/작업위임 의도 프리필터 매칭 시에만
 *   start_discussion / delegate_agent_task 노출 (상시 노출 금지 — 도구폭주 방지)
 *
 * @module services/chat-service/external-tool-plan
 */
import {
    EXTERNAL_LLM_TOOL_BLACKLIST, ARTIFACT_REQUEST_SUPPRESSED_TOOLS, ARTIFACT_INTENT_PATTERNS,
    ROUTE_INTENT_PATTERNS, WEB_SEARCH_INTENT_PATTERNS, REPORT_PIPELINE, REPORT_INTENT_PATTERNS,
    CHAT_SUBAGENT, AGENT_SPAWN, ORCHESTRATION_DISPATCH, DISCUSSION_INTENT_PATTERNS, TASK_DELEGATE_INTENT_PATTERNS,
    PLAN_INTENT_PATTERNS,
} from '../../config/runtime-limits';
import { buildChatDelegateTool } from './chat-delegate';
import { buildSpawnAgentsTool } from '../agent-spawn/spawn-agents';
import { buildStartDiscussionTool, buildDelegateAgentTaskTool } from './orchestration-dispatch';
import type { ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ChatExternalProvider');

export interface OrchestrationIntents {
    discussion: boolean;
    taskDelegate: boolean;
}

/** PURE: 오케스트레이션 자동 배정 의도 감지 — 프롬프트 가이드 주입과 도구 노출이 공유. */
export function detectOrchestrationIntents(message: string | undefined): OrchestrationIntents {
    if (!ORCHESTRATION_DISPATCH.ENABLED) return { discussion: false, taskDelegate: false };
    const msg = message ?? '';
    return {
        discussion: DISCUSSION_INTENT_PATTERNS.some((re) => re.test(msg)),
        taskDelegate: TASK_DELEGATE_INTENT_PATTERNS.some((re) => re.test(msg)),
    };
}

export interface ExternalToolPlan {
    tools: ToolDefinition[];
    /** 첫 턴 tool_choice 강제 대상 (카카오 지도 > web_search 우선순위). */
    forcedFirstTurnToolName?: string;
}

/**
 * 이 턴의 도구 목록과 첫 턴 강제 도구를 결정한다.
 * (external-provider 의 기존 로직 이동 — 동작 동일, 오케스트레이션 노출만 추가)
 */
export function buildExternalToolPlan(params: {
    allowedTools: ToolDefinition[];
    req: ChatMessageRequest;
    toolCalling: boolean;
    wantsMap: boolean;
    tailWebGround?: boolean;
    orchestration: OrchestrationIntents;
}): ExternalToolPlan {
    const { allowedTools, req, toolCalling, wantsMap, tailWebGround, orchestration } = params;

    // 명시적 아티팩트 생성 요청(사용자 아티팩트 토글 또는 메시지 패턴)이면 distractor
    // always-on 도구(generate_image 등)를 제외해 모델이 도구 호출 대신 <artifact> 산출물을
    // 쓰도록 유도 (2026-06-23 통제실험 근거).
    // 보고서 의도(P1 파이프라인)는 산출물이 reportdata→아티팩트이므로 아티팩트 의도와
    // 동일하게 distractor 를 억제한다 (web_search 는 억제 목록에 없어 조사 가능).
    const wantsReport = REPORT_PIPELINE.ENABLED
        && REPORT_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    const wantsArtifact = req.artifactMode === true
        || wantsReport
        || ARTIFACT_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    // 위치/지도 의도(wantsMap)면 generate_image 를 제외 — 모델이 가짜 지도
    // 이미지를 그리는 대신 카카오 검색 + 네이티브 지도 블록을 쓰도록 유도 (distractor 억제).
    const tools = toolCalling
        ? allowedTools.filter((t) =>
            !EXTERNAL_LLM_TOOL_BLACKLIST.includes(t.function.name)
            && !(wantsArtifact && ARTIFACT_REQUEST_SUPPRESSED_TOOLS.includes(t.function.name))
            && !(wantsMap && t.function.name === 'generate_image'))
        : [];
    // 채팅 서브에이전트(chat-delegate): 전문가 위임 도구 노출 — 스키마 +1 은 문법 컴파일 무해.
    if (CHAT_SUBAGENT.ENABLED && toolCalling) {
        tools.push(buildChatDelegateTool());
    }
    // 병렬 서브에이전트 fan-out(spawn_agents): 독립 하위 작업 N개 병렬 위임 — agent-spawn 공용 모듈.
    if (AGENT_SPAWN.ENABLED && toolCalling) {
        tools.push(buildSpawnAgentsTool());
    }
    // 오케스트레이션 자동 배정(Stage 1): 의도 프리필터 매칭 턴에만 노출.
    if (orchestration.discussion && toolCalling) {
        tools.push(buildStartDiscussionTool());
        logger.info('[Orchestration] 토론 의도 감지 — start_discussion 노출');
    }
    if (orchestration.taskDelegate && toolCalling) {
        tools.push(buildDelegateAgentTaskTool());
        logger.info('[Orchestration] 작업 위임 의도 감지 — delegate_agent_task 노출');
    }
    if (wantsArtifact && toolCalling) {
        logger.info(`[Artifact] 명시적 아티팩트 요청 감지 — distractor 도구 억제 (잔여 도구 ${tools.length}종)`);
    }
    if (wantsMap && toolCalling) {
        logger.info(`[Map] 위치/지도 의도 감지 — generate_image 억제 (잔여 도구 ${tools.length}종)`);
    }
    // 지도/길찾기 의도 시 첫 턴에 카카오 도구를 강제 호출(tool_choice)한다. 길찾기면 find-route,
    // 그 외 지도면 search-places. 넛지만으론 qwen 이 web_search/자체아티팩트로 이탈 → 강제로
    // 블록 확보 후 결정적 주입.
    const routeIntent = ROUTE_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    const forcedKakaoToolName = toolCalling
        ? (routeIntent
            ? tools.find((t) => t.function.name.includes('find-route'))?.function.name
            : (wantsMap ? tools.find((t) => t.function.name.includes('search-places'))?.function.name : undefined))
        : undefined;
    if (forcedKakaoToolName) {
        logger.info(`[Map] 첫 턴 tool_choice 강제: ${forcedKakaoToolName}`);
    }
    // 명시적 웹 검색 요청이면 첫 턴에 web_search 를 강제한다 — 봇 히스토리에 남은
    // "검색 불가/오프라인" 자기 발언 재주입 시 qwen 이 시스템 지시로도 교정되지 않고
    // 도구 호출을 거부하는 환각의 결정적 차단 (카카오 tool_choice 강제와 동일 선례).
    const forcedWebSearchToolName = !forcedKakaoToolName
        && (WEB_SEARCH_INTENT_PATTERNS.some((re) => re.test(req.message ?? '')) || tailWebGround === true)
        ? tools.find((t) => t.function.name === 'web_search')?.function.name
        : undefined;
    if (forcedWebSearchToolName) {
        logger.info(tailWebGround === true
            ? '[TailGate] Stage 2B factual tail — 첫 턴 tool_choice 강제: web_search'
            : '[WebSearch] 명시적 검색 요청 — 첫 턴 tool_choice 강제: web_search');
    }
    // 명시적 계획수립 요청이면 첫 턴에 create_plan 을 강제한다 — 넛지만으론 qwen 이
    // 도구 대신 자체 계획 텍스트로 이탈해 review role(계획 모델 배정)이 발동하지 않는다
    // (web_search tool_choice 강제와 동일 선례). 도구는 getAllowedTools 강제 포함으로 실려온다.
    const forcedPlanToolName = !forcedKakaoToolName && !forcedWebSearchToolName
        && PLAN_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''))
        ? tools.find((t) => t.function.name === 'create_plan')?.function.name
        : undefined;
    if (forcedPlanToolName) {
        logger.info('[PlanMode] 계획수립 의도 — 첫 턴 tool_choice 강제: create_plan');
    }
    const forcedFirstTurnToolName = forcedKakaoToolName ?? forcedWebSearchToolName ?? forcedPlanToolName;

    return {
        tools,
        ...(forcedFirstTurnToolName ? { forcedFirstTurnToolName } : {}),
    };
}
