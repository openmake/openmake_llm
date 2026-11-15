import { createCodeNavTools, shq, normalizeRelPath, relArg } from './tools-code-nav';
import type { TaskExecutor, ExecResult, CodeNavSpec, CodeNavData } from './executor';
import { GREP_REGEX_DIALECT_HINTS, GREP_CODE_PATTERN_DESCRIPTION } from '../../prompts/agent-task-tools';
import { GREP_DIALECT_HINT } from '../../config/agent-task-tools';

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
    it('- 로 시작하는 경로 세그먼트는 옵션 주입이라 거절한다', () => {
        expect(normalizeRelPath('-delete')).toBeNull();
        expect(normalizeRelPath('src/-x')).toBeNull();
        expect(normalizeRelPath('--files0-from=/etc/passwd')).toBeNull();
        expect(normalizeRelPath('./-exec')).toBeNull();
        // 일반 경로는 그대로 통과(세그먼트 중간의 - 는 허용).
        expect(normalizeRelPath('src')).toBe('src');
        expect(normalizeRelPath('.')).toBe('.');
        expect(normalizeRelPath('apps/web')).toBe('apps/web');
        expect(normalizeRelPath('my-app/src')).toBe('my-app/src');
    });
    it('relArg 는 셸 인자를 ./ 로 고정하되 "." 는 그대로 둔다', () => {
        expect(relArg('.')).toBe('.');
        expect(relArg('src')).toBe('./src');
        expect(relArg('apps/web')).toBe('./apps/web');
    });
});

describe('셸 경로 인자는 ./ 로 고정된다', () => {
    it("repo_map 의 find 와 skipped find 가 './src' 로 시작한다", async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(''));
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        await map.handler({ path: 'src', symbols: false });
        expect(cmds[0]).toContain("find './src' ");
        expect(cmds[0]).toContain("$(find './src' ");
        expect(cmds[0]).not.toContain("find 'src'");
    });
    it("grep_code 의 rg·grep 경로가 './apps/web' 이다", async () => {
        const { sandbox, cmds } = fakeSandbox((cmd) => cmd.startsWith('rg') ? exec('', 127) : exec(''));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        await grep.handler({ pattern: 'foo', path: 'apps/web' });
        expect(cmds[0]).toContain("-- './apps/web' |");
        expect(cmds[1]).toContain("-- './apps/web' |");
        expect(cmds[0]).toContain("$(find './apps/web' ");
    });
    it("path 생략·'.' 은 '.' 그대로 쓴다('./.' 아님)", async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(''));
        const tools = createCodeNavTools(sandbox);
        await tools.find((t) => t.tool.name === 'grep_code')!.handler({ pattern: 'foo', path: '.' });
        await tools.find((t) => t.tool.name === 'repo_map')!.handler({ symbols: false });
        expect(cmds[0]).toContain("-- '.' |");
        expect(cmds[cmds.length - 1]).toMatch(/^find '\.' /);
        expect(cmds.join('\n')).not.toContain('./.');
    });
    it('- 로 시작하는 path 는 명령을 실행하지 않고 오류', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(''));
        const tools = createCodeNavTools(sandbox);
        expect((await tools.find((t) => t.tool.name === 'grep_code')!.handler({ pattern: 'x', path: '-delete' })).isError).toBe(true);
        expect((await tools.find((t) => t.tool.name === 'repo_map')!.handler({ path: 'src/-x' })).isError).toBe(true);
        expect(cmds.length).toBe(0);
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

