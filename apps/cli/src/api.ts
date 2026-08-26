/**
 * OpenMake Code CLI — REST API 클라이언트 (에이전트 작업 생성·폴링·승인).
 * API key(omk_live_*) 를 X-API-Key 헤더로 인증한다. Node18+ 내장 fetch 사용.
 */
export interface ApiTask {
    id: string;
    status: string;
    progress?: number;
    result?: string;
    error?: string;
    executor?: string;
    device_id?: string;
    goal?: string;
    /** 연결 루트 기준 상대 폴더(웹에서 고른 하위 폴더). 루트 자체는 디바이스만 안다. */
    folder_rel?: string | null;
    created_at?: string;
    updated_at?: string;
    /** 서버 판정: failed + checkpoint 보유 → `resume` 가능 */
    resumable?: boolean;
}

export interface ApiTaskStep {
    step_number: number;
    step_type: string;
    tool_name?: string | null;
    content?: string | null;
    created_at?: string;
}

export interface PendingApproval {
    approvalId: string;
    taskId: string;
    toolName: string;
    args?: unknown;
    kind?: string;
    question?: string;
}

export class ApiClient {
    constructor(private readonly serverUrl: string, private readonly apiKey: string) {}

    private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${this.serverUrl}${path}`, {
            method,
            headers: {
                'X-API-Key': this.apiKey,
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json: unknown = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
        if (!res.ok) {
            const msg = (json as { error?: { message?: string } } | null)?.error?.message || text || `HTTP ${res.status}`;
            throw new Error(msg);
        }
        return (json as { data?: T })?.data ?? (json as T);
    }

    createTask(goal: string, deviceId: string): Promise<{ task: ApiTask }> {
        return this.req('POST', '/api/agent-tasks', { goal, executor: 'local', deviceId });
    }
    getTask(taskId: string): Promise<{ task?: ApiTask } | ApiTask> {
        return this.req('GET', `/api/agent-tasks/${taskId}`);
    }
    executeTask(taskId: string): Promise<unknown> {
        return this.req('POST', `/api/agent-tasks/${taskId}/execute`, {});
    }
    /** 이 디바이스의 로컬 작업 목록 — 서버 부가 필터(executor/deviceId/status)로 샌드박스 작업을 섞지 않는다. */
    listTasks(opts: { deviceId?: string; status?: string } = {}): Promise<{ tasks: ApiTask[]; total: number }> {
        const q = new URLSearchParams({ executor: 'local' });
        if (opts.deviceId) q.set('deviceId', opts.deviceId);
        if (opts.status) q.set('status', opts.status);
        return this.req('GET', `/api/agent-tasks?${q.toString()}`);
    }
    /** 작업 스텝(진행 기록) — show 가 요약·diff·판정을 뽑는 원본. */
    listSteps(taskId: string): Promise<{ steps: ApiTaskStep[]; total: number }> {
        return this.req('GET', `/api/agent-tasks/${taskId}/steps`);
    }
    /** checkpoint 재개 — 서버가 상태·checkpoint·디바이스 연결을 검증한다(실패 사유는 400 메시지). */
    resumeTask(taskId: string): Promise<{ message?: string; queued?: boolean }> {
        return this.req('POST', `/api/agent-tasks/${taskId}/resume`, {});
    }
    /** 작업 단위 서버 승인 자동화 (데스크톱 일괄 승인과 동등) — 헤드리스/CI 실행용. */
    setAutoApprove(taskId: string, enabled: boolean): Promise<unknown> {
        return this.req('POST', `/api/agent-tasks/${taskId}/approvals/auto-approve`, { enabled });
    }
    listPending(): Promise<{ pending: PendingApproval[] }> {
        return this.req('GET', '/api/agent-tasks/approvals/pending');
    }
    answerApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<unknown> {
        return this.req('POST', `/api/agent-tasks/approvals/${approvalId}/${decision}`);
    }
    bridgeStatus(): Promise<{ enabled: boolean; connected: boolean; devices?: { deviceId: string; label: string; folderName: string }[] }> {
        return this.req('GET', '/api/local-bridge/status');
    }
}
