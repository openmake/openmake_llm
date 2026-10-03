/**
 * 승인 저장본의 비밀 값 가림 — 사용자(이관받은 조직원 포함)에게 보이는 사본만 가리고,
 * 호출 결속(인자 해시·skill_run 체크섬)과 실행에 쓰이는 원래 인자는 그대로다.
 */
import { redactApprovalArgs, redactApprovalPreview } from '../approval-redact';
import { ApprovalRegistry, type ApprovalStore } from '../approval-gate';
import { hashApprovalArgs, type ApprovalRow } from '../../../data/repositories/agent-task-approval-repository';
import { SKILL_RUN_CHECKSUM_ARG } from '../skill-run-binding';

const SECRET = 'sk-abcdef0123456789abcdef0123';
const json = (v: unknown) => JSON.stringify(v);

describe('redactApprovalArgs', () => {
    it('민감 키의 값을 가린다 — 대소문자·표기 차이로 비켜 가지 못한다', () => {
        const out = redactApprovalArgs('notion::call', { api_key: 'v1', API_KEY: 'v2', apiKey: 'v3', Authorization: 'v4', PASSWORD: 'v5', 'X-Auth-Token': 'v6', page: 'home' });
        expect(out).toEqual({ api_key: '[REDACTED]', API_KEY: '[REDACTED]', apiKey: '[REDACTED]', Authorization: '[REDACTED]', PASSWORD: '[REDACTED]', 'X-Auth-Token': '[REDACTED]', page: 'home' });
    });

    it('중첩 객체·배열 안의 민감 키도 가린다', () => {
        const out = redactApprovalArgs('srv::http', {
            url: 'https://api.example.com',
            options: { headers: { Authorization: `Bearer ${SECRET}` }, env: { nested: { client_secret: 'hunter2hunter2' } } },
            items: [{ token: 'tok-1' }, { name: 'ok', deep: [{ Cookie: 'sid=1' }] }],
        });
        expect(json(out)).not.toContain(SECRET);
        expect(json(out)).not.toContain('hunter2hunter2');
        expect(json(out)).not.toContain('tok-1');
        expect(json(out)).not.toContain('sid=1');
        expect(out).toMatchObject({ url: 'https://api.example.com', items: [{ token: '[REDACTED]' }, { name: 'ok' }] });
    });

    it('민감하지 않은 키의 문자열 값에 섞인 자격증명도 가린다(셸 명령·파일 본문)', () => {
        const out = redactApprovalArgs('bash', { command: `curl -H "Authorization: Bearer ${SECRET}" https://x.test && export OPENAI_API_KEY=${SECRET}` });
        expect(String(out.command)).not.toContain(SECRET);
        expect(String(out.command)).toContain('curl -H');
        expect(String(out.command)).toContain('https://x.test');

        const file = redactApprovalArgs('file_ops', { op: 'write', path: 'config/.env', content: `DB_PASSWORD=p@ssw0rd-long\nPORT=3000\nurl=postgres://app:dbpass123@db:5432/x` });
        expect(file).toMatchObject({ op: 'write', path: 'config/.env' });
        expect(String(file.content)).not.toContain('p@ssw0rd-long');
        expect(String(file.content)).not.toContain('dbpass123');
        expect(String(file.content)).toContain('PORT=3000');
    });

    it('배열 안 문자열 값도 가린다', () => {
        const out = redactApprovalArgs('srv::run', { argv: ['--header', `Bearer ${SECRET}`, 'plain'] });
        expect(json(out)).not.toContain(SECRET);
        expect(json(out)).toContain('plain');
    });

    it('원래 인자 객체는 바꾸지 않는다', () => {
        const args = { api_key: 'v1', nested: { token: 't' }, command: `echo ${SECRET}` };
        const snapshot = json(args);
        redactApprovalArgs('bash', args);
        expect(json(args)).toBe(snapshot);
    });

    it('질문 도구(ask_human·mcp_elicit)는 키를 가리지 않는다 — 입력 양식의 필드 이름이 민감 키와 겹친다. 값에 섞인 자격증명은 가린다', () => {
        const schema = { type: 'object', properties: { api_key: { type: 'string', title: 'API 키' } } };
        const out = redactApprovalArgs('mcp_elicit', { server: 's', question: `키를 입력하세요 (예: ${SECRET})`, requestedSchema: schema });
        expect(out.requestedSchema).toEqual(schema);
        expect(String(out.question)).not.toContain(SECRET);
        expect(redactApprovalArgs('ask_human', { question: '어느 쪽으로 할까요?' })).toEqual({ question: '어느 쪽으로 할까요?' });
    });
});

describe('redactApprovalPreview', () => {
    it('미리보기(diff)에 섞인 자격증명 값을 가린다', () => {
        const out = redactApprovalPreview(`--- a/.env\n+++ b/.env\n@@ -1,1 +1,2 @@\n PORT=3000\n+OPENAI_API_KEY=${SECRET}`);
        expect(out).not.toContain(SECRET);
        expect(out).toContain('PORT=3000');
        expect(redactApprovalPreview(undefined)).toBeUndefined();
    });
});

