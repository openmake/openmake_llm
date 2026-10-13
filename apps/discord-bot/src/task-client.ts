/**
 * 에이전트 작업 API 클라이언트 — 생성·실행·조회·취소·승인. 디스코드를 모른다.
 * 인증은 채팅과 같은 봇 API 키(`Authorization: Bearer`)다. 작업은 그 키의 계정으로 만들어진다.
 * 서버 응답은 `{ success, data }` 이고, 실패는 2xx 가 아닌 상태 코드로 온다.
 */
import type { TaskApprovalPolicy, TaskExecutor } from './config';

/** 봇이 쓰는 작업 상태 한 장 — 서버의 task 행에서 필요한 값만 옮긴다 */
export interface TaskSnapshot {
    id: string;
    /** pending | queued | running | paused | completed | failed | cancelled */
    status: string;
    progress: number;
    currentTurn: number;
    maxTurns: number;
    result: string | null;
    error: string | null;
}

export interface PendingApproval {
    approvalId: string;
    taskId: string;
    toolName: string;
    args: unknown;
}

export class TaskApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'TaskApiError';
    }
}

export interface TaskClient {
    createTask(goal: string, executor: TaskExecutor): Promise<string>;
    executeTask(taskId: string, approvalPolicy: TaskApprovalPolicy): Promise<void>;
    getTask(taskId: string): Promise<TaskSnapshot>;
    cancelTask(taskId: string): Promise<void>;
    listPendingApprovals(taskId: string): Promise<PendingApproval[]>;
    /** 'gone' = 이미 처리됐거나 만료된 요청(404) */
    decideApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<'ok' | 'gone'>;
    isDeviceConnected(): Promise<boolean>;
}

/** 요청 1건의 기본 시간 상한 — 조회·결정은 짧은 호출이다 */
const DEFAULT_TIMEOUT_MS = 15_000;

interface RawTask {
    id?: unknown; status?: unknown; progress?: unknown; current_turn?: unknown; max_turns?: unknown; result?: unknown; error?: unknown;
}

const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function toSnapshot(raw: RawTask): TaskSnapshot {
    return {
        id: String(raw.id ?? ''),
        status: String(raw.status ?? 'unknown'),
        progress: numberOr(raw.progress, 0),
        currentTurn: numberOr(raw.current_turn, 0),
        maxTurns: numberOr(raw.max_turns, 0),
        result: stringOrNull(raw.result),
        error: stringOrNull(raw.error),
    };
}

/** 서버 오류 본문에서 사람이 읽을 문장을 꺼낸다 — 형식이 달라도 죽지 않는다 */
function errorMessageOf(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (b.error && typeof b.error === 'object' && typeof (b.error as { message?: unknown }).message === 'string') {
        return (b.error as { message: string }).message;
    }
    return typeof b.message === 'string' ? b.message : undefined;
}

export function createTaskClient(opts: { baseUrl: string; apiKey: string; timeoutMs?: number }): TaskClient {
    const base = opts.baseUrl.replace(/\/$/, '');

    async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${opts.apiKey}`,
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        const json: unknown = await res.json().catch(() => undefined);
        if (!res.ok) throw new TaskApiError(errorMessageOf(json) ?? `HTTP ${res.status}`, res.status);
        return (json as { data?: T } | undefined)?.data as T;
    }

    return {
        async createTask(goal, executor) {
            const data = await call<{ task?: RawTask }>('POST', '/api/agent-tasks', { goal, ...(executor === 'local' ? { executor } : {}) });
            const id = data?.task?.id;
            if (typeof id !== 'string' || !id) throw new TaskApiError('작업 id 를 받지 못했습니다', 502);
            return id;
        },
        async executeTask(taskId, approvalPolicy) {
            await call('POST', `/api/agent-tasks/${encodeURIComponent(taskId)}/execute`, { approvalPolicy });
        },
        async getTask(taskId) {
            const data = await call<{ task?: RawTask }>('GET', `/api/agent-tasks/${encodeURIComponent(taskId)}`);
            return toSnapshot(data?.task ?? {});
        },
        async cancelTask(taskId) {
            await call('POST', `/api/agent-tasks/${encodeURIComponent(taskId)}/cancel`, {});
        },
        async listPendingApprovals(taskId) {
            const data = await call<{ pending?: Array<{ approvalId?: unknown; taskId?: unknown; toolName?: unknown; args?: unknown }> }>('GET', '/api/agent-tasks/approvals/pending');
            return (data?.pending ?? [])
                .filter((p) => p.taskId === taskId && typeof p.approvalId === 'string')
                .map((p) => ({ approvalId: String(p.approvalId), taskId, toolName: String(p.toolName ?? 'unknown'), args: p.args }));
        },
        async decideApproval(approvalId, decision) {
            try {
                await call('POST', `/api/agent-tasks/approvals/${encodeURIComponent(approvalId)}/${decision}`, {});
                return 'ok';
            } catch (e) {
                if (e instanceof TaskApiError && e.status === 404) return 'gone';
                throw e;
            }
        },
        async isDeviceConnected() {
            const data = await call<{ connected?: unknown }>('GET', '/api/local-bridge/status');
            return data?.connected === true;
        },
    };
}
