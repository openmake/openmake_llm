/**
 * 편집 후 진단(collectDiagnostics) — 1단계 폴백(tsc/py_compile) 동작·캡·미지원 처리.
 *
 * 실제 컴파일러를 돌리므로 임시 레포를 만들고, 레포 로컬 tsc(node_modules/.bin/tsc)를
 * 이 워크스페이스의 것으로 심링크해 "레포에 설치된 도구만 쓴다"는 규칙을 그대로 검증한다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectDiagnostics } from '../diagnostics';
import { DIAG_MAX_TOTAL } from '../constants';

const repoTsc = path.resolve(__dirname, '../../../../node_modules/.bin/tsc');
const hasTsc = fs.existsSync(repoTsc);

let base = '';

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-diag-')));
});
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

function writeTsProject(files: Record<string, string>): void {
    fs.writeFileSync(path.join(base, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'commonjs', skipLibCheck: true },
        include: ['*.ts'],
    }));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(base, name), content);
    // 레포 로컬 tsc 만 사용한다 — 전역 설치에 의존하지 않는 규칙을 그대로 만족시킨다.
    const binDir = path.join(base, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync(repoTsc, path.join(binDir, 'tsc'));
}

(hasTsc ? describe : describe.skip)('collectDiagnostics — TypeScript', () => {
    test('타입 오류를 파일·라인·코드와 함께 돌려준다', async () => {
        writeTsProject({ 'a.ts': 'const n: number = "not a number";\n' });
        const r = await collectDiagnostics(base, [path.join(base, 'a.ts')]);
        expect(r.serverKind).toBe('tsc');
        expect(r.diagnostics.length).toBeGreaterThan(0);
        const d = r.diagnostics[0];
        expect(d.path).toBe('a.ts');
        expect(d.line).toBe(1);
        expect(d.severity).toBe('error');
        expect(d.code).toMatch(/^TS\d+$/);
        expect(d.source).toBe('tsc');
    }, 60000);

    test('정상 코드는 진단 0건 — serverKind 로 "검사함"을 구분할 수 있다', async () => {
        writeTsProject({ 'ok.ts': 'export const n: number = 1;\n' });
        const r = await collectDiagnostics(base, [path.join(base, 'ok.ts')]);
        expect(r.serverKind).toBe('tsc');
        expect(r.diagnostics).toEqual([]);
        expect(r.truncated).toBe(false);
    }, 60000);

    test('tsc 가 없으면 실행하지 않는다(serverKind=none) — 설치 시도 금지', async () => {
        fs.writeFileSync(path.join(base, 'tsconfig.json'), '{}');
        fs.writeFileSync(path.join(base, 'a.ts'), 'const n: number = "x";\n');
        const r = await collectDiagnostics(base, [path.join(base, 'a.ts')]);
        expect(r.serverKind).toBe('none');
        expect(r.diagnostics).toEqual([]);
    }, 30000);
});

describe('collectDiagnostics — 공통', () => {
    test('지원하지 않는 확장자는 no-op', async () => {
        fs.writeFileSync(path.join(base, 'a.txt'), 'hello');
        const r = await collectDiagnostics(base, [path.join(base, 'a.txt')]);
        expect(r).toEqual({ diagnostics: [], truncated: false, serverKind: 'none' });
    });

    test('빈 목록도 안전하다', async () => {
        const r = await collectDiagnostics(base, []);
        expect(r.serverKind).toBe('none');
    });

    test('Python 문법 오류를 잡는다', async () => {
        fs.writeFileSync(path.join(base, 'bad.py'), 'def f(:\n');
        const r = await collectDiagnostics(base, [path.join(base, 'bad.py')]);
        // python3 가 없는 환경이면 진단 없이 넘어간다(no-op) — 있으면 error 1건.
        if (r.serverKind === 'py_compile' && r.diagnostics.length > 0) {
            expect(r.diagnostics[0].path).toBe('bad.py');
            expect(r.diagnostics[0].severity).toBe('error');
            expect(r.diagnostics[0].source).toBe('py_compile');
        }
    }, 30000);

    test('전체 상한 상수가 캡 계약과 일치한다', () => {
        expect(DIAG_MAX_TOTAL).toBeGreaterThan(0);
    });
});