function fakeStore() {
    const rows = new Map<string, ApprovalRow>();
    const store: ApprovalStore & { rows: Map<string, ApprovalRow> } = {
        rows,
        insertPending: async (r) => {
            rows.set(r.approvalId, {
                approval_id: r.approvalId, task_id: r.taskId, user_id: r.userId, tool_name: r.toolName, args: r.args, args_hash: r.argsHash,
                risk_class: r.riskClass ?? null, status: 'pending', answer_text: null, created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 60_000).toISOString(), decided_at: null, consumed_at: null, preview: r.preview ?? null,
            });
        },
        markDecided: async (id, status, text) => { const r = rows.get(id); if (!r || r.status !== 'pending') return false; r.status = status; r.answer_text = text ?? null; r.decided_at = new Date().toISOString(); return true; },
        listPending: async (userId) => [...rows.values()].filter((r) => r.user_id === userId && r.status === 'pending'),
        getPending: async (id) => { const r = rows.get(id); return r && r.status === 'pending' ? r : undefined; },
        takeoverForCall: async (taskId, toolName, argsHash) => {
            const same = [...rows.values()].filter((r) => r.task_id === taskId && r.tool_name === toolName && r.args_hash === argsHash);
            const decided = same.find((r) => (r.status === 'approved' || r.status === 'rejected') && !r.consumed_at);
            if (decided) { decided.consumed_at = new Date().toISOString(); return decided; }
            return same.find((r) => r.status === 'pending');
        },
        expirePendingForTask: async () => undefined,
    };
    return store;
}
const tick = () => new Promise((r) => setImmediate(r));

describe('ApprovalRegistry — 저장본만 가리고 결속은 유지', () => {
    const secretArgs = () => ({ url: 'https://api.example.com', headers: { Authorization: `Bearer ${SECRET}` }, body: { api_key: SECRET } });

    it('저장소 행·승인함 목록·단건 조회 모두 가린 사본이고, 해시는 원래 인자의 것이다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        const args = secretArgs();
        let id = '';
        void reg.request({ taskId: 't1', userId: 'u1', toolName: 'srv::http', args, preview: `+TOKEN_SECRET=${SECRET}` }, { timeoutMs: 5000, onPending: (p) => { id = p.approvalId; } });
        await tick();
        const row = store.rows.get(id)!;
        expect(json(row.args)).not.toContain(SECRET);
        expect(row.preview).not.toContain(SECRET);
        expect(row.args_hash).toBe(hashApprovalArgs(args));
        expect(row.args_hash).not.toBe(hashApprovalArgs(row.args as Record<string, unknown>));
        expect(json(await reg.list('u1'))).not.toContain(SECRET);
        expect(json(await reg.get(id))).not.toContain(SECRET);
        // 실행에 쓰이는 원래 인자는 그대로
        expect(args).toEqual(secretArgs());
    });

    it('재시작 뒤 가려진 행에 내린 승인을, 재개된 작업이 원래 인자의 같은 호출로 이어받는다', async () => {
        const store = fakeStore();
        const before = new ApprovalRegistry(store);
        let id = '';
        void before.request({ taskId: 't1', userId: 'u1', toolName: 'srv::http', args: secretArgs() }, { timeoutMs: 5000, onPending: (p) => { id = p.approvalId; } });
        await tick();
        // 프로세스 재시작 — 메모리 waiter 없이 저장소만 남는다
        const after = new ApprovalRegistry(store);
        expect(await after.approve(id, 'u1')).toBe(true);
        const r = await after.request({ taskId: 't1', userId: 'u1', toolName: 'srv::http', args: secretArgs() }, { timeoutMs: 5000 });
        expect(r).toMatchObject({ decision: 'approved', waitedMs: 0 });
        // 인자가 다르면(다른 호출) 이어받지 않는다 — 가린 사본끼리 같아 보여도 해시는 원문 기준
        const other = { ...secretArgs(), body: { api_key: 'sk-zzzzzzzzzzzzzzzzzzzzzzzz' } };
        let otherId = '';
        void after.request({ taskId: 't1', userId: 'u1', toolName: 'srv::http', args: other }, { timeoutMs: 50, onPending: (p) => { otherId = p.approvalId; } });
        await tick();
        expect(otherId).not.toBe('');
        expect(otherId).not.toBe(id);
    });

    it('skill_run 체크섬 결속은 가린 사본에도 그대로 남고, 원래 인자의 params 는 바뀌지 않는다', async () => {
        const store = fakeStore();
        const reg = new ApprovalRegistry(store);
        const args = { skill_id: 'sk1', params: { api_token: SECRET, city: '서울' }, [SKILL_RUN_CHECKSUM_ARG]: 'c'.repeat(64) };
        let id = '';
        void reg.request({ taskId: 't1', userId: 'u1', toolName: 'skill_run', args }, { timeoutMs: 5000, onPending: (p) => { id = p.approvalId; } });
        await tick();
        const row = store.rows.get(id)!;
        expect(row.args).toMatchObject({ skill_id: 'sk1', [SKILL_RUN_CHECKSUM_ARG]: 'c'.repeat(64), params: { api_token: '[REDACTED]', city: '서울' } });
        expect(args.params.api_token).toBe(SECRET);
        expect(row.args_hash).toBe(hashApprovalArgs(args));
    });

    it('위험 등급·자격증명 파일 표시는 원래 인자로 판정한다', async () => {
        const reg = new ApprovalRegistry();
        void reg.request({ taskId: 't1', userId: 'u1', toolName: 'file_ops', args: { op: 'write', path: '.env', content: `API_KEY=${SECRET}` } }, { timeoutMs: 5000 });
        const [p] = await reg.list('u1');
        expect(p).toMatchObject({ riskClass: 'write', sensitive: true, args: { op: 'write', path: '.env' } });
        expect(json(p)).not.toContain(SECRET);
    });
});
