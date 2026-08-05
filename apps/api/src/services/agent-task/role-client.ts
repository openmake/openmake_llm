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
 * 일시적 LLM 오류 판별 — 노드 retry 정책의 재시도 대상.
 * ① HTTP 5xx·408·429 ② status 없는 연결류(connection/timeout/reset 등) 만 참.
 * 4xx(429 제외)·abort·그 외 도메인 오류는 거짓 — 재시도해도 결과가 같은 부류.
 */
export function isTransientLLMError(err: unknown): boolean {
    const status = (err as { status?: number }).status;
    if (typeof status === 'number') {
        return status >= 500 || status === 408 || status === 429;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return /connection error|request timed out|econnrefused|econnreset|etimedout|socket hang up|fetch failed/i.test(msg);
}

/** abort 가능 대기 — 재시도 백오프 중 사용자 취소/예산 소진이 오면 즉시 중단. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error('aborted during retry backoff')); return; }
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        const onAbort = (): void => { clearTimeout(timer); reject(new Error('aborted during retry backoff')); };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * 턴 1회 chat 호출. reasoning OFF — qwen3.6 가 디자인/장문 작업에서 수만 토큰의
 * thinking 을 생성해 토큰 한도를 소진하고 deliverable 을 못 쓰는 폭주 차단.
 * 도구 루프의 단계별 reasoning 은 대화 구조 자체가 대신한다.
 *
 * 외부 role 모델의 4xx(tools 미지원 등 — 예: NVIDIA 소형 모델 tools 400) 는
 * 로컬 default 로 1회 강등 후 같은 턴을 재시도한다 (state.client 교체).
 *
 * 일시적 오류(isTransientLLMError)는 지수 백오프로 TURN_RETRY_MAX 회 재시도 —
 * 후향 실측(failed 20건 중 6~7건이 timeout/connection 류)에 근거한 노드 retry 정책.
 * signal abort(사용자 취소·예산 소진)는 재시도하지 않는다. 그 외 에러는 기존 경로대로 throw.
 */
export async function chatTurnWithRoleFallback(
    state: AgentRoleState,
    p: {
        conversation: ChatMessage[];
        tools: ToolDefinition[];
        signal: AbortSignal;
        taskId: string;
        userId: string;
        /** 재시도 발생 시 관측 훅(스텝 기록용) — 동기 호출, 실패해도 재시도를 막지 않을 것 */
        onRetry?: (info: { attempt: number; maxAttempts: number; error: string }) => void;
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
    const maxRetries = Math.max(0, AGENT_TASK_LIMITS.TURN_RETRY_MAX);
    let attempt = 0;
    for (;;) {
        try {
            return await call();
        } catch (chatErr) {
            const status = (chatErr as { status?: number }).status;
            const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
            // 외부 role 모델 4xx → 로컬 강등(작업당 1회) 후 즉시 같은 턴 재호출.
            // continue 라 강등 후의 일시적 오류도 아래 재시도 대상이 된다.
            if (state.external && !state.fallbackDone
                && typeof status === 'number' && status >= 400 && status < 500) {
                state.fallbackDone = true;
                state.external = false;
                logger.warn(`[AgentTask] ${p.taskId} 외부 role 모델 ${status} — 로컬 폴백: ${msg}`);
                state.client = createClient({ model: getModelForRole('agent'), userId: p.userId });
                continue;
            }
            if (p.signal.aborted || !isTransientLLMError(chatErr) || attempt >= maxRetries) {
                throw chatErr;
            }
            attempt++;
            const delayMs = AGENT_TASK_LIMITS.TURN_RETRY_BACKOFF_MS * 2 ** (attempt - 1);
            logger.warn(`[AgentTask] ${p.taskId} 일시적 LLM 오류 — ${delayMs}ms 후 재시도 ${attempt}/${maxRetries}: ${msg}`);
            try { p.onRetry?.({ attempt, maxAttempts: maxRetries, error: msg }); } catch { /* 관측 실패 무시 */ }
            await abortableDelay(delayMs, p.signal);
        }
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
