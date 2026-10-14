/**
 * 입력 첨부 디스크 스토어(upload-store) — ROOT 는 모듈 로드 시 AGENT_TASK_LIMITS.UPLOAD_ROOT 로 정해진다.
 * 테스트마다 mkdtemp 로 루트를 만들고 runtime-limits 를 mock 한 뒤 jest.isolateModules 로 새로 불러온다.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

let mockUploadRoot = '';
jest.mock('../../../config/runtime-limits', () => ({
    get AGENT_TASK_LIMITS() { return { UPLOAD_ROOT: mockUploadRoot }; },
}));
const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (m: string) => warn(m), error: jest.fn() }),
}));

type Store = typeof import('../upload-store');
let store: Store;
let root: string;
let scratch: string;

beforeEach(async () => {
    jest.clearAllMocks();
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-store-test-'));
    root = path.join(scratch, 'root');
    mockUploadRoot = root;
    jest.isolateModules(() => { store = require('../upload-store') as Store; });
});

afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
});

const exists = (p: string) => fs.access(p).then(() => true, () => false);
async function tmpFile(name: string, body = 'data'): Promise<string> {
    const dir = await store.ensureUploadTmpDir();
    const p = path.join(dir, name);
    await fs.writeFile(p, body);
    return p;
}

describe('ROOT·tmp 디렉터리', () => {
    it('UPLOAD_TMP_DIR 은 <UPLOAD_ROOT>/tmp, ensureUploadTmpDir 가 만들고 경로를 돌려준다', async () => {
        expect(store.UPLOAD_TMP_DIR).toBe(path.join(root, 'tmp'));
        expect(await exists(store.UPLOAD_TMP_DIR)).toBe(false);
        await expect(store.ensureUploadTmpDir()).resolves.toBe(path.join(root, 'tmp'));
        expect((await fs.stat(store.UPLOAD_TMP_DIR)).isDirectory()).toBe(true);
        await expect(store.ensureUploadTmpDir()).resolves.toBe(store.UPLOAD_TMP_DIR); // 두 번째도 성공
    });

    it('상대 경로 UPLOAD_ROOT 는 절대 경로로 바꾼다', () => {
        mockUploadRoot = 'rel/uploads';
        let rel!: Store;
        jest.isolateModules(() => { rel = require('../upload-store') as Store; });
        expect(rel.UPLOAD_TMP_DIR).toBe(path.join(path.resolve('rel/uploads'), 'tmp'));
    });
});

describe('safeBaseName', () => {
    it.each([
        ['a/b/c.txt', 'c.txt'],
        ['a\\b\\c.txt', 'c.txt'],
        ['../../etc/passwd', 'passwd'],
        ['C:\\Users\\me\\보고서.pdf', '보고서.pdf'],
        ['x\u0000y\n.txt', 'x_y_.txt'],
        ['tab\there', 'tab_here'],
        ['\u007fdel', '_del'],
        ['  spaced.txt  ', 'spaced.txt'],
        ['한글 파일.hwp', '한글 파일.hwp'],
    ])('%p → %p', (input, expected) => {
        expect(store.safeBaseName(input, 'fb')).toBe(expected);
    });

    it.each(['', '   ', 'dir/', 'a\\', '/'])('빈 이름 %p 은 fallback', (input) => {
        expect(store.safeBaseName(input, 'file_3')).toBe('file_3');
    });

    it('제어문자만 있는 이름은 비지 않으므로 _ 로 남는다', () => {
        expect(store.safeBaseName('\u0001', 'fb')).toBe('_');
    });

    it('앞뒤 제어문자(\\n)는 trim 전에 _ 로 바뀌어 남는다', () => {
        expect(store.safeBaseName('\nname\n', 'fb')).toBe('_name_');
    });

    it('길이는 자르지 않는다(현재 규칙)', () => {
        const long = 'a'.repeat(400) + '.txt';
        expect(store.safeBaseName(long, 'fb')).toBe(long);
    });
});

describe('finalizeUploadedFile', () => {
    it('tmp 파일을 <root>/<taskId>/<index>_<이름> 으로 옮기고 상대 경로를 돌려준다', async () => {
        const tmp = await tmpFile('multer-abc', 'hello');
        const stored = await store.finalizeUploadedFile('task-1', tmp, 'docs/report.pdf', 0);
        expect(stored).toBe(path.join('task-1', '0_report.pdf'));
        expect(path.isAbsolute(stored)).toBe(false);
        expect(await fs.readFile(path.join(root, stored), 'utf8')).toBe('hello');
        expect(await exists(tmp)).toBe(false);
    });

    it('이름이 비면 file_<index> 로 저장한다', async () => {
        const tmp = await tmpFile('multer-x');
        await expect(store.finalizeUploadedFile('task-1', tmp, '', 4)).resolves.toBe(path.join('task-1', '4_file_4'));
    });

    it('경로 성분이 든 이름도 task 디렉터리 밖으로 나가지 않는다', async () => {
        const tmp = await tmpFile('multer-y', 'z');
        const stored = await store.finalizeUploadedFile('task-2', tmp, '../../../outside.txt', 1);
        expect(stored).toBe(path.join('task-2', '1_outside.txt'));
        expect(await exists(path.join(scratch, 'outside.txt'))).toBe(false);
        expect(await fs.readFile(store.resolveStoredPath(stored), 'utf8')).toBe('z');
    });

    it('같은 task 에 여러 파일 — index 로 구분되어 같은 이름도 덮어쓰지 않는다', async () => {
        const a = await store.finalizeUploadedFile('t', await tmpFile('m1', 'A'), 'same.txt', 0);
        const b = await store.finalizeUploadedFile('t', await tmpFile('m2', 'B'), 'same.txt', 1);
        expect(a).not.toBe(b);
        expect(await fs.readFile(path.join(root, a), 'utf8')).toBe('A');
        expect(await fs.readFile(path.join(root, b), 'utf8')).toBe('B');
    });

    it('tmp 파일이 없으면 reject 한다', async () => {
        await expect(store.finalizeUploadedFile('t', path.join(root, 'tmp', 'missing'), 'a.txt', 0)).rejects.toThrow(/ENOENT/);
    });

    // (고침) 결함: safeBaseName 이 길이를 자르지 않아, 이름이 파일 시스템 한도(대개 255바이트)를 넘으면 rename 이 ENAMETOOLONG 으로
    // 실패해 task 생성(routes/agent-task.routes.ts multipart 경로)·청크 claim 이 깨진다. 한글은 1자 3바이트라 86자면 넘는다.
    // 재현: finalizeUploadedFile('t', <tmp>, '가'.repeat(90) + '.pdf', 0) → ENAMETOOLONG
    it('[결함] 파일 시스템 한도를 넘는 긴 이름도 잘라서 저장한다', async () => {
        const tmp = await tmpFile('m-long');
        const stored = await store.finalizeUploadedFile('t', tmp, '가'.repeat(90) + '.pdf', 0);
        expect(Buffer.byteLength(path.basename(stored))).toBeLessThanOrEqual(255);
        // 접두(0_) 를 뺀 이름은 200바이트 이하, 확장자 유지, UTF-8 경계에서 잘려 깨진 문자(U+FFFD)가 없다.
        const name = path.basename(stored).slice('0_'.length);
        expect(Buffer.byteLength(name)).toBeLessThanOrEqual(200);
        expect(name).toBe('가'.repeat(65) + '.pdf');
        expect(name).not.toContain('\uFFFD');
        expect(await fs.readFile(path.join(root, stored), 'utf8')).toBe('data');
    });

    it('확장자 자체가 상한을 넘으면 이름 전체를 200바이트로 자른다', async () => {
        const stored = await store.finalizeUploadedFile('t', await tmpFile('m-ext'), 'a.' + 'b'.repeat(300), 0);
        expect(path.basename(stored)).toBe('0_a.' + 'b'.repeat(198));
    });

    it('200바이트 이하 이름은 그대로 둔다', async () => {
        const name = 'a'.repeat(196) + '.txt';
        await expect(store.finalizeUploadedFile('t', await tmpFile('m-200'), name, 0)).resolves.toBe(path.join('t', `0_${name}`));
    });
});

describe('resolveStoredPath', () => {
    it('상대 storedPath 를 루트 아래 절대 경로로 바꾼다', () => {
        expect(store.resolveStoredPath(path.join('task-1', '0_a.txt'))).toBe(path.join(root, 'task-1', '0_a.txt'));
    });

    it('루트 안에서 정규화되는 .. 는 허용한다', () => {
        expect(store.resolveStoredPath('task-1/../task-2/x')).toBe(path.join(root, 'task-2', 'x'));
    });

    it('빈 경로는 루트 자신이다', () => {
        expect(store.resolveStoredPath('')).toBe(root);
    });

    it.each([
        ['../escape.txt'],
        ['task-1/../../escape.txt'],
        ['../../../../etc/passwd'],
        ['/etc/passwd'],
    ])('루트 밖으로 나가는 %p 는 거부한다', (p) => {
        expect(() => store.resolveStoredPath(p)).toThrow(`잘못된 저장 경로: ${p}`);
    });

    it('루트 이름을 접두사로 공유하는 형제 디렉터리(root-evil)는 거부한다', () => {
        expect(() => store.resolveStoredPath('../root-evil/x')).toThrow(/잘못된 저장 경로/);
        expect(() => store.resolveStoredPath(path.join(root + '-evil', 'x'))).toThrow(/잘못된 저장 경로/);
    });

    it('루트 안의 절대 경로는 허용한다', () => {
        const abs = path.join(root, 't', 'f');
        expect(store.resolveStoredPath(abs)).toBe(abs);
    });
});

describe('discardTmpFiles', () => {
    it('있는 파일은 지우고 없는 파일은 무시한다', async () => {
        const a = await tmpFile('a');
        const b = await tmpFile('b');
        await expect(store.discardTmpFiles([a, path.join(root, 'tmp', 'nope'), b])).resolves.toBeUndefined();
        expect(await exists(a)).toBe(false);
        expect(await exists(b)).toBe(false);
    });

    it('빈 목록은 아무것도 하지 않는다', async () => {
        await expect(store.discardTmpFiles([])).resolves.toBeUndefined();
    });

    it('디렉터리처럼 unlink 할 수 없는 경로도 throw 하지 않고 다음 파일을 계속 지운다', async () => {
        const dir = await store.ensureUploadTmpDir();
        const after = await tmpFile('after');
        await expect(store.discardTmpFiles([dir, after])).resolves.toBeUndefined();
        expect(await exists(dir)).toBe(true);
        expect(await exists(after)).toBe(false);
    });
});

describe('removeTaskFiles', () => {
    it('task 디렉터리를 통째로 지우고 다른 task 는 남긴다', async () => {
        await store.finalizeUploadedFile('t1', await tmpFile('m1'), 'a.txt', 0);
        await store.finalizeUploadedFile('t1', await tmpFile('m2'), 'b.txt', 1);
        await store.finalizeUploadedFile('t2', await tmpFile('m3'), 'c.txt', 0);
        await store.removeTaskFiles('t1');
        expect(await exists(path.join(root, 't1'))).toBe(false);
        expect(await exists(path.join(root, 't2', '0_c.txt'))).toBe(true);
    });

    it('없는 task 는 조용히 넘어간다', async () => {
        await expect(store.removeTaskFiles('never-existed')).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    // root 로 돌면 권한 검사가 없어 실패를 만들 수 없다.
    (process.getuid?.() === 0 ? it.skip : it)('지우기 실패(루트 쓰기 금지 → EACCES)는 throw 하지 않고 경고만 남긴다', async () => {
        await store.finalizeUploadedFile('t9', await tmpFile('m9'), 'a.txt', 0);
        await fs.chmod(root, 0o555);
        try {
            await expect(store.removeTaskFiles('t9')).resolves.toBeUndefined();
        } finally {
            await fs.chmod(root, 0o755); // afterEach 정리가 지울 수 있게
        }
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('t9');
        expect(warn.mock.calls[0][0]).toMatch(/EACCES|EPERM/);
    });
});
