import { createTaskTools, TASK_TERMINATE_SENTINEL, TASK_ASK_HUMAN_SENTINEL } from './tools';
import type { TaskSandbox, ExecResult } from './sandbox';
import type { MCPToolResult } from '../../mcp/types';

/** 인메모리 가짜 샌드박스 — docker 없이 도구 로직만 검증. */
function fakeSandbox(): TaskSandbox & { files: Map<string, string>; lastCmd: string; lastBrowser: string } {
    const files = new Map<string, string>();
    const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 });
    const sb = {
        files,
        lastCmd: '',
        lastBrowser: '',
        get isBrowserEnabled() { return true; },
        async exec(cmd: string) { (sb as { lastCmd: string }).lastCmd = cmd; return ok(`ran:${cmd}`); },
        async runBrowser(rel: string) { (sb as { lastBrowser: string }).lastBrowser = rel; return ok('browser-ran'); },
        async writeFile(p: string, c: string) { files.set(p, c); },
        async readFile(p: string) { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p) as string; },
        async listDir() { return [...files.keys()]; },
        async deleteFile(p: string) { files.delete(p); },
    };
    return sb as unknown as TaskSandbox & { files: Map<string, string>; lastCmd: string; lastBrowser: string };
}

function byName(tools: ReturnType<typeof createTaskTools>, name: string) {
    const t = tools.find((x) => x.tool.name === name);
    if (!t) throw new Error(`tool ${name} 없음`);
    return t;
}
const txt = (r: MCPToolResult) => r.content[0].text ?? '';

