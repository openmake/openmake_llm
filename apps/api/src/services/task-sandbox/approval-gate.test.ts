import { requiresApproval, stripApprovalGatedTools, ApprovalRegistry } from './approval-gate';

describe('requiresApproval', () => {
    it("정책 all — 부작용 도구 전부 승인, 제어 시그널 제외", () => {
        expect(requiresApproval('all', 'bash', {})).toBe(true);
        expect(requiresApproval('all', 'str_replace_editor', {})).toBe(true);
        expect(requiresApproval('all', 'file_ops', { op: 'read' })).toBe(true);
        expect(requiresApproval('all', 'terminate', {})).toBe(false);
        expect(requiresApproval('all', 'ask_human', {})).toBe(false);
    });
    it('정책 none — 전부 자동', () => {
        expect(requiresApproval('none', 'bash', {})).toBe(false);
    });
    it('정책 high-risk — bash·python(임의 코드 실행)·browser·file 삭제', () => {
        expect(requiresApproval('high-risk', 'bash', {})).toBe(true);
        expect(requiresApproval('high-risk', 'python_execute', {})).toBe(true); // bash 동급 — 우회 차단
        expect(requiresApproval('high-risk', 'browser', {})).toBe(true);
        expect(requiresApproval('high-risk', 'file_ops', { op: 'delete' })).toBe(true);
        expect(requiresApproval('high-risk', 'file_ops', { op: 'read' })).toBe(false);
        expect(requiresApproval('high-risk', 'str_replace_editor', {})).toBe(false);
    });
    it('deviceGatesShell — 로컬 브리지: 코드 실행은 디바이스가 게이트하므로 서버 승인 skip', () => {
        // exec 계열은 정책 all 이어도 서버 승인 불요(디바이스 confirmExec 가 담당) — 이중 프롬프트 제거
        expect(requiresApproval('all', 'bash', {}, { deviceGatesShell: true })).toBe(false);
        expect(requiresApproval('all', 'python_execute', {}, { deviceGatesShell: true })).toBe(false);
        // 파일/기타 도구는 디바이스가 다이얼로그를 안 띄우므로 서버 승인 유지
        expect(requiresApproval('all', 'file_ops', { op: 'write' }, { deviceGatesShell: true })).toBe(true);
        expect(requiresApproval('all', 'str_replace_editor', {}, { deviceGatesShell: true })).toBe(true);
        // 플래그 없으면(도커 샌드박스) 기존대로 exec 도 승인 대상
        expect(requiresApproval('all', 'bash', {})).toBe(true);
    });
});

describe('stripApprovalGatedTools (HITL 무응답 강등)', () => {
    const tool = (name: string) => ({ function: { name } });
    const names = (ts: Array<{ function: { name: string } }>) => ts.map((t) => t.function.name);

    it("정책 all — 승인 불요 도구(플래닝·terminate 등)만 남고 ask_human 도 제거", () => {
        const tools = ['bash', 'str_replace_editor', 'plan_update', 'terminate', 'ask_human', 'delegate'].map(tool);
        expect(names(stripApprovalGatedTools(tools, 'all'))).toEqual(['plan_update', 'terminate', 'delegate']);
    });

    it('정책 high-risk — bash·browser·python·skill_run 제거, 나머지(+인자 의존 file_ops)는 유지', () => {
        const tools = ['bash', 'browser', 'python_execute', 'skill_run', 'file_ops', 'str_replace_editor', 'ask_human'].map(tool);
        expect(names(stripApprovalGatedTools(tools, 'high-risk'))).toEqual(['file_ops', 'str_replace_editor']);
    });

    it('정책 none — ask_human 만 제거(항상 사람 대기라 부재 시 무의미)', () => {
        const tools = ['bash', 'ask_human'].map(tool);
        expect(names(stripApprovalGatedTools(tools, 'none'))).toEqual(['bash']);
    });

    it('deviceGatesShell — 디바이스가 게이트하는 exec 계열은 유지', () => {
        const tools = ['bash', 'python_execute', 'str_replace_editor'].map(tool);
        expect(names(stripApprovalGatedTools(tools, 'all', { deviceGatesShell: true })))
            .toEqual(['bash', 'python_execute']);
    });
});

