import { createCodeNavTools, shq, normalizeRelPath } from './tools-code-nav';
import type { TaskExecutor, ExecResult, CodeNavSpec, CodeNavData } from './executor';

function exec(stdout: string, exitCode = 0, stderr = ''): ExecResult {
    return { stdout, stderr, exitCode, truncated: false, timedOut: false, durationMs: 1 };
}

function fakeSandbox(impl: (cmd: string) => ExecResult): { sandbox: TaskExecutor; cmds: string[] } {
    const cmds: string[] = [];
    const sandbox = {
        exec: jest.fn(async (cmd: string) => { cmds.push(cmd); return impl(cmd); }),
    } as unknown as TaskExecutor;
    return { sandbox, cmds };
}

/** 네이티브 탐색(codeNav)을 구현한 실행기 — 로컬 브리지 등가. */
function nativeSandbox(
    impl: (spec: CodeNavSpec) => CodeNavData | null | Promise<CodeNavData | null>,
): { sandbox: TaskExecutor; specs: CodeNavSpec[]; cmds: string[] } {
    const specs: CodeNavSpec[] = [];
    const cmds: string[] = [];
    const sandbox = {
        exec: jest.fn(async (cmd: string) => { cmds.push(cmd); return exec(''); }),
        codeNav: jest.fn(async (spec: CodeNavSpec) => { specs.push(spec); return impl(spec); }),
    } as unknown as TaskExecutor;
    return { sandbox, specs, cmds };
}

const text = (r: { content: { text?: string }[] }) => r.content[0].text ?? '';

describe('shq / normalizeRelPath', () => {
    it('단일 인용 이스케이프', () => {
        expect(shq(`a'b`)).toBe(`'a'\\''b'`);
    });
    it('절대 경로·상위 탈출은 거절, 상대 경로는 정규화', () => {
        expect(normalizeRelPath('')).toBe('.');
        expect(normalizeRelPath('./src')).toBe('src');
        expect(normalizeRelPath('/etc')).toBeNull();
        expect(normalizeRelPath('a/../b')).toBeNull();
    });
});

describe('grep_code', () => {
    it('rg 결과를 캡·줄 절단해 돌려주고 node_modules 제외 글롭을 포함한다', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(['a.ts:1:foo', 'b.ts:2:' + 'z'.repeat(400)].join('\n')));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'foo', glob: '*.ts' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('a.ts:1:foo');
        expect(text(r)).toContain('…');
        expect(cmds[0]).toContain("rg -n");
        expect(cmds[0]).toContain("-g '!node_modules/**'");
        expect(cmds[0]).toContain("-g '*.ts'");
        expect(cmds[0]).toContain("-e 'foo'");
    });

    it('rg 미설치(127)면 grep 으로 폴백한다', async () => {
        const { sandbox, cmds } = fakeSandbox((cmd) => cmd.startsWith('rg') ? exec('', 127, 'rg: not found') : exec('x.py:3:def foo'));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'def foo' });
        expect(text(r)).toContain('x.py:3:def foo');
        expect(text(r)).toContain('grep 사용');
        expect(cmds[1]).toContain('grep -rnI -E');
    });

    it('무일치는 오류가 아니다', async () => {
        const { sandbox } = fakeSandbox(() => exec('', 0));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'nothing' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('일치 없음');
    });

    it('결과가 상한을 넘으면 잘림 안내를 붙인다', async () => {
        const lines = Array.from({ length: 200 }, (_, i) => `f.ts:${i}:m`).join('\n');
        const { sandbox } = fakeSandbox(() => exec(lines));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'm', max_results: 10 });
        expect(text(r).split('\n').filter((l) => l.startsWith('f.ts:')).length).toBe(10);
        expect(text(r)).toContain('잘림');
    });

    it('절대 경로·빈 패턴은 거절한다', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(''));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        expect((await grep.handler({ pattern: 'x', path: '/etc' })).isError).toBe(true);
        expect((await grep.handler({ pattern: '  ' })).isError).toBe(true);
        expect(cmds.length).toBe(0);
    });

    it('셸 메타문자가 든 패턴은 인용돼 명령으로 새지 않는다', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(''));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        await grep.handler({ pattern: `x'; rm -rf / #` });
        expect(cmds[0]).toContain(`-e 'x'\\''; rm -rf / #'`);
    });
});

