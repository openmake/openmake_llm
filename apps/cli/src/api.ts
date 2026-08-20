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
