import { checkEditSyntax } from './edit-syntax-check';
import type { TaskExecutor, ExecResult } from './executor';

const res = (exitCode: number, stderr = ''): ExecResult => ({ stdout: '', stderr, exitCode, truncated: false, timedOut: false, durationMs: 1 });

/** 파일 내용에 BAD 가 있으면 문법 오류로 답하는 가짜 실행기. */
function fakeExecutor(files: Record<string, string>, exec?: (cmd: string) => ExecResult) {
    const store = new Map(Object.entries(files));
    const cmds: string[] = [];
    const sandbox = {
        exec: jest.fn(async (cmd: string) => {
            cmds.push(cmd);
            if (exec) return exec(cmd);
            const file = [...store.keys()].find((f) => cmd.includes(f));
            return file && store.get(file)!.includes('BAD') ? res(1, `${file}:3\nSyntaxError: Unexpected token`) : res(0);
        }),
        readFile: jest.fn(async (p: string) => { if (!store.has(p)) throw new Error('ENOENT'); return store.get(p)!; }),
        writeFile: jest.fn(async (p: string, c: string) => { store.set(p, c); }),
        deleteFile: jest.fn(async (p: string) => { store.delete(p); }),
    } as unknown as TaskExecutor;
    return { sandbox, cmds, store };
}

describe('편집 후 문법 검사', () => {
    it('JS 파일은 node --check 로 검사하고 오류를 알린다', async () => {
        const { sandbox, cmds } = fakeExecutor({ 'src/a.js': 'BAD' });
        const note = await checkEditSyntax(sandbox, 'src/a.js');
        expect(cmds[0]).toBe("node --check 'src/a.js'");
        expect(note).toContain('문법 오류');
        expect(note).toContain('SyntaxError: Unexpected token');
    });

    it('파이썬 파일은 컴파일만 해 보고(.pyc 를 남기지 않는다) 오류를 알린다', async () => {
        const { sandbox, cmds } = fakeExecutor({ 'a.py': 'BAD' });
        const note = await checkEditSyntax(sandbox, 'a.py');
        expect(cmds[0]).toContain('python3 -c');
        expect(cmds[0]).toContain('compile(');
        expect(cmds[0]).not.toContain('py_compile');
        expect(note).toContain('문법 오류');
    });

    it('JSON 은 명령을 돌리지 않고 내용을 파싱한다', async () => {
        const { sandbox, cmds } = fakeExecutor({ 'bad.json': '{"a": 1,}', 'ok.json': '{"a": 1}' });
        expect(await checkEditSyntax(sandbox, 'bad.json')).toContain('문법 오류');
        expect(await checkEditSyntax(sandbox, 'ok.json')).toBeNull();
        expect(cmds).toHaveLength(0);
    });

    it('문법이 맞으면 아무것도 붙이지 않는다', async () => {
        const { sandbox } = fakeExecutor({ 'a.js': 'ok' });
        expect(await checkEditSyntax(sandbox, 'a.js')).toBeNull();
    });

    it('검사할 수 없는 확장자는 명령을 돌리지 않는다', async () => {
        const { sandbox, cmds } = fakeExecutor({ 'a.ts': 'BAD', 'README.md': 'BAD' });
        expect(await checkEditSyntax(sandbox, 'a.ts')).toBeNull();
        expect(await checkEditSyntax(sandbox, 'README.md')).toBeNull();
        expect(cmds).toHaveLength(0);
    });

    it('편집 전에도 깨져 있던 파일이면 알리지 않는다 — 이번 편집이 만든 오류만', async () => {
        const { sandbox, store } = fakeExecutor({ 'a.js': 'BAD after' });
        expect(await checkEditSyntax(sandbox, 'a.js', 'BAD before')).toBeNull();
        expect([...store.keys()]).toEqual(['a.js']); // 비교용 임시 파일은 지운다
    });

    it('편집 전에는 멀쩡했으면 알린다', async () => {
        const { sandbox } = fakeExecutor({ 'a.js': 'BAD after' });
        expect(await checkEditSyntax(sandbox, 'a.js', 'fine before')).toContain('문법 오류');
    });

    it('JSON 도 편집 전부터 깨져 있었으면 알리지 않는다', async () => {
        const { sandbox } = fakeExecutor({ 'a.json': '{,}' });
        expect(await checkEditSyntax(sandbox, 'a.json', '{bad')).toBeNull();
    });

    it('인터프리터가 없거나(127) 시간 초과면 조용히 넘어간다', async () => {
        expect(await checkEditSyntax(fakeExecutor({ 'a.js': 'x' }, () => res(127, 'node: not found')).sandbox, 'a.js')).toBeNull();
        expect(await checkEditSyntax(fakeExecutor({ 'a.js': 'x' }, () => ({ ...res(1, 'x'), timedOut: true })).sandbox, 'a.js')).toBeNull();
    });

    it('검사가 던져도 null 이다(fail-open)', async () => {
        const { sandbox } = fakeExecutor({ 'a.js': 'x' }, () => { throw new Error('docker down'); });
        expect(await checkEditSyntax(sandbox, 'a.js')).toBeNull();
    });

    it('경로는 셸 인용되고 - 로 시작하면 ./ 를 붙인다', async () => {
        const { sandbox, cmds } = fakeExecutor({ "-x'y.js": 'ok' });
        await checkEditSyntax(sandbox, "-x'y.js");
        expect(cmds[0]).toBe(`node --check './-x'\\''y.js'`);
    });

    it('끄면 검사하지 않는다', async () => {
        const { sandbox, cmds } = fakeExecutor({ 'a.js': 'BAD' });
        expect(await checkEditSyntax(sandbox, 'a.js', undefined, false)).toBeNull();
        expect(cmds).toHaveLength(0);
    });
});