describe('repo_map', () => {
    it('파일 목록을 디렉토리 요약·파일·심볼로 조립한다', async () => {
        const { sandbox } = fakeSandbox((cmd) => cmd.startsWith('find')
            ? exec(['12\t./src/a.ts', '30\t./src/b.ts', '5\t./README.md'].join('\n'))
            : exec('./src/a.ts:1:export function foo() {'));
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const out = text(await map.handler({}));
        expect(out).toContain('src/  파일 2 · 42줄');
        expect(out).toContain('(root)  파일 1 · 5줄');
        expect(out).toContain('src/a.ts (12)');
        expect(out).toContain('## 심볼 선언');
        expect(out).toContain('src/a.ts:1:export function foo');
    });

    it('symbols=false 면 find 한 번만 실행한다', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec('1\t./x.py'));
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        await map.handler({ symbols: false });
        expect(cmds.length).toBe(1);
        expect(cmds[0]).toContain("-name 'node_modules'");
        expect(cmds[0]).toContain('-prune');
    });

    it('빈 디렉토리는 오류 없이 안내한다', async () => {
        const { sandbox } = fakeSandbox(() => exec(''));
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const r = await map.handler({ path: 'empty' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('파일 없음');
    });
});

describe('네이티브 백엔드(codeNav) 우선 — 로컬 브리지 승인 창 회피', () => {
    it('grep_code 는 codeNav 를 쓰고 셸을 부르지 않는다', async () => {
        const { sandbox, specs, cmds } = nativeSandbox(() => ({ matches: ['a.ts:1:foo', 'b.ts:2:foo'] }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'foo', glob: '*.ts', ignore_case: true, max_results: 5 });
        expect(text(r)).toContain('a.ts:1:foo');
        expect(cmds).toEqual([]);                       // 셸 미사용 = 디바이스 confirmExec 미발동
        expect(specs[0]).toEqual({ op: 'grep', path: '.', pattern: 'foo', maxResults: 5, glob: '*.ts', ignoreCase: true });
    });

    it('repo_map 은 files + grep 두 번의 codeNav 로 조립한다', async () => {
        const { sandbox, specs, cmds } = nativeSandbox((spec) => spec.op === 'files'
            ? { files: [{ path: 'src/a.ts', lines: 12 }, { path: 'README.md', lines: 5 }] }
            : { matches: ['src/a.ts:1:export function foo() {'] });
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const out = text(await map.handler({}));
        expect(out).toContain('src/  파일 1 · 12줄');
        expect(out).toContain('src/a.ts (12)');
        expect(out).toContain('## 심볼 선언');
        expect(out).toContain('src/a.ts:1:export function foo');
        expect(cmds).toEqual([]);
        expect(specs.map((s) => s.op)).toEqual(['files', 'grep']);
    });

    it('구 디바이스(null)면 셸 경로로 폴백한다', async () => {
        const { sandbox, cmds } = nativeSandbox(() => null);
        (sandbox as unknown as { exec: jest.Mock }).exec = jest.fn(async (cmd: string) => { cmds.push(cmd); return exec('x.ts:9:foo'); });
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        expect(text(await grep.handler({ pattern: 'foo' }))).toContain('x.ts:9:foo');
        expect(cmds[0]).toContain('rg -n');
    });

    it('codeNav 가 던져도 셸로 폴백한다(fail-open)', async () => {
        const cmds: string[] = [];
        const sandbox = {
            exec: jest.fn(async (cmd: string) => { cmds.push(cmd); return exec('y.ts:1:foo'); }),
            codeNav: jest.fn(async () => { throw new Error('bridge down'); }),
        } as unknown as TaskExecutor;
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        expect(text(await grep.handler({ pattern: 'foo' }))).toContain('y.ts:1:foo');
        expect(cmds.length).toBeGreaterThan(0);
    });

    it('네이티브 truncated 는 잘림 안내로 노출된다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: ['a.ts:1:foo'], truncated: true }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        expect(text(await grep.handler({ pattern: 'foo' }))).toContain('잘림');
    });

    it('네이티브 무일치는 오류가 아니다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: [] }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'nothing' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('일치 없음');
    });
});
