/**
 * 자동승인의 바닥 — "나머지 모두 승인"에서도 계속 묻는 호출. 바닥 검사가 전체 허용보다 먼저 돈다.
 */
import { approvalFloorReason } from '../approval-floor';
import { ApprovalRegistry, isSensitiveWrite, requiresApproval, type ApprovalStore } from '../approval-gate';
import { parseApprovalFloorKinds } from '../../../config/agent-task-approval';
import type { ApprovalRow } from '../../../data/repositories/agent-task-approval-repository';

const tick = () => new Promise((r) => setImmediate(r));

describe('parseApprovalFloorKinds', () => {
    it('미지정이면 기본 목록, 빈 값·none 이면 바닥 없음, 모르는 이름은 버린다', () => {
        expect(parseApprovalFloorKinds(undefined)).toEqual(expect.arrayContaining(['credential_write', 'third_party_tool', 'instruction_write']));
        expect(parseApprovalFloorKinds('')).toEqual([]);
        expect(parseApprovalFloorKinds('none')).toEqual([]);
        expect(parseApprovalFloorKinds(' Credential_Write , nope ')).toEqual(['credential_write']);
    });
});

describe('approvalFloorReason', () => {
    it('자격증명 파일을 바꾸는 호출', () => {
        expect(approvalFloorReason('file_ops', { op: 'write', path: '.env' })).toBe('credential_write');
        expect(approvalFloorReason('file_ops', { op: 'delete', path: 'deploy/id_rsa' })).toBe('credential_write');
        expect(approvalFloorReason('str_replace_editor', { command: 'create', path: 'certs/server.pem' })).toBe('credential_write');
        expect(approvalFloorReason('str_replace_editor', { command: 'str_replace', path: '.npmrc' })).toBe('credential_write');
        expect(approvalFloorReason('str_replace_editor', { command: 'insert', path: 'a/.ENV.Local' })).toBe('credential_write');
    });
    it('외부 MCP 서버 도구(server::tool)', () => {
        expect(approvalFloorReason('notion::create_page', {})).toBe('third_party_tool');
    });
    it('그 밖은 바닥이 아니다 — 읽기, 일반 파일 쓰기, 셸, 내장 도구', () => {
        expect(approvalFloorReason('file_ops', { op: 'read', path: '.env' })).toBeNull();
        expect(approvalFloorReason('str_replace_editor', { command: 'view', path: '.env' })).toBeNull();
        expect(approvalFloorReason('file_ops', { op: 'write', path: 'src/index.ts' })).toBeNull();
        expect(approvalFloorReason('bash', { command: 'ls' })).toBeNull();
        expect(approvalFloorReason('web_search', { query: 'x' })).toBeNull();
        expect(approvalFloorReason('file_ops', {})).toBeNull();
    });
});

