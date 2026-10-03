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
import { runWithCostSession } from '../../utils/cost-attribution-context';
import { createLogger } from '../../utils/logger';
import { recoveryWaitMs } from './turn-recovery';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { getRecoveryWaitNote } from '../../prompts/agent-task-turn-loop';

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
    // 스트림·본문을 받는 도중 연결이 끊기면 undici 가 TypeError('terminated') 를 던지고 원인은 cause 에 싣는다
    // (SocketError 'other side closed', code UND_ERR_SOCKET) — 가짜 LLM 서버 테스트로 확인(2026-10-01).
    const cause = (err as { cause?: { message?: unknown; code?: unknown } }).cause;
    const detail = `${msg} ${String(cause?.message ?? '')} ${String(cause?.code ?? '')}`;
    return /connection error|request timed out|econnrefused|econnreset|etimedout|socket hang up|fetch failed|^terminated\b|other side closed|und_err_socket/i.test(detail);
}

/** 모델 호출이 호출당 상한을 다시 시도한 뒤에도 넘겼다 — 작업은 timeout 으로 끝난다(turn-call 이 변환). */
export class TurnCallCapExceeded extends Error {
    constructor(public readonly capMs: number) {
        super(`LLM call exceeded per-call cap (${capMs}ms)`);
        this.name = 'TurnCallCapExceeded';
    }
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
 *
 * 짧은 재시도가 소진되면 더 긴 간격으로 몇 번 더 기다린다(turn-recovery) — 모델 서버 재기동처럼 수십 초 걸리는
 * 장애를 넘기기 위함. 호출자가 남은 예산(recoveryBudgetMs)을 준 경우에만, 그 예산 안에서만 기다린다.
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
        /** 스트리밍 토큰 훅 — 호출이 중간에 끊겨도(시간 예산 abort) 부분 본문을 건지기 위한 관측 경로. */
        onToken?: (token: string) => void;
        /** 호출 한 번의 상한(ms) — 넘으면 그 시도만 끊고 TURN_CALL_TIMEOUT_RETRY_MAX 회 다시 시도한다. 미지정·0 이면 p.signal 만 쓴다. */
        callTimeoutMs?: number;
        /** 이 호출을 시작할 때 남은 작업 시간 예산(ms) — 주면 짧은 재시도 소진 뒤 이 예산 안에서 더 기다린다. */
        recoveryBudgetMs?: number;
    },
): Promise<Awaited<ReturnType<LLMClient['chat']>>> {
    // openai SDK 요청 타임아웃을 task 총 예산에 맞춰 늘린다(파생 클라이언트, baseUrl/model 유지).
    // 기본 LLM_TIMEOUT(120s)은 채팅용이라, 리포트·디자인 등 장문 생성 턴이 단일 요청에서 120s 를
    // 넘기면 "Request timed out" 으로 task 가 죽는다. 실제 한계는 p.signal(잔여 예산)이 governor.
    // SDK 요청 타임아웃 상한은 최대 예산(예약)에 맞춘다 — 실제 한계는 p.signal(잔여 예산)이 governor.
    // 원장 귀속(F25): 비용 행에 작업 id 를 실어 작업 단위로 모을 수 있게 한다. 로컬 토큰은 costContext 로,
    // 외부 role 모델(resolver 의 onUsage 가 `role:agent` 로 기록)은 비용 귀속 문맥으로 같은 id 가 붙는다.
    const call = (signal: AbortSignal) => runWithCostSession(p.taskId, () => state.client
        .derive({ timeout: AGENT_TASK_LIMITS.SCHEDULE_TOTAL_TIMEOUT_MS, costContext: { feature: 'agent_task', sessionId: p.taskId } })
        .chat(p.conversation, undefined, p.onToken, {
            tools: p.tools, signal, think: false, requestClass: 'agent_turn',
        }));
    const maxRetries = Math.max(0, AGENT_TASK_LIMITS.TURN_RETRY_MAX);
    let attempt = 0;
    let capRetries = 0;
    let recoveryCycles = 0;
    const startedAt = Date.now();
    for (;;) {
        // 시도마다 상한을 새로 건다 — 멈춘 호출 하나가 남은 예산 전부를 태우지 못하게 한다.
        const cap = p.callTimeoutMs && p.callTimeoutMs > 0 ? AbortSignal.timeout(p.callTimeoutMs) : null;
        try {
            return await call(cap ? AbortSignal.any([p.signal, cap]) : p.signal);
        } catch (chatErr) {
            if (cap?.aborted && !p.signal.aborted) {
                if (capRetries >= Math.max(0, AGENT_TASK_LIMITS.TURN_CALL_TIMEOUT_RETRY_MAX)) throw new TurnCallCapExceeded(p.callTimeoutMs!);
                capRetries++;
                const note = `호출 상한(${Math.round(p.callTimeoutMs! / 1000)}초) 초과 — 다시 시도`;
                logger.warn(`[AgentTask] ${p.taskId} ${note} ${capRetries}/${AGENT_TASK_LIMITS.TURN_CALL_TIMEOUT_RETRY_MAX}`);
                try { p.onRetry?.({ attempt: capRetries, maxAttempts: AGENT_TASK_LIMITS.TURN_CALL_TIMEOUT_RETRY_MAX, error: note }); } catch { /* 관측 실패 무시 */ }
                continue;
            }
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
            if (p.signal.aborted || !isTransientLLMError(chatErr)) throw chatErr;
            if (attempt >= maxRetries) {
                const waitMs = recoveryWaitMs(recoveryCycles + 1,
                    p.recoveryBudgetMs === undefined ? undefined : p.recoveryBudgetMs - (Date.now() - startedAt));
                if (waitMs === null) throw chatErr;
                recoveryCycles++;
                logger.warn(`[AgentTask] ${p.taskId} 재시도 소진 — ${waitMs}ms 기다린 뒤 다시 시도 ${recoveryCycles}/${AGENT_TASK_TURN_LOOP.RECOVERY_WAIT_MAX_CYCLES}: ${msg}`);
                try { p.onRetry?.({ attempt: recoveryCycles, maxAttempts: AGENT_TASK_TURN_LOOP.RECOVERY_WAIT_MAX_CYCLES, error: getRecoveryWaitNote(msg, waitMs) }); } catch { /* 관측 실패 무시 */ }
                await abortableDelay(waitMs, p.signal);
                continue;
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
