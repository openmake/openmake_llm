/** 통합 상태 표시 집계(apps/web/lib/activity-summary.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
interface Task { id: string; goal: string; status: string; progress?: number; completed_at?: string; created_at?: string }
interface Approval { approvalId: string; taskId: string; toolName: string; args?: Record<string, unknown> }
interface Summary {
    needsInput: Array<{ approvalId: string; taskId: string; toolName: string; question?: string; goal?: string }>;
    running: Array<{ id: string; goal: string; status: string; progress: number }>;
    recent: Array<{ id: string; goal: string; status: string }>;
    chatGenerating: boolean;
    badge: number;
}
const { summarizeActivity, ACTIVITY_RECENT_MAX } = require('../../../../web/lib/activity-summary') as {
    summarizeActivity: (i: { tasks: Task[]; approvals: Approval[]; chatGenerating: boolean; now: number }) => Summary;
    ACTIVITY_RECENT_MAX: number;
};

const NOW = Date.parse('2026-10-02T12:00:00Z');
const t = (id: string, status: string, extra: Partial<Task> = {}): Task => ({ id, goal: `목표 ${id}`, status, ...extra });

describe('summarizeActivity', () => {
    it('승인·질문 대기는 "입력 필요"로 — 질문이면 질문 본문, 작업 목표를 함께', () => {
        const s = summarizeActivity({
            tasks: [t('a', 'paused')],
            approvals: [
                { approvalId: 'p1', taskId: 'a', toolName: 'ask_human', args: { question: '계속할까요?' } },
                { approvalId: 'p2', taskId: 'a', toolName: 'bash', args: { command: 'ls' } },
            ],
            chatGenerating: false, now: NOW,
        });
        expect(s.needsInput).toEqual([
            { approvalId: 'p1', taskId: 'a', toolName: 'ask_human', question: '계속할까요?', goal: '목표 a' },
            { approvalId: 'p2', taskId: 'a', toolName: 'bash', goal: '목표 a' },
        ]);
    });

    it('실행·대기 중인 작업은 "진행 중"으로 — 승인 대기로 멈춘 작업도 포함', () => {
        const s = summarizeActivity({
            tasks: [t('a', 'running', { progress: 40 }), t('b', 'queued'), t('c', 'paused'), t('d', 'pending'), t('e', 'completed')],
            approvals: [], chatGenerating: false, now: NOW,
        });
        expect(s.running.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(s.running[0]).toEqual({ id: 'a', goal: '목표 a', status: 'running', progress: 40 });
        expect(s.running[1].progress).toBe(0);
    });

    it('끝난 작업은 최근 것부터 정해진 개수만, 하루가 지난 것은 뺀다', () => {
        const done = Array.from({ length: ACTIVITY_RECENT_MAX + 2 }, (_, i) =>
            t(`d${i}`, i % 2 ? 'failed' : 'completed', { completed_at: new Date(NOW - (i + 1) * 60_000).toISOString() }));
        const old = t('old', 'completed', { completed_at: new Date(NOW - 25 * 3600_000).toISOString() });
        const s = summarizeActivity({ tasks: [old, ...done.reverse()], approvals: [], chatGenerating: false, now: NOW });
        expect(s.recent).toHaveLength(ACTIVITY_RECENT_MAX);
        expect(s.recent[0].id).toBe('d0'); // 가장 최근
        expect(s.recent.map((r) => r.id)).not.toContain('old');
    });

    it('배지는 입력 필요 + 진행 중(채팅 생성 포함) 개수', () => {
        const s = summarizeActivity({
            tasks: [t('a', 'running'), t('b', 'completed', { completed_at: new Date(NOW - 1000).toISOString() })],
            approvals: [{ approvalId: 'p1', taskId: 'a', toolName: 'bash' }],
            chatGenerating: true, now: NOW,
        });
        expect(s.chatGenerating).toBe(true);
        expect(s.badge).toBe(3); // 승인 1 + 작업 1 + 채팅 1
    });

    it('아무 일도 없으면 전부 비어 있고 배지는 0', () => {
        expect(summarizeActivity({ tasks: [], approvals: [], chatGenerating: false, now: NOW }))
            .toEqual({ needsInput: [], running: [], recent: [], chatGenerating: false, badge: 0 });
    });
});