describe('grep_code 무일치 원인 안내', () => {
    const grepOf = (sandbox: TaskExecutor) => createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;

    it('대소문자를 무시하면 맞는 경우 ignore_case 를 알린다', async () => {
        const { sandbox } = fakeSandbox((cmd) => (cmd.includes(' -i ') ? exec('a.ts:3:const UserName = 1') : exec('')));
        const r = await grepOf(sandbox).handler({ pattern: 'username' });
        expect(r.isError).toBeFalsy();
        expect(text(r).split('\n')).toHaveLength(1);
        expect(text(r)).toContain('일치 없음');
        expect(text(r)).toContain('ignore_case');
    });

    it('정규식 문자를 문자 그대로 보면 맞는 경우 이스케이프한 패턴을 알린다', async () => {
        const { sandbox } = fakeSandbox((cmd) => (cmd.includes(String.raw`-e 'render\(a\.b\)'`) ? exec('a.ts:1:render(a.b)') : exec('')));
        const r = await grepOf(sandbox).handler({ pattern: 'render(a.b)' });
        expect(text(r)).toContain(String.raw`render\(a\.b\)`);
        expect(text(r)).toContain('정규식');
    });

    it('숨김·무시 대상 파일에만 있으면 그 파일을 path 로 지목하라고 알린다', async () => {
        const { sandbox } = fakeSandbox((cmd) => (cmd.includes('--hidden') ? exec('.github/workflows/ci.yml:4:deploy') : exec('')));
        const r = await grepOf(sandbox).handler({ pattern: 'deploy' });
        expect(text(r)).toContain('.github/workflows/ci.yml');
        expect(text(r)).toContain('path');
    });

    it('원인을 찾지 못하면 종전 문구 그대로다', async () => {
        const { sandbox } = fakeSandbox(() => exec(''));
        const r = await grepOf(sandbox).handler({ pattern: 'nothing' });
        expect(text(r)).toBe('(일치 없음: nothing)');
    });

    it('이미 ignore_case 로 찾았고 정규식 문자가 없으면 그 확인은 돌리지 않는다', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec(''));
        await grepOf(sandbox).handler({ pattern: 'nothing', ignore_case: true });
        expect(cmds).toHaveLength(2); // 본 검색 + 숨김 확인
    });

    it('네이티브 탐색이 실패해 셸로 떨어진 실행기에서는 추가 명령을 돌리지 않는다(승인 창이 뜬다)', async () => {
        const { sandbox, cmds } = nativeSandbox(() => null);
        const r = await grepOf(sandbox).handler({ pattern: 'username' });
        expect(text(r)).toContain('일치 없음');
        expect(cmds).toHaveLength(1);
    });

    it('네이티브 탐색에서는 대소문자·정규식 확인만 한다', async () => {
        const { sandbox, specs, cmds } = nativeSandbox((spec) => ({ matches: spec.ignoreCase ? ['a.ts:1:UserName'] : [] }));
        const r = await grepOf(sandbox).handler({ pattern: 'username' });
        expect(text(r)).toContain('ignore_case');
        expect(specs).toHaveLength(2);
        expect(cmds).toHaveLength(0);
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

    it('네이티브 truncated(줄 수 상한 미달)는 한도 중단 안내로 노출된다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: ['a.ts:1:foo'], truncated: true }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const out = text(await grep.handler({ pattern: 'foo' }));
        expect(out).toContain('a.ts:1:foo');
        expect(out).toContain('한도(시간·파일 수·파일당 매치 수)에서 중단되어 결과가 일부입니다');
        expect(out).not.toContain('줄에서 잘림');
    });

    it('줄 수가 max 에 닿은 잘림은 기존 "N줄에서 잘림" 안내다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: ['a.ts:1:foo', 'a.ts:2:foo'], truncated: true }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const out = text(await grep.handler({ pattern: 'foo', max_results: 2 }));
        expect(out).toContain('2줄에서 잘림');
        expect(out).not.toContain('결과가 일부입니다');
    });

    it('네이티브 무일치 + truncated 는 중단 안내를 붙이고 무일치 진단을 돌리지 않는다', async () => {
        const { sandbox, specs, cmds } = nativeSandbox(() => ({ matches: [], truncated: true }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: '(a+)+$' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('(일치 없음: (a+)+$');
        expect(text(r)).toContain('검색이 한도(시간·파일 수)에서 중단되어 전체를 확인하지 못했습니다');
        expect(specs).toHaveLength(1);
        expect(cmds).toHaveLength(0);
    });

    it('grep_code: 요청 오류(error)는 문구 그대로 오류로 돌려주고 셸을 부르지 않는다', async () => {
        const msg = '정규식 판정이 너무 깊어 중단했습니다 (역추적 한도 초과) — 패턴을 단순하게 바꾸세요';
        const { sandbox, cmds } = nativeSandbox(() => ({ error: msg }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: '((a?){9999}){9999}' });
        expect(r.isError).toBe(true);
        expect(text(r)).toBe(msg);
        expect(cmds).toHaveLength(0);
        expect((sandbox as unknown as { exec: jest.Mock }).exec).not.toHaveBeenCalled();
    });

    it('repo_map: files 요청 오류는 오류로 끝내고 셸 find 로 내려가지 않는다', async () => {
        const { sandbox, cmds, specs } = nativeSandbox(() => ({ error: '실행 폴더가 존재하지 않습니다: x' }));
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const r = await map.handler({});
        expect(r.isError).toBe(true);
        expect(text(r)).toBe('실행 폴더가 존재하지 않습니다: x');
        expect(cmds).toHaveLength(0);
        expect(specs.map((s) => s.op)).toEqual(['files']);
    });

    it('repo_map: 심볼 grep 만 요청 오류면 파일 절은 나오고 심볼 절만 빠진다(셸 없음)', async () => {
        const { sandbox, cmds } = nativeSandbox((spec) => spec.op === 'files'
            ? { files: [{ path: 'src/a.ts', lines: 12 }] }
            : { error: 'code_nav 시간 초과 (5s) — 범위를 좁히세요' });
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const r = await map.handler({});
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('src/a.ts (12)');
        expect(text(r)).not.toContain('## 심볼 선언');
        expect(cmds).toHaveLength(0);
    });

    it('repo_map: 심볼 grep 이 한도에서 멈춰 상한 미달이면 "N줄에서 잘림" 대신 한도 중단 안내', async () => {
        const { sandbox } = nativeSandbox((spec) => spec.op === 'files'
            ? { files: [{ path: 'src/a.ts', lines: 12 }] }
            : { matches: ['src/a.ts:1:export function foo() {'], truncated: true });
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const out = text(await map.handler({}));
        expect(out).toContain('src/a.ts:1:export function foo() {');
        expect(out).not.toContain('줄에서 잘림');
        expect(out).toContain('src/a.ts:1:export function foo() {\n… 검색이 한도(시간·파일 수·파일당 매치 수)에서 중단되어 결과가 일부입니다');
    });

    it('네이티브 무일치는 오류가 아니다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: [] }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'nothing' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('일치 없음');
    });
});