describe('ApprovalRegistry', () => {
    const baseInput = { taskId: 't1', userId: 'u1', toolName: 'bash', args: { command: 'ls' } };

    it('approve 시 approved 로 resolve (+waitedMs)', async () => {
        const reg = new ApprovalRegistry();
        let pendingId = '';
        const p = reg.request(baseInput, { timeoutMs: 5000, onPending: (pa) => { pendingId = pa.approvalId; } });
        expect(reg.list('u1')).toHaveLength(1);
        expect(reg.approve(pendingId)).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });
        expect((await p).waitedMs).toBeGreaterThanOrEqual(0);
        expect(reg.list('u1')).toHaveLength(0); // 정리됨
    });

    it("reject 시 rejected(reason='user') 로 resolve", async () => {
        const reg = new ApprovalRegistry();
        let id = '';
        const p = reg.request(baseInput, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        expect(reg.reject(id)).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'user' });
    });

    it('answer 시 approved + 자유텍스트로 resolve', async () => {
        const reg = new ApprovalRegistry();
        let id = '';
        const p = reg.request(
            { ...baseInput, toolName: 'ask_human', args: { question: '어느 쪽?' } },
            { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } },
        );
        expect(reg.answer(id, 'B 로 진행해줘')).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved', text: 'B 로 진행해줘' });
        expect(reg.list('u1')).toHaveLength(0);
    });

    it('없는 approvalId answer 는 false', () => {
        expect(new ApprovalRegistry().answer('nope', 'x')).toBe(false);
    });

    it("timeout 시 자동 rejected(reason='timeout') — HITL 강등 카운트 대상", async () => {
        const reg = new ApprovalRegistry();
        const p = reg.request(baseInput, { timeoutMs: 30 });
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
    });

    it("abort signal 시 rejected(reason='abort') — 강등 카운트 비대상", async () => {
        const reg = new ApprovalRegistry();
        const ac = new AbortController();
        const p = reg.request(baseInput, { timeoutMs: 5000, signal: ac.signal });
        ac.abort();
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'abort' });
    });

    it('자동승인(4-2): 활성 시 즉시 approved, ask_human 은 여전히 대기', async () => {
        const reg = new ApprovalRegistry();
        reg.setAutoApprove('t1', true);
        // 일반 도구 — 즉시 승인(pending 미생성)
        const r = await reg.request(baseInput, { timeoutMs: 5000 });
        expect(r).toEqual({ decision: 'approved', waitedMs: 0 });
        expect(reg.list('u1')).toHaveLength(0);
        // ask_human — 자동승인과 무관하게 대기(answer 로 해소)
        let id = '';
        const p = reg.request(
            { ...baseInput, toolName: 'ask_human', args: { question: 'q' } },
            { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } },
        );
        expect(reg.list('u1')).toHaveLength(1);
        reg.answer(id, 'ok');
        await expect(p).resolves.toMatchObject({ decision: 'approved', text: 'ok' });
    });

    it('자동승인(4-2): 활성 시 현재 대기 중이던 승인도 즉시 해소', async () => {
        const reg = new ApprovalRegistry();
        const p = reg.request(baseInput, { timeoutMs: 5000 });
        expect(reg.list('u1')).toHaveLength(1);
        reg.setAutoApprove('t1', true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });
        expect(reg.list('u1')).toHaveLength(0);
    });

    it('자동승인(4-2): clearAutoApprove 후엔 다시 대기', () => {
        const reg = new ApprovalRegistry();
        reg.setAutoApprove('t1', true);
        reg.clearAutoApprove('t1');
        expect(reg.isAutoApprove('t1')).toBe(false);
        reg.request(baseInput, { timeoutMs: 5000 });
        expect(reg.list('u1')).toHaveLength(1);
    });

    it('list 는 userId 로 격리', async () => {
        const reg = new ApprovalRegistry();
        reg.request({ ...baseInput, userId: 'u1' }, { timeoutMs: 5000 });
        reg.request({ ...baseInput, userId: 'u2' }, { timeoutMs: 5000 });
        expect(reg.list('u1')).toHaveLength(1);
        expect(reg.list('u2')).toHaveLength(1);
    });

    it('없는 approvalId approve 는 false', () => {
        expect(new ApprovalRegistry().approve('nope')).toBe(false);
    });
});
