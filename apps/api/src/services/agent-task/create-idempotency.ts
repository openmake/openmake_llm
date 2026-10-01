/**
 * 에이전트 작업 생성 중복 방지.
 *
 * 더블 클릭이나 네트워크 재전송(응답을 못 받은 클라이언트의 재시도)으로 같은 작업이 두 번 만들어져 두 번 실행되던 문제를 막는다.
 *  - REST 생성(POST /api/agent-tasks): 클라이언트가 보낸 `Idempotency-Key` 를 사용자 단위로 기억한다. 같은 키의 재요청은
 *    새로 만들지 않고 처음 만든 작업을 돌려준다. 첫 요청이 아직 저장 전이면 "처리 중"으로 답한다.
 *  - 채팅 위임(delegate_agent_task): 키가 없으므로 같은 사용자·목표·턴 수를 짧은 창 안에서 한 번만 만든다
 *    (모델이 한 턴에 같은 도구 호출을 반복하는 경우).
 * 기억은 두 겹이다(174): 프로세스 메모리(같은 순간에 온 요청·저장 전 요청 판정)와 DB 의 (user_id, key) 유니크
 * (재시작 뒤·다른 서버로 간 재요청). 채팅 위임 창은 메모리에만 둔다.
 * @module services/agent-task/create-idempotency
 */
import { createHash } from 'crypto';
import { RequestIdempotencyRegistry, normalizeClientRequestId } from '../../chat/request-idempotency';
import { AGENT_TASK_CREATE_IDEMPOTENCY } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskCreateIdempotency');

let createRegistry = new RequestIdempotencyRegistry(AGENT_TASK_CREATE_IDEMPOTENCY.TTL_MS, AGENT_TASK_CREATE_IDEMPOTENCY.MAX_PER_OWNER);
let delegateRegistry = new RequestIdempotencyRegistry(AGENT_TASK_CREATE_IDEMPOTENCY.DELEGATE_WINDOW_MS, AGENT_TASK_CREATE_IDEMPOTENCY.MAX_PER_OWNER);

export type DuplicateCreate<T> =
    /** 같은 키로 이미 만든 작업 — 그대로 돌려준다 */
    | { kind: 'duplicate'; task: T }
    /** 같은 키의 첫 요청이 아직 저장 전 — 새로 만들지 않는다 */
    | { kind: 'in_flight'; taskId: string };

/**
 * 생성 요청의 멱등 판정. 처음 보는 키면 이번 taskId 를 기억하고 null(그대로 생성 진행).
 * ⚠️ 기억은 첫 await 전에 동기로 한다 — 동시에 온 두 요청이 둘 다 통과하지 않게.
 * 생성이 실패 응답(4xx·5xx)으로 끝나면 키를 풀어 재시도가 새로 만들 수 있게 한다.
 */
export async function resolveDuplicateCreate<T>(opts: {
    userId: string;
    rawKey: unknown;
    taskId: string;
    res: { statusCode: number; on(event: 'finish', listener: () => void): unknown };
    loadTask: (taskId: string) => Promise<T | null | undefined>;
    /** DB 에 남은 키 조회(174) — 재시작으로 메모리가 비었거나 다른 서버가 만든 작업을 찾는다. */
    findByKey?: (userId: string, key: string) => Promise<(T & { id: string }) | null | undefined>;
}): Promise<DuplicateCreate<T> | null> {
    const key = normalizeClientRequestId(opts.rawKey);
    if (!key) return null;
    const prior = createRegistry.lookup(opts.userId, key);
    if (!prior) {
        // 조회(await)보다 먼저 기억한다 — 조회 중에 온 같은 키의 요청이 통과하지 않게.
        createRegistry.remember(opts.userId, key, opts.taskId);
        const stored = opts.findByKey ? await opts.findByKey(opts.userId, key) : null;
        if (stored) {
            createRegistry.remember(opts.userId, key, stored.id);
            logger.info(`[AgentTask] 중복 생성 요청 무시(멱등·DB): key=${key} → ${stored.id}`);
            return { kind: 'duplicate', task: stored };
        }
        opts.res.on('finish', () => {
            if (opts.res.statusCode >= 400) createRegistry.forget(opts.userId, key);
        });
        return null;
    }
    const task = await opts.loadTask(prior);
    logger.info(`[AgentTask] 중복 생성 요청 무시(멱등): key=${key} → ${prior}${task ? '' : ' (저장 전)'}`);
    return task ? { kind: 'duplicate', task } : { kind: 'in_flight', taskId: prior };
}

/** 저장·조회에 쓰는 정규화된 키 — 형식이 틀리면 undefined(멱등 없음). */
export function normalizedCreateKey(rawKey: unknown): string | undefined {
    return normalizeClientRequestId(rawKey);
}

/** 같은 키의 기억을 실제 작업 id 로 바꾼다 — INSERT 가 유니크 충돌로 다른 서버의 작업을 가리킬 때. */
export function rememberCreatedTask(userId: string, key: string, taskId: string): void {
    createRegistry.remember(userId, key, taskId);
}

function delegateKey(goal: string, maxTurns: number): string {
    return createHash('sha256').update(`${maxTurns}\n${goal.trim()}`).digest('hex').slice(0, 32);
}

/** 채팅 위임 중복 판정 — 창 안에 같은 사용자·목표·턴 수로 만든 작업이 있으면 그 id, 없으면 이번 id 를 기억하고 null. */
export function claimDelegatedTask(userId: string, goal: string, maxTurns: number, taskId: string, now = Date.now()): string | null {
    if (AGENT_TASK_CREATE_IDEMPOTENCY.DELEGATE_WINDOW_MS <= 0) return null;
    const key = delegateKey(goal, maxTurns);
    const prior = delegateRegistry.lookup(userId, key, now);
    if (prior) {
        logger.info(`[delegate_agent_task] 중복 위임 무시: ${prior}`);
        return prior;
    }
    delegateRegistry.remember(userId, key, taskId, now);
    return null;
}

/** 위임이 실패했을 때 — 다시 위임할 수 있게 푼다. */
export function releaseDelegatedTask(userId: string, goal: string, maxTurns: number): void {
    delegateRegistry.forget(userId, delegateKey(goal, maxTurns));
}

export function resetCreateIdempotencyForTest(): void {
    createRegistry = new RequestIdempotencyRegistry(AGENT_TASK_CREATE_IDEMPOTENCY.TTL_MS, AGENT_TASK_CREATE_IDEMPOTENCY.MAX_PER_OWNER);
    delegateRegistry = new RequestIdempotencyRegistry(AGENT_TASK_CREATE_IDEMPOTENCY.DELEGATE_WINDOW_MS, AGENT_TASK_CREATE_IDEMPOTENCY.MAX_PER_OWNER);
}