describe('approvalFloorReason — 지시 파일 쓰기', () => {
    const write = (path: string) => approvalFloorReason('file_ops', { op: 'write', path });
    const edit = (path: string) => approvalFloorReason('str_replace_editor', { command: 'str_replace', path });

    it('에이전트 지시 파일은 위치와 무관하게 바닥이다', () => {
        for (const p of ['AGENTS.md', 'CLAUDE.md', 'packages/api/CLAUDE.md', 'CLAUDE.local.md', 'GEMINI.md', '.cursorrules', '.windsurfrules',
            '.github/copilot-instructions.md', 'repo/.github/copilot-instructions.md', '.cursor/rules/style.mdc', 'src/.cursor/rules/sub/deep.mdc',
            '.claude/settings.json', '.claude/commands/x.md', '/workspace/AGENTS.md']) {
            expect(write(p)).toBe('instruction_write');
            expect(edit(p)).toBe('instruction_write');
        }
        expect(approvalFloorReason('file_ops', { op: 'delete', path: 'AGENTS.md' })).toBe('instruction_write');
        expect(approvalFloorReason('str_replace_editor', { command: 'create', path: 'CLAUDE.md' })).toBe('instruction_write');
        expect(approvalFloorReason('str_replace_editor', { command: 'insert', path: 'CLAUDE.md' })).toBe('instruction_write');
    });

    it('표기를 바꿔도 비켜 가지 못한다 — 대소문자, `..`·`.` 구간, 겹친 구분자, 역슬래시, 끝의 구분자·점·공백', () => {
        for (const p of ['agents.md', 'Agents.MD', 'claude.MD', '.CursorRules', '.GitHub/Copilot-Instructions.md',
            './AGENTS.md', 'docs/../AGENTS.md', 'a/b/../../CLAUDE.md', 'a//b/..//../AGENTS.md', 'AGENTS.md/.', 'AGENTS.md/', 'AGENTS.md//',
            'x/y/../AGENTS.md/./', 'sub\\AGENTS.md', '.\\CLAUDE.md', 'tmp/../.github/./copilot-instructions.md', '.cursor/rules/../rules/a.mdc',
            'AGENTS.md ', 'AGENTS.md.', 'AGENTS.md. .', '/workspace/x/../AGENTS.md', '../AGENTS.md', '../../outside/CLAUDE.md']) {
            expect(write(p)).toBe('instruction_write');
        }
    });

    it('자격증명 파일도 같은 정규화 뒤에 본다', () => {
        for (const p of ['.env/.', 'x/../.ENV', 'a\\.env', 'conf/.env/', 'keys/./id_rsa', 'certs/a/../server.PEM', '.env ', '.npmrc.']) {
            expect(write(p)).toBe('credential_write');
            expect(isSensitiveWrite('file_ops', { op: 'write', path: p })).toBe(true);
        }
    });

    it('이름이 비슷한 일반 파일·읽기·`..` 로 벗어난 경로는 바닥이 아니다', () => {
        for (const p of ['README.md', 'docs/AGENTS.md.bak', 'notes/agents.md.txt', 'MY_AGENTS.md', 'src/copilot-instructions.md',
            'AGENTS.md/../README.md', 'CLAUDE.md/../../src/index.ts', '.cursor/settings.json', '.cursor/rules', 'docs/claude/notes.md', '.env/../README.md']) {
            expect(write(p)).toBeNull();
        }
        expect(approvalFloorReason('file_ops', { op: 'read', path: 'AGENTS.md' })).toBeNull();
        expect(approvalFloorReason('str_replace_editor', { command: 'view', path: 'CLAUDE.md' })).toBeNull();
        expect(approvalFloorReason('file_ops', { op: 'write', path: 42 })).toBeNull();
        expect(approvalFloorReason('file_ops', { op: 'write', path: '' })).toBeNull();
        expect(approvalFloorReason('file_ops', { op: 'write', path: '../..' })).toBeNull();
    });

    it('정책 high-risk 에서도 승인 대상이다(바닥은 정책 high-risk 가 묻는 범위 안에 있다). 정책 none 은 그대로 자동', () => {
        expect(requiresApproval('high-risk', 'file_ops', { op: 'write', path: 'x/../CLAUDE.md' })).toBe(true);
        expect(requiresApproval('high-risk', 'str_replace_editor', { command: 'create', path: 'agents.md' })).toBe(true);
        expect(requiresApproval('high-risk', 'file_ops', { op: 'write', path: 'README.md' })).toBe(false);
        expect(requiresApproval('high-risk', 'file_ops', { op: 'read', path: 'CLAUDE.md' })).toBe(false);
        expect(requiresApproval('none', 'file_ops', { op: 'write', path: 'CLAUDE.md' })).toBe(false);
    });

    it('자동승인 작업에서도 지시 파일 쓰기는 대기한다', async () => {
        const reg = new ApprovalRegistry();
        reg.setAutoApprove('t1', true);
        const p = reg.request({ taskId: 't1', userId: 'u1', toolName: 'str_replace_editor', args: { command: 'create', path: 'docs/../AGENTS.md', file_text: 'x' } }, { timeoutMs: 30 });
        expect(await reg.list('u1')).toHaveLength(1);
        await expect(p).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
        expect(reg.autoApproves('t1', 'file_ops', { op: 'write', path: 'README.md' })).toBe(true);
    });
});