describe('task-sandbox tools', () => {
    it('11개 도구 제공 (5 sandbox + 3 plan + delegate + terminate + ask_human)', () => {
        const names = createTaskTools(fakeSandbox()).map((t) => t.tool.name);
        expect(names).toEqual(['bash', 'python_execute', 'str_replace_editor', 'file_ops', 'browser', 'plan_create', 'plan_update', 'plan_view', 'delegate', 'terminate', 'ask_human']);
    });

    describe('delegate', () => {
        it('delegate fn 호출 + 응답 반환', async () => {
            const dele = jest.fn().mockResolvedValue('전문가 자문 결과');
            const r = await byName(createTaskTools(fakeSandbox(), undefined, dele), 'delegate')
                .handler({ subgoal: '세금 처리 방법', role: 'finance' });
            expect(dele).toHaveBeenCalledWith('세금 처리 방법', 'finance');
            expect(txt(r)).toBe('전문가 자문 결과');
        });
        it('delegate fn 미제공 시 안내', async () => {
            const r = await byName(createTaskTools(fakeSandbox()), 'delegate').handler({ subgoal: 'x' });
            expect(r.isError).toBe(true);
        });
    });

    it('bash 는 exec 백엔드 호출', async () => {
        const sb = fakeSandbox();
        const r = await byName(createTaskTools(sb), 'bash').handler({ command: 'ls -la' });
        expect(sb.lastCmd).toBe('ls -la');
        expect(txt(r)).toContain('ran:ls -la');
    });

    it('python_execute 는 파일 저장 후 python3 실행', async () => {
        const sb = fakeSandbox();
        await byName(createTaskTools(sb), 'python_execute').handler({ code: 'print(1)' });
        expect(sb.files.get('_exec.py')).toBe('print(1)');
        expect(sb.lastCmd).toBe('python3 _exec.py');
    });

    it('python_execute filename 셸 메타문자·인자 주입 거절', async () => {
        const sb = fakeSandbox();
        const py = byName(createTaskTools(sb), 'python_execute');
        const inj = await py.handler({ code: 'print(1)', filename: 'x.py; cat /etc/passwd' });
        expect(inj.isError).toBe(true);
        const argInj = await py.handler({ code: 'print(1)', filename: '-c' });
        expect(argInj.isError).toBe(true);
        expect(sb.lastCmd).toBe(''); // 실행 자체가 안 됨
        const okSub = await py.handler({ code: 'print(1)', filename: 'sub/run_v1.py' });
        expect(okSub.isError).toBeFalsy();
    });

    describe('str_replace_editor', () => {
        it('create → view 왕복', async () => {
            const sb = fakeSandbox();
            const ed = byName(createTaskTools(sb), 'str_replace_editor');
            await ed.handler({ command: 'create', path: 'a.txt', file_text: 'hello' });
            expect(txt(await ed.handler({ command: 'view', path: 'a.txt' }))).toBe('hello');
        });
        it('str_replace 유일성 강제 (중복 시 거절)', async () => {
            const sb = fakeSandbox();
            const ed = byName(createTaskTools(sb), 'str_replace_editor');
            await ed.handler({ command: 'create', path: 'a.txt', file_text: 'x x x' });
            const dup = await ed.handler({ command: 'str_replace', path: 'a.txt', old_str: 'x', new_str: 'y' });
            expect(dup.isError).toBe(true);
            expect(txt(dup)).toContain('중복');
        });
        it('str_replace 없는 문자열 거절', async () => {
            const sb = fakeSandbox();
            const ed = byName(createTaskTools(sb), 'str_replace_editor');
            await ed.handler({ command: 'create', path: 'a.txt', file_text: 'abc' });
            const miss = await ed.handler({ command: 'str_replace', path: 'a.txt', old_str: 'zzz', new_str: 'y' });
            expect(miss.isError).toBe(true);
        });
        it('str_replace 정상 치환', async () => {
            const sb = fakeSandbox();
            const ed = byName(createTaskTools(sb), 'str_replace_editor');
            await ed.handler({ command: 'create', path: 'a.txt', file_text: 'foo bar' });
            await ed.handler({ command: 'str_replace', path: 'a.txt', old_str: 'bar', new_str: 'baz' });
            expect(sb.files.get('a.txt')).toBe('foo baz');
        });
    });

    describe('file_ops', () => {
        it('write → read → list → delete', async () => {
            const sb = fakeSandbox();
            const fo = byName(createTaskTools(sb), 'file_ops');
            await fo.handler({ op: 'write', path: 'a.txt', content: 'data' });
            expect(txt(await fo.handler({ op: 'read', path: 'a.txt' }))).toBe('data');
            expect(txt(await fo.handler({ op: 'list' }))).toContain('a.txt');
            await fo.handler({ op: 'delete', path: 'a.txt' });
            expect(sb.files.has('a.txt')).toBe(false);
        });
    });

    describe('browser', () => {
        it('actions JSON 작성 후 러너 실행', async () => {
            const sb = fakeSandbox();
            const r = await byName(createTaskTools(sb), 'browser').handler({
                actions: [{ type: 'goto', url: 'https://example.com' }, { type: 'extractText' }],
                allowlist: ['example.com'],
            });
            const spec = JSON.parse(sb.files.get('.browser-actions.json') as string);
            expect(spec.actions).toHaveLength(2);
            expect(spec.allowlist).toEqual(['example.com']);
            expect(sb.lastBrowser).toBe('.browser-actions.json'); // 별도 일회성 컨테이너로 실행
            expect(txt(r)).toContain('browser-ran');
        });
        it('빈 actions 거절', async () => {
            const r = await byName(createTaskTools(fakeSandbox()), 'browser').handler({ actions: [] });
            expect(r.isError).toBe(true);
        });
        it('단일 액션 객체는 배열로 감싼다', async () => {
            const sb = fakeSandbox();
            await byName(createTaskTools(sb), 'browser').handler({ actions: { type: 'goto', url: 'https://example.com' } });
            const spec = JSON.parse(sb.files.get('.browser-actions.json') as string);
            expect(spec.actions).toEqual([{ type: 'goto', url: 'https://example.com' }]);
        });
    });

    describe('plan_create / plan_update 인자 관용', () => {
        it('plan_create: 단일 문자열도 배열로 감싼다', async () => {
            const tools = createTaskTools(fakeSandbox());
            const r = await byName(tools, 'plan_create').handler({ steps: '조사하기' });
            expect(r.isError).toBeFalsy();
            expect(txt(r)).toContain('조사하기');
        });
        it('plan_create: 빈 steps 거절', async () => {
            const r = await byName(createTaskTools(fakeSandbox()), 'plan_create').handler({ steps: [] });
            expect(r.isError).toBe(true);
        });
        it('plan_update: 계획 없을 때 안내 메시지', async () => {
            const r = await byName(createTaskTools(fakeSandbox()), 'plan_update').handler({ step: 1, status: 'completed' });
            expect(r.isError).toBe(true);
            expect(txt(r)).toContain('먼저 plan_create');
        });
        it('plan_update: 범위 초과 시 유효 범위를 안내한다', async () => {
            const tools = createTaskTools(fakeSandbox());
            await byName(tools, 'plan_create').handler({ steps: ['a', 'b'] });
            const r = await byName(tools, 'plan_update').handler({ step: 5, status: 'completed' });
            expect(r.isError).toBe(true);
            expect(txt(r)).toContain('1..2');
        });
    });

    it('terminate 는 sentinel 반환', async () => {
        const r = await byName(createTaskTools(fakeSandbox()), 'terminate').handler({ status: 'success', summary: '완료' });
        expect(txt(r)).toContain(TASK_TERMINATE_SENTINEL);
        expect(txt(r)).toContain('완료');
    });

    it('ask_human 은 sentinel 반환', async () => {
        const r = await byName(createTaskTools(fakeSandbox()), 'ask_human').handler({ question: '계속?' });
        expect(txt(r)).toContain(TASK_ASK_HUMAN_SENTINEL);
        expect(txt(r)).toContain('계속?');
    });
});
