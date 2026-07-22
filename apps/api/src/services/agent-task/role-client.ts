/**
 * Agent Task 의 'agent'/'judge' role 클라이언트 해석 + 외부 모델 폴백 —
 * AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/role-client
 */
import { createClient, type LLMClient } from '../../llm';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import { getModelForRole } from '../../config/model-roles';
import { resolveRoleClientForUser } from '../model-role-resolver';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/** 턴 루프가 들고 다니는 role 클라이언트 상태 — 폴백 시 client 가 교체된다. */
export interface AgentRoleState {
    client: LLMClient;
    /** 외부 provider 해석 여부 — tools 4xx 로컬 폴백 판단용 */
    external: boolean;
    /** 폴백은 작업당 1회 — true 면 더 이상 강등하지 않음 */
    fallbackDone: boolean;
}

/**
 * 'agent' role 해석 (사용자 매핑 → 전역 env → 로컬 default, fail-open).
 * explicitClient 가 주어지면(생성자 model 명시) 해석을 건너뛰고 그대로 사용.
 */
export async function initAgentRoleState(
    taskId: string,
    userId: string,
    explicitClient?: LLMClient,
): Promise<AgentRoleState> {
    if (explicitClient) {
        return { client: explicitClient, external: false, fallbackDone: true };
    }
    const resolved = await resolveRoleClientForUser('agent', userId);
    const external = resolved.providerId !== 'local-llm';
    if (resolved.degraded) {
        logger.warn(`[AgentTask] ${taskId} agent role 폴백: ${resolved.degraded}`);
    } else if (external) {
        logger.info(`[AgentTask] ${taskId} agent role 외부 모델 사용: ${resolved.fullId}`);
    }
    return { client: resolved.client, external, fallbackDone: false };
}

/**
 * 턴 1회 chat 호출. reasoning OFF — qwen3.6 가 디자인/장문 작업에서 수만 토큰의
 * thinking 을 생성해 토큰 한도를 소진하고 deliverable 을 못 쓰는 폭주 차단.
 * 도구 루프의 단계별 reasoning 은 대화 구조 자체가 대신한다.
 *
 * 외부 role 모델의 4xx(tools 미지원 등 — 예: NVIDIA 소형 모델 tools 400) 는
 * 로컬 default 로 1회 강등 후 같은 턴을 재시도한다 (state.client 교체).
 * 재발/그 외 에러는 기존 경로대로 throw.
 */
export async function chatTurnWithRoleFallback(
    state: AgentRoleState,
    p: {
        conversation: ChatMessage[];
        tools: ToolDefinition[];
        signal: AbortSignal;
        taskId: string;
        userId: string;
    },
): Promise<Awaited<ReturnType<LLMClient['chat']>>> {
    // openai SDK 요청 타임아웃을 task 총 예산에 맞춰 늘린다(파생 클라이언트, baseUrl/model 유지).
    // 기본 LLM_TIMEOUT(120s)은 채팅용이라, 리포트·디자인 등 장문 생성 턴이 단일 요청에서 120s 를
    // 넘기면 "Request timed out" 으로 task 가 죽는다. 실제 한계는 p.signal(잔여 예산)이 governor.
    // SDK 요청 타임아웃 상한은 최대 예산(예약)에 맞춘다 — 실제 한계는 p.signal(잔여 예산)이 governor.
    const call = () => state.client.derive({ timeout: AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS })
        .chat(p.conversation, undefined, undefined, {
            tools: p.tools, signal: p.signal, think: false,
        });
    try {
        return await call();
    } catch (chatErr) {
        const status = (chatErr as { status?: number }).status;
        if (state.external && !state.fallbackDone
            && typeof status === 'number' && status >= 400 && status < 500) {
            state.fallbackDone = true;
            state.external = false;
            logger.warn(`[AgentTask] ${p.taskId} 외부 role 모델 ${status} — 로컬 폴백: ${chatErr instanceof Error ? chatErr.message : chatErr}`);
            state.client = createClient({ model: getModelForRole('agent'), userId: p.userId });
            return await call();
        }
        throw chatErr;
    }
}

/** 'judge' role 별도 해석 — agent 실행 모델과 판정 모델을 분리 배정 가능. */
export async function judgeClientFor(userId: string): Promise<LLMClient> {
    return (await resolveRoleClientForUser('judge', userId)).client;
}

/** 생성자 기본 클라이언트 — model 미지정 시 'agent' role 전역 티어. */
export function defaultAgentClient(model?: string): LLMClient {
    return createClient({ model: model || getModelForRole('agent') });
}