describe('ApprovalRegistry — 자동승인보다 바닥이 먼저', () => {
    const base = { taskId: 't1', userId: 'u1' };

    it('자동승인 작업에서도 바닥 호출은 대기하고, 일반 호출은 즉시 통과한다', async () => {
        const reg = new ApprovalRegistry();
        reg.setAutoApprove('t1', true);
        expect(await reg.request({ ...base, toolName: 'bash', args: { command: 'ls' } }, { timeoutMs: 5000 })).toEqual({ decision: 'approved', waitedMs: 0 });

        let id = '';
        const p = reg.request({ ...base, toolName: 'file_ops', args: { op: 'write', path: '.env', content: 'A=1' } }, { timeoutMs: 5000, onPending: (pa) => { id = pa.approvalId; } });
        expect(await reg.list('u1')).toHaveLength(1);
        expect(await reg.approve(id)).toBe(true);
        await expect(p).resolves.toMatchObject({ decision: 'approved' });

        const mcp = reg.request({ ...base, toolName: 'notion::create_page', args: { title: 'x' } }, { timeoutMs: 30 });
        expect(await reg.list('u1')).toHaveLength(1);
        await expect(mcp).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
    });

    it('autoApproves — 호출부(선실행·서브 도구 선별)가 같은 판정을 쓴다', () => {
        const reg = new ApprovalRegistry();
        expect(reg.autoApproves('t1', 'bash', {})).toBe(false);
        reg.setAutoApprove('t1', true);
        expect(reg.autoApproves('t1', 'bash', {})).toBe(true);
        expect(reg.autoApproves('t1', 'web_search', {})).toBe(true);
        expect(reg.autoApproves('t1', 'ask_human', {})).toBe(false);
        expect(reg.autoApproves('t1', 'srv::tool', {})).toBe(false);
        expect(reg.autoApproves('t1', 'file_ops', { op: 'write', path: 'k/.env' })).toBe(false);
        expect(reg.autoApproves('t2', 'bash', {})).toBe(false);
    });

    it('자동승인을 켤 때 대기 중이던 일반 호출만 해소하고 바닥 호출은 남긴다', async () => {
        const reg = new ApprovalRegistry();
        const normal = reg.request({ ...base, toolName: 'bash', args: { command: 'ls' } }, { timeoutMs: 5000 });
        let floorId = '';
        const floor = reg.request({ ...base, toolName: 'str_replace_editor', args: { command: 'create', path: 'secrets/credentials.json', file_text: '{}' } }, { timeoutMs: 5000, onPending: (pa) => { floorId = pa.approvalId; } });
        const mcp = reg.request({ ...base, toolName: 'srv::write', args: {} }, { timeoutMs: 40 });
        expect(await reg.list('u1')).toHaveLength(3);
        reg.setAutoApprove('t1', true);
        await expect(normal).resolves.toMatchObject({ decision: 'approved' });
        expect((await reg.list('u1')).map((x) => x.toolName).sort()).toEqual(['srv::write', 'str_replace_editor']);
        await reg.reject(floorId);
        await expect(floor).resolves.toMatchObject({ decision: 'rejected', reason: 'user' });
        await expect(mcp).resolves.toMatchObject({ decision: 'rejected', reason: 'timeout' });
    });

    it('저장소의 pending 행도 바닥 호출은 승인으로 닫지 않는다', async () => {
        const rows = new Map<string, ApprovalRow>();
        const row = (id: string, tool: string, args: Record<string, unknown>): ApprovalRow => ({
            approval_id: id, task_id: 't1', user_id: 'u1', tool_name: tool, args, args_hash: id, risk_class: null, status: 'pending', answer_text: null,
            created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), decided_at: null, consumed_at: null,
        });
        const store: ApprovalStore = {
            insertPending: async (r) => { rows.set(r.approvalId, row(r.approvalId, r.toolName, r.args)); },
            markDecided: async (id, status) => { const r = rows.get(id); if (!r || r.status !== 'pending') return false; r.status = status; return true; },
            listPending: async (userId) => [...rows.values()].filter((r) => r.user_id === userId && r.status === 'pending'),
            getPending: async (id) => rows.get(id),
            takeoverForCall: async () => undefined,
            expirePendingForTask: async () => undefined,
        };
        rows.set('old_bash', row('old_bash', 'bash', { command: 'ls' }));
        rows.set('old_env', row('old_env', 'file_ops', { op: 'write', path: '.env' }));
        rows.set('old_mcp', row('old_mcp', 'srv::tool', {}));
        const reg = new ApprovalRegistry(store);
        // 살아 있는 waiter 하나 — setAutoApprove 가 사용자 id 를 여기서 얻는다
        void reg.request({ ...base, toolName: 'python_execute', args: { code: '1' } }, { timeoutMs: 5000 });
        await tick();
        reg.setAutoApprove('t1', true);
        await tick(); await tick();
        expect(rows.get('old_bash')?.status).toBe('approved');
        expect(rows.get('old_env')?.status).toBe('pending');
        expect(rows.get('old_mcp')?.status).toBe('pending');
    });
});
