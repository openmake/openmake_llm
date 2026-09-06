/**
 * code_nav — 읽기 전용 코드 탐색(grep_code·repo_map 백엔드)의 디바이스측 계약.
 *
 * 핵심 불변식: ① confirmExec 를 거치지 않는다(읽기 전용) ② 제외 디렉토리·심링크·바이너리를
 * 건너뛴다 ③ 경로는 연결 폴더 스코프 밖으로 나가지 못한다 ④ 결과는 캡으로 잘린다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BridgeCore } from '../core';
import { globToRegExp, runCodeNav, walkFiles } from '../code-nav';
import type { BridgeResult } from '../types';

let root: string;
let confirmCalls = 0;

function mk(rel: string, body = ''): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
}

function core(): BridgeCore {
    const c = new BridgeCore({
        folder: root,
        confirm: async () => { confirmCalls++; return 'no'; },
        sandboxProfileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'omk-sb-')),
    });
    c.prepare();
    return c;
}

const run = (c: BridgeCore, msg: Record<string, unknown>): Promise<BridgeResult> =>
    new Promise((resolve) => { void c.handleExec({ kind: 'code_nav', ...msg }, resolve); });

beforeEach(() => {
    confirmCalls = 0;
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-codenav-')));
    mk('src/util.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    mk('src/util.test.ts', "import { add } from './util';\ntest('add', () => add(1, 2));\n");
    mk('lib/thing.py', 'def bar():\n    return 1\n');
    mk('node_modules/junk/index.js', 'function hidden() {}\n');
    mk('dist/bundle.js', 'function hidden() {}\n');
    mk('README.md', '# 문서\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('code_nav kind', () => {
    it('grep 은 승인(confirmExec) 없이 매치 줄을 돌려준다', async () => {
        const r = await run(core(), { op: 'grep', pattern: 'function|def ' });
        expect(r.ok).toBe(true);
        expect(confirmCalls).toBe(0);           // 읽기 전용 — 승인 창이 뜨면 안 된다
        expect(r.codeNav?.matches).toEqual(expect.arrayContaining([
            'src/util.ts:1:export function add(a: number, b: number) {',
            'lib/thing.py:1:def bar():',
        ]));
    });

    it('node_modules·dist 등 제외 디렉토리는 훑지 않는다', async () => {
        const r = await run(core(), { op: 'grep', pattern: 'hidden' });
        expect(r.codeNav?.matches).toEqual([]);
    });

    it('glob 은 "/" 가 없으면 파일명에만 적용된다', async () => {
        const r = await run(core(), { op: 'grep', pattern: 'add', glob: '*.test.ts' });
        expect(r.codeNav?.matches?.every((m) => m.startsWith('src/util.test.ts:'))).toBe(true);
        expect(r.codeNav?.matches?.length).toBeGreaterThan(0);
    });

    it('ignoreCase 를 지원한다', async () => {
        expect((await run(core(), { op: 'grep', pattern: 'EXPORT FUNCTION' })).codeNav?.matches).toEqual([]);
        expect((await run(core(), { op: 'grep', pattern: 'EXPORT FUNCTION', ignoreCase: true })).codeNav?.matches?.length).toBe(1);
    });

    it('maxResults 를 넘기면 잘리고 truncated 로 알린다', async () => {
        mk('many.txt', Array.from({ length: 50 }, (_, i) => `hit ${i}`).join('\n'));
        const r = await run(core(), { op: 'grep', pattern: 'hit', maxResults: 3 });
        expect(r.codeNav?.matches?.length).toBe(3);
        expect(r.codeNav?.truncated).toBe(true);
    });

    it('files 는 파일별 줄 수를 돌려준다(내용 없음)', async () => {
        const r = await run(core(), { op: 'files' });
        const f = r.codeNav?.files ?? [];
        expect(f.find((x) => x.path === 'src/util.ts')?.lines).toBe(3);
        expect(f.find((x) => x.path === 'lib/thing.py')?.lines).toBe(2);
        expect(f.some((x) => x.path.startsWith('node_modules/'))).toBe(false);
        expect(JSON.stringify(f)).not.toContain('return a + b');
    });

    it('제외 이름은 파일이어도 건너뛴다 — worktree 의 .git 은 디렉토리가 아니라 파일이다', async () => {
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
        const r = await run(core(), { op: 'files' });
        expect(r.codeNav?.files?.some((f) => f.path === '.git')).toBe(false);
        const g = await run(core(), { op: 'grep', pattern: 'gitdir' });
        expect(g.codeNav?.matches).toEqual([]);
    });

    it('바이너리 파일은 grep 대상에서 제외한다', async () => {
        fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]));
        const r = await run(core(), { op: 'grep', pattern: 'hi' });
        expect(r.codeNav?.matches?.some((m) => m.startsWith('blob.bin'))).toBe(false);
    });

    it('path 로 하위 폴더만 좁힐 수 있다', async () => {
        const r = await run(core(), { op: 'grep', pattern: 'a', path: 'lib' });
        expect(r.codeNav?.matches?.every((m) => m.startsWith('lib/'))).toBe(true);
    });

    it('폴더 밖 경로는 거부한다(스코프 강제)', async () => {
        await expect(core().handleExec({ kind: 'code_nav', op: 'grep', pattern: 'x', path: '../..' }, () => { /* noop */ }))
            .rejects.toThrow(/스코프/);
    });

    it('심링크는 따라가지 않는다', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-outside-'));
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOPSECRET\n');
        fs.symlinkSync(outside, path.join(root, 'linked'));
        const r = await run(core(), { op: 'grep', pattern: 'TOPSECRET' });
        expect(r.codeNav?.matches).toEqual([]);
        fs.rmSync(outside, { recursive: true, force: true });
    });

    it('알 수 없는 op·잘못된 정규식은 오류로 해소한다', async () => {
        await expect(runCodeNav(root, root, { op: 'delete' })).rejects.toThrow(/지원하지 않는/);
        await expect(runCodeNav(root, root, { op: 'grep', pattern: '(' })).rejects.toThrow(/정규식/);
        await expect(runCodeNav(root, root, { op: 'grep', pattern: '  ' })).rejects.toThrow(/pattern/);
        await expect(runCodeNav(root, root, { op: 'grep', pattern: 'x'.repeat(600) })).rejects.toThrow(/너무 깁니다/);
    });
});

describe('walkFiles / globToRegExp', () => {
    it('파일 경로를 주면 그 파일만 대상이 된다', async () => {
        const w = await walkFiles(root, path.join(root, 'README.md'), Date.now() + 5000);
        expect(w.files).toEqual(['README.md']);
    });

    it('데드라인이 지나면 truncated 로 끝낸다', async () => {
        const w = await walkFiles(root, root, Date.now() - 1);
        expect(w.truncated).toBe(true);
    });

    it('글롭 변환 — ** 는 경로 전체, * 는 한 세그먼트', () => {
        expect(globToRegExp('*.ts').basenameOnly).toBe(true);
        expect(globToRegExp('*.ts').re.test('util.ts')).toBe(true);
        expect(globToRegExp('src/**/*.py').basenameOnly).toBe(false);
        expect(globToRegExp('src/**/*.py').re.test('src/a/b/x.py')).toBe(true);
        expect(globToRegExp('src/*.py').re.test('src/a/x.py')).toBe(false);
    });
});