describe('민감 파일 제외 (2026-09-06)', () => {
    it('셸 폴백도 자격증명 파일을 인자로 제외한다 — 네이티브와 같은 목록', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec('src/a.ts:1:KEY'));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        await grep.handler({ pattern: 'KEY' });
        expect(cmds[0]).toContain("-g '!.env'");
        expect(cmds[0]).toContain("-g '!*.pem'");
        expect(cmds[0]).toContain("-g '!id_rsa'");
    });

    it('grep 폴백(--exclude)·find prune 에도 같은 목록이 들어간다', async () => {
        const { sandbox, cmds } = fakeSandbox((cmd) => cmd.startsWith('rg') ? exec('', 127, 'not found') : exec('x.ts:1:m'));
        await createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!.handler({ pattern: 'm' });
        expect(cmds[1]).toContain("--exclude='.env'");
        const { sandbox: sb2, cmds: cmds2 } = fakeSandbox(() => exec('1\t./x.ts'));
        await createCodeNavTools(sb2).find((t) => t.tool.name === 'repo_map')!.handler({ symbols: false });
        expect(cmds2[0]).toContain("-name '.env'");
        expect(cmds2[0]).toContain("-name '*.pem'");
    });

    it('건너뛴 파일이 있으면 결과 말미에 알린다 — "없음" 오판 방지', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: ['a.ts:1:KEY'], skipped: 2 }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const t = text(await grep.handler({ pattern: 'KEY' }));
        expect(t).toContain('자격증명 파일·폴더 2개는 정책상 검색에서 제외');
        expect(t).toContain('file_ops read');
    });

    it('무일치여도 건너뛴 것이 있으면 알린다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: [], skipped: 1 }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        expect(text(await grep.handler({ pattern: 'KEY' }))).toContain('정책상 검색에서 제외');
    });

    it('repo_map 도 건너뛴 수를 알린다', async () => {
        const { sandbox } = nativeSandbox((spec) => spec.op === 'files'
            ? { files: [{ path: 'src/a.ts', lines: 3 }], skipped: 1 }
            : { matches: [] });
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        expect(text(await map.handler({}))).toContain('자격증명 파일·폴더 1개');
    });

    it('셸 폴백도 sentinel 로 건너뛴 수를 세어 안내한다 — docker 기본 경로의 조용한 실패 방지(리뷰 지적)', async () => {
        const { sandbox, cmds } = fakeSandbox(() => exec('src/a.ts:1:KEY\n\n__OMK_SKIPPED__ 3\n'));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const t = text(await grep.handler({ pattern: 'KEY' }));
        expect(t).toContain('src/a.ts:1:KEY');
        expect(t).not.toContain('__OMK_SKIPPED__');
        expect(t).toContain('자격증명 파일·폴더 3개는 정책상 검색에서 제외');
        expect(cmds[0]).toContain("printf '\\n__OMK_SKIPPED__ %s\\n'");
        expect(cmds[0]).toContain("-name '.env'");
    });

    it('셸 폴백: 무일치 + 건너뛴 수만 있으면 안내가 붙고 오류가 아니다', async () => {
        const { sandbox } = fakeSandbox(() => exec('\n__OMK_SKIPPED__ 1\n'));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        const r = await grep.handler({ pattern: 'KEY' });
        expect(r.isError).toBeFalsy();
        expect(text(r)).toContain('일치 없음');
        expect(text(r)).toContain('정책상 검색에서 제외');
    });

    it('repo_map 셸 폴백도 sentinel 을 떼어내고 건너뛴 수를 안내한다', async () => {
        const { sandbox } = fakeSandbox((cmd) => cmd.startsWith('find') ? exec('3\t./src/a.ts\n\n__OMK_SKIPPED__ 2\n') : exec(''));
        const map = createCodeNavTools(sandbox).find((t) => t.tool.name === 'repo_map')!;
        const t = text(await map.handler({ symbols: false }));
        expect(t).toContain('src/a.ts (3)');
        expect(t).not.toContain('__OMK_SKIPPED__');
        expect(t).toContain('자격증명 파일·폴더 2개');
    });

    it('grep 폴백은 자격증명 이름을 디렉토리에도 적용한다(--exclude-dir)', async () => {
        const { sandbox, cmds } = fakeSandbox((cmd) => cmd.startsWith('rg') ? exec('', 127, 'rg: not found') : exec(''));
        await createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!.handler({ pattern: 'x' });
        expect(cmds[1]).toContain("--exclude-dir='credentials'");
    });

    it('rg 부재는 sentinel 때문에 종료코드가 0 이어도 stderr 로 판정해 grep 으로 폴백한다', async () => {
        const { sandbox, cmds } = fakeSandbox((cmd) => cmd.startsWith('rg')
            ? exec('\n__OMK_SKIPPED__ 0\n', 0, 'sh: 1: rg: not found')
            : exec('y.ts:2:x\n\n__OMK_SKIPPED__ 0\n'));
        const t = text(await createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!.handler({ pattern: 'x' }));
        expect(t).toContain('y.ts:2:x');
        expect(t).toContain('grep 사용');
        expect(cmds.length).toBe(2);
    });

    it('건너뛴 것이 없으면 안내를 붙이지 않는다', async () => {
        const { sandbox } = nativeSandbox(() => ({ matches: ['a.ts:1:x'] }));
        const grep = createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
        expect(text(await grep.handler({ pattern: 'x' }))).not.toContain('정책상');
    });
});

