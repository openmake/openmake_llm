/**
 * 에이전트 작업 API 클라이언트 — 생성·실행·조회·취소·승인. 디스코드를 모른다.
 * 인증은 채팅과 같은 봇 API 키(`Authorization: Bearer`)다. 작업은 그 키의 계정으로 만들어진다.
 * 서버 응답은 `{ success, data }` 이고, 실패는 2xx 가 아닌 상태 코드로 온다.
 * 응답 자체를 받지 못한 실패(시간 초과·연결 실패)는 상태 코드 0 으로 던진다.
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
    /** 이어가기(188) — 이 작업을 이어받은 후속 작업 id. 있으면 감시기가 그쪽으로 옮겨 간다 */
    continuedByTaskId: string | null;
    completionPath: string | null;
}

export interface PendingApproval {
    approvalId: string;
    taskId: string;
    toolName: string;
    args: unknown;
}

/** 작업 산출물 — 서버 artifact 스텝의 content(ExtractedArtifact JSON 문자열)를 옮긴다 */
export interface TaskArtifact {
    id: string;
    kind: string;
    title: string;
    lang: string | null;
    content: string;
}

export class TaskApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'TaskApiError';
    }
}

/** 작업 입력 첨부 — 서버 작업 생성의 files[](base64 원본)·images[](data:image/ URL). 실행 때 작업 공간 uploads/ 에 쓰인다 */
export interface TaskInputAttachments {
    files?: Array<{ name: string; type?: string; size: number; data: string }>;
    images?: string[];
}

export interface TaskClient {
    createTask(goal: string, executor: TaskExecutor, attachments?: TaskInputAttachments): Promise<string>;
    executeTask(taskId: string, approvalPolicy: TaskApprovalPolicy): Promise<void>;
    getTask(taskId: string): Promise<TaskSnapshot>;
    cancelTask(taskId: string): Promise<void>;
    listPendingApprovals(taskId: string): Promise<PendingApproval[]>;
    /** 작업의 산출물 — 형식이 다른 스텝은 건너뛴다 */
    listArtifacts(taskId: string): Promise<TaskArtifact[]>;
    /** 'gone' = 이미 처리됐거나 만료된 요청(404) */
    decideApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<'ok' | 'gone'>;
    isDeviceConnected(): Promise<boolean>;
}

/** 요청 1건의 기본 시간 상한 — 조회·결정은 짧은 호출이다 */
const DEFAULT_TIMEOUT_MS = 15_000;
/** 첨부가 있는 작업 생성의 시간 상한 — 서버가 생성 때 문서 텍스트를 추출한다(문서당 최대 수십 초) */
const CREATE_WITH_FILES_TIMEOUT_MS = 120_000;

interface RawTask {
    id?: unknown; status?: unknown; progress?: unknown; current_turn?: unknown; max_turns?: unknown; result?: unknown; error?: unknown;
    continued_by_task_id?: unknown; completion_path?: unknown;
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
        continuedByTaskId: stringOrNull(raw.continued_by_task_id),
        completionPath: stringOrNull(raw.completion_path),
    };
}

/** 스텝 content 를 산출물로 — 웹 작업 화면의 parseStepArtifact 와 같은 규칙(content·kind 가 문자열이 아니면 null) */
function parseArtifact(raw: unknown): TaskArtifact | null {
    try {
        const o = JSON.parse(String(raw ?? '')) as { id?: unknown; kind?: unknown; title?: unknown; lang?: unknown; content?: unknown } | null;
        if (typeof o?.content !== 'string' || typeof o.kind !== 'string') return null;
        return {
            id: typeof o.id === 'string' ? o.id : 'artifact',
            kind: o.kind,
            title: typeof o.title === 'string' ? o.title : 'artifact',
            lang: typeof o.lang === 'string' ? o.lang : null,
            content: o.content,
        };
    } catch {
        return null;
    }
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

    async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs?: number): Promise<T> {
        let res: Response;
        try {
            res = await fetch(`${base}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${opts.apiKey}`,
                    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            });
        } catch (e) {
            // fetch 의 원문("The operation was aborted due to timeout", "fetch failed")은 그대로 채널에 나간다 — 읽을 수 있는 말로 바꾼다
            const timedOut = e instanceof Error && e.name === 'TimeoutError';
            throw new TaskApiError(timedOut ? '서버 응답이 시간 안에 오지 않았습니다' : '서버에 연결하지 못했습니다', 0);
        }
        const json: unknown = await res.json().catch(() => undefined);
        if (!res.ok) throw new TaskApiError(errorMessageOf(json) ?? `HTTP ${res.status}`, res.status);
        return (json as { data?: T } | undefined)?.data as T;
    }

    return {
        async createTask(goal, executor, attachments) {
            const files = attachments?.files?.length ? attachments.files : undefined;
            const images = attachments?.images?.length ? attachments.images : undefined;
            const body = { goal, ...(executor === 'local' ? { executor } : {}), ...(files ? { files } : {}), ...(images ? { images } : {}) };
            const data = await call<{ task?: RawTask }>('POST', '/api/agent-tasks', body, files || images ? CREATE_WITH_FILES_TIMEOUT_MS : undefined);
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
        async listArtifacts(taskId) {
            // 서버는 agent_task_steps 행을 그대로 준다(snake_case: step_type·content)
            const data = await call<{ steps?: Array<{ step_type?: unknown; content?: unknown }> }>('GET', `/api/agent-tasks/${encodeURIComponent(taskId)}/steps`);
            return (data?.steps ?? [])
                .filter((st) => st.step_type === 'artifact')
                .map((st) => parseArtifact(st.content))
                .filter((a): a is TaskArtifact => a !== null);
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