describe('grep_code 정규식 방언 — 도구 설명과 구문 오류 힌트', () => {
    const grepOf = (sandbox: TaskExecutor) => createCodeNavTools(sandbox).find((t) => t.tool.name === 'grep_code')!;
    const NATIVE_REGEX_ERROR = '정규식이 올바르지 않습니다: Invalid group modifier';
    const RG_PARSE_ERROR = 'rg: regex parse error:\n    (?<=a)b\n    ^^^^^^\nerror: look-around, including look-ahead and look-behind, is not supported';

    it('도구 설명은 한 엔진(rg)을 전제하지 않고 공통 문법만 안내한다', () => {
        const tool = grepOf(fakeSandbox(() => exec('')).sandbox).tool;
        const pattern = (tool.inputSchema.properties as Record<string, { description: string }>).pattern.description;
        expect(tool.description).not.toContain('ripgrep');
        expect(pattern).not.toContain('rg 문법');
        expect(pattern).toBe(GREP_CODE_PATTERN_DESCRIPTION);
        expect(pattern).toContain('공통 문법');
        expect(pattern).toContain('ignore_case');
        expect(pattern).toContain('(?i)');
        expect(pattern).not.toContain('\\d'); // GNU grep -E 는 \d 를 모른다(조용히 일치 없음)
    });

    it('네이티브 백엔드의 정규식 구문 오류에는 JavaScript 문법 힌트를 한 줄 덧붙인다(셸 없음)', async () => {
        const { sandbox, cmds } = nativeSandbox(() => ({ error: NATIVE_REGEX_ERROR }));
        const r = await grepOf(sandbox).handler({ pattern: '(?-u:a)' });
        expect(r.isError).toBe(true);
        expect(text(r)).toBe(`${NATIVE_REGEX_ERROR}\n${GREP_REGEX_DIALECT_HINTS.native}`);
        expect(GREP_REGEX_DIALECT_HINTS.native).toContain('JavaScript');
        expect(GREP_REGEX_DIALECT_HINTS.native.split('\n')).toHaveLength(1);
        expect(cmds).toHaveLength(0);
    });

    it('네이티브의 다른 요청 오류(역추적 한도 등)는 그대로 돌려준다', async () => {
        const msg = 'code_nav 시간 초과 (5s) — 범위를 좁히세요';
        const { sandbox } = nativeSandbox(() => ({ error: msg }));
        expect(text(await grepOf(sandbox).handler({ pattern: 'x' }))).toBe(msg);
    });

    it('rg 의 정규식 구문 오류(regex parse error)에는 rg 문법 힌트를 덧붙인다', async () => {
        const { sandbox } = fakeSandbox(() => exec('\n__OMK_SKIPPED__ 0\n', 0, RG_PARSE_ERROR));
        const r = await grepOf(sandbox).handler({ pattern: '(?<=a)b' });
        expect(r.isError).toBe(true);
        expect(text(r)).toContain('검색 실패: rg: regex parse error');
        expect(text(r).endsWith(`\n${GREP_REGEX_DIALECT_HINTS.rg}`)).toBe(true);
        expect(GREP_REGEX_DIALECT_HINTS.rg.split('\n')).toHaveLength(1);
    });

    it('rg 의 다른 실패와 grep -E 폴백의 오류에는 힌트를 붙이지 않는다', async () => {
        const other = fakeSandbox(() => exec('', 0, 'rg: ./x: Permission denied'));
        expect(text(await grepOf(other.sandbox).handler({ pattern: 'x' }))).toBe('검색 실패: rg: ./x: Permission denied');
        const viaGrep = fakeSandbox((cmd) => cmd.startsWith('rg') ? exec('', 127, 'rg: not found') : exec('', 0, 'grep: Unmatched ( or \\('));
        expect(text(await grepOf(viaGrep.sandbox).handler({ pattern: '(' }))).toBe('검색 실패: grep: Unmatched ( or \\(');
    });

    it('AGENT_TASK_GREP_DIALECT_HINT=false 면 오류 문구만 돌려준다', async () => {
        const cfg = GREP_DIALECT_HINT as { ENABLED: boolean };
        cfg.ENABLED = false;
        try {
            const { sandbox } = nativeSandbox(() => ({ error: NATIVE_REGEX_ERROR }));
            expect(text(await grepOf(sandbox).handler({ pattern: '(?i)a' }))).toBe(NATIVE_REGEX_ERROR);
            const rg = fakeSandbox(() => exec('', 0, RG_PARSE_ERROR));
            expect(text(await grepOf(rg.sandbox).handler({ pattern: '(?<=a)b' }))).toBe(`검색 실패: ${RG_PARSE_ERROR}`);
        } finally { cfg.ENABLED = true; }
    });
});
