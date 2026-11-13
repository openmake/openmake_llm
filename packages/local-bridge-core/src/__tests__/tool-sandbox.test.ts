/**
 * 확인 없이 처리하는 도구(test_runner 탐지·lsp_diagnostics)가 띄우는 자식도 exec 와 같은 샌드박스 안에서 돈다.
 *
 * 결함(2026-11-13 재현): `python3 -c`·`-m` 은 cwd 를 모듈 검색 맨 앞에 둔다 — 연결 폴더에 `pytest.py`(+`conftest.py`)를
 * 두면 pytest 탐지가, `py_compile.py` 를 두면 .py 진단이 그 코드를 실행했다. tsc 는 폴더의 `node_modules/.bin/tsc` 다.
 * 에이전트는 폴더에 파일을 쓸 수 있으므로 확인·차단 목록·샌드박스를 모두 거치지 않는 실행 경로였다.
 *
 * "폴더 밖" 대상은 실제 홈(`os.userInfo().homedir` — HOME 환경 변수와 무관) 아래 임시 폴더다. 프로파일이 늘 여는
 * 임시·캐시 경로 밖이라, 검증 스크립트가 HOME 을 임시 폴더로 바꿔도(캐시 허용 구역이 그쪽으로 옮겨 간다) 탈출 단언이 성립한다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import { collectDiagnostics } from '../diagnostics';
import { writeSandboxProfile } from '../sandbox';
import { detectTestRunner } from '../test-runner';
import type { BridgeMsg, BridgeResult } from '../types';

const repoTsc = path.resolve(__dirname, '../../../../node_modules/.bin/tsc');
const PYTEST_PROBE = "import importlib.util,site,sys; sys.path.append(site.getusersitepackages()); sys.exit(0 if importlib.util.find_spec('pytest') else 1)";

let base = '';
let outside = '';
let prof = '';

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-toolsb-')));
    outside = fs.mkdtempSync(path.join(fs.realpathSync(os.userInfo().homedir), '.omk-toolsb-out-'));
    prof = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-toolsb-prof-'));
});
afterEach(() => {
    for (const d of [base, outside, prof]) fs.rmSync(d, { recursive: true, force: true });
});

const write = (rel: string, content: string, mode?: number): string => {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    if (mode !== undefined) fs.chmodSync(p, mode);
    return p;
};

function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve, reject) => { core.handleExec(m, resolve).catch(reject); });
}

function makeCore(): BridgeCore {
    return new BridgeCore({ folder: base, confirm: async () => 'no', sandboxProfileDir: prof });
}

/** 탈출 단언 — 감싼 자식이 폴더 밖(outside)에 쓰지 못했다. */
function expectNoEscape(name: string): void {
    expect(fs.existsSync(path.join(outside, name))).toBe(false);
}

const coreProfile = (): string => {
    const files = fs.readdirSync(prof);
    expect(files).toHaveLength(1);
    return path.join(prof, files[0]);
};

const sbDescribe = SANDBOX_ENABLED ? describe : describe.skip;

sbDescribe('도구 자식 샌드박스 — 폴더의 코드가 샌드박스 밖에서 돌지 않는다(코어, 실제 python3·tsc 자리)', () => {
    it('test_runner: 폴더의 pytest.py(+conftest.py) 가 실행되지 않는다', async () => {
        write('conftest.py', '');
        write('pytest.py', `open(${JSON.stringify(path.join(outside, 'pytest-ran'))}, 'w').write('x')\nopen(${JSON.stringify(path.join(base, 'pytest-ran-inside'))}, 'w').write('x')\n`);
        const core = makeCore();
        core.prepare();
        const r = await run(core, { kind: 'test_runner', path: '.' });
        expect(r.ok).toBe(true);
        // 폴더의 pytest.py 는 import 되지 않는다(-I + find_spec) — 폴더 안 흔적도 없어야 한다.
        expect(fs.existsSync(path.join(base, 'pytest-ran-inside'))).toBe(false);
        expectNoEscape('pytest-ran');
    }, 30000);

    it('lsp_diagnostics: 폴더의 py_compile.py 가 실행되지 않는다(.py 진단)', async () => {
        write('py_compile.py', `open(${JSON.stringify(path.join(outside, 'pyc-ran'))}, 'w').write('x')\nopen(${JSON.stringify(path.join(base, 'pyc-ran-inside'))}, 'w').write('x')\n`);
        write('a.py', 'x = 1\n');
        const core = makeCore();
        core.prepare();
        const r = await run(core, { kind: 'lsp_diagnostics', paths: ['a.py'] });
        expect(r).toMatchObject({ ok: true, serverKind: 'py_compile' });
        expect(fs.existsSync(path.join(base, 'pyc-ran-inside'))).toBe(false);
        expectNoEscape('pyc-ran');
    }, 30000);

    it('lsp_diagnostics: 폴더의 node_modules/.bin/tsc 는 샌드박스 안에서 돈다(폴더 안 쓰기 O, 폴더 밖 쓰기 X)', async () => {
        write('tsconfig.json', '{}');
        write('a.ts', 'export const n = 1;\n');
        write('node_modules/.bin/tsc',
            `#!/bin/sh\necho x > ${JSON.stringify(path.join(base, 'tsc-ran-inside'))}\necho x > ${JSON.stringify(path.join(outside, 'tsc-ran'))}\nexit 0\n`, 0o755);
        const core = makeCore();
        core.prepare();
        const r = await run(core, { kind: 'lsp_diagnostics', paths: ['a.ts'] });
        expect(r).toMatchObject({ ok: true, serverKind: 'tsc' });
        expect(fs.existsSync(path.join(base, 'tsc-ran-inside'))).toBe(true); // 돌기는 돈다
        expectNoEscape('tsc-ran');
    }, 30000);
});

sbDescribe('도구 자식 샌드박스 — 프로파일이 없으면 자식을 띄워야 할 때만 거부(fail-closed)', () => {
    const refused = { ok: false, exitCode: 126 };

    it('test_runner: pytest 표식이 있어 python3 를 띄워야 하면 거부, npm 으로 끝나면 그대로 답한다', async () => {
        const core = makeCore(); // prepare() 미호출 — 프로파일 없음
        write('conftest.py', '');
        const r = await run(core, { kind: 'test_runner', path: '.' });
        expect(r).toMatchObject(refused);
        expect(r.error).toBe('exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 실행하세요.');
        write('package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
        expect(await run(core, { kind: 'test_runner', path: '.' })).toMatchObject({ ok: true, testRunner: 'npm' });
    });

    it('lsp_diagnostics: .py·tsc 는 거부, 검사할 도구가 없으면 그대로 답한다', async () => {
        const core = makeCore();
        write('a.py', 'x = 1\n');
        write('b.txt', 'x');
        write('c.ts', 'export const n = 1;\n'); // tsconfig·tsc 없음 → 띄우지 않는다
        const py = await run(core, { kind: 'lsp_diagnostics', paths: ['a.py'] });
        expect(py).toMatchObject(refused);
        expect(py.error).toContain('샌드박스 프로파일');
        expect(await run(core, { kind: 'lsp_diagnostics', paths: ['b.txt', 'c.ts'] }))
            .toMatchObject({ ok: true, diagnostics: [], serverKind: 'none' });
        write('tsconfig.json', '{}');
        write('node_modules/.bin/tsc', '#!/bin/sh\nexit 0\n', 0o755);
        expect(await run(core, { kind: 'lsp_diagnostics', paths: ['c.ts'] })).toMatchObject(refused);
    });

    it('OMK_BRIDGE_SANDBOX=0 이면 감싸지 않고 거부하지도 않는다(종전 동작)', async () => {
        const saved = process.env.OMK_BRIDGE_SANDBOX;
        process.env.OMK_BRIDGE_SANDBOX = '0';
        try {
            let Core!: typeof BridgeCore;
            jest.isolateModules(() => { Core = (require('../core') as typeof import('../core')).BridgeCore; });
            const core = new Core({ folder: base, confirm: async () => 'no', sandboxProfileDir: prof });
            write('a.py', 'x = 1\n');
            expect(await run(core, { kind: 'lsp_diagnostics', paths: ['a.py'] })).toMatchObject({ ok: true, serverKind: 'py_compile' });
        } finally {
            if (saved === undefined) delete process.env.OMK_BRIDGE_SANDBOX; else process.env.OMK_BRIDGE_SANDBOX = saved;
        }
    }, 30000);
});

sbDescribe('도구 자식 샌드박스 — sandbox-exec 자체가 실패하면 "진단 없음/none" 으로 삼키지 않고 거절한다', () => {
    const MISSING = 'exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 실행하세요.';
    /** 준비는 됐지만 프로파일 **파일**이 사라진 코어(경로 문자열은 남아 있다 — 임시 폴더 정리 등). */
    function coreWithLostProfile(): BridgeCore {
        const core = makeCore();
        core.prepare();
        fs.rmSync(coreProfile());
        return core;
    }

    it('lsp_diagnostics(.py): 거절', async () => {
        write('a.py', 'def f(:\n');
        expect(await run(coreWithLostProfile(), { kind: 'lsp_diagnostics', paths: ['a.py'] }))
            .toEqual({ ok: false, error: MISSING, exitCode: 126 });
    }, 30000);

    it('lsp_diagnostics(tsc): 거절', async () => {
        write('tsconfig.json', '{}');
        write('a.ts', 'export const n = 1;\n');
        write('node_modules/.bin/tsc', '#!/bin/sh\necho "a.ts(1,1): error TS1000: x"\nexit 1\n', 0o755);
        expect(await run(coreWithLostProfile(), { kind: 'lsp_diagnostics', paths: ['a.ts'] }))
            .toEqual({ ok: false, error: MISSING, exitCode: 126 });
    }, 30000);

    it('test_runner(pytest 탐지): 거절', async () => {
        write('conftest.py', '');
        expect(await run(coreWithLostProfile(), { kind: 'test_runner', path: '.' }))
            .toEqual({ ok: false, error: MISSING, exitCode: 126 });
    }, 30000);

    it('python3 가 PATH 에 없으면 거절이 아니라 종전대로 "띄우지 못함"(sandbox-exec 의 execvp 실패와 섞지 않는다)', async () => {
        const p = writeSandboxProfile(base, null, path.join(prof, 'p.sb')) as string;
        const f = write('a.py', 'def f(:\n');
        write('conftest.py', '');
        expect(await detectTestRunner(base, '/nonexistent-omk-path', p)).toBe('none');
        expect(await collectDiagnostics(base, [f], '/nonexistent-omk-path', p))
            .toEqual({ diagnostics: [], truncated: false, serverKind: 'py_compile' });
    }, 30000);
});

sbDescribe('도구 자식 샌드박스 — 모듈 단위(가짜 python3 로 인자·감싸기 확인)', () => {
    /** 인자를 폴더 안에 남기고, 폴더 밖에도 쓰려 하는 가짜 python3. */
    function fakePython(exitCode = 0): string {
        const bin = path.join(base, '.fakebin');
        write('.fakebin/python3',
            `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(path.join(base, 'py-args'))}\necho x > ${JSON.stringify(path.join(outside, 'py-ran'))}\nexit ${exitCode}\n`, 0o755);
        return bin;
    }
    const args = (): string[] => fs.readFileSync(path.join(base, 'py-args'), 'utf8').split('\n').slice(0, -1);
    const profile = (): string => {
        const p = writeSandboxProfile(base, null, path.join(prof, 'p.sb'));
        expect(p).not.toBeNull();
        return p as string;
    };

    it('pytest 탐지: python3 -I -c "<find_spec>" 를 샌드박스 안에서 띄운다', async () => {
        write('conftest.py', '');
        const p = profile();
        expect(await detectTestRunner(base, fakePython(), p)).toBe('pytest');
        expect(args()).toEqual(['-I', '-c', PYTEST_PROBE]);
        expectNoEscape('py-ran');
    });

    it('py_compile 진단: python3 -I -m py_compile <파일> 을 샌드박스 안에서 띄운다', async () => {
        const f = write('a.py', 'x = 1\n');
        const p = profile();
        const r = await collectDiagnostics(base, [f], fakePython(), p);
        expect(r).toEqual({ diagnostics: [], truncated: false, serverKind: 'py_compile' });
        expect(args()).toEqual(['-I', '-m', 'py_compile', f]);
        expectNoEscape('py-ran');
    });

    it('샌드박스를 넘기지 않으면(꺼짐) 감싸지 않는다 — 인자 강화는 그대로', async () => {
        write('conftest.py', '');
        expect(await detectTestRunner(base, fakePython())).toBe('pytest');
        expect(args()).toEqual(['-I', '-c', PYTEST_PROBE]);
    });

    it('실제 python3: 폴더의 pytest.py 는 실행되지 않고, 사용자 site 의 pytest 는 샌드박스 안에서 찾는다', async () => {
        write('conftest.py', '');
        write('pytest.py', `open(${JSON.stringify(path.join(base, 'pytest-ran-inside'))}, 'w').write('x')\nopen(${JSON.stringify(path.join(outside, 'pytest-ran'))}, 'w').write('x')\n`);
        const execPath = process.env.PATH ?? '';
        // 이 환경의 사용자 site 에 pytest 가 있는가(pip --user — macOS 시스템 python3 의 보통 경우). 호스트에서 위치만 본다.
        let userPytest = false;
        try {
            const usp = execFileSync('python3', ['-I', '-c', 'import site; print(site.getusersitepackages())'],
                { encoding: 'utf8', env: { PATH: execPath, HOME: process.env.HOME ?? '' } }).trim();
            userPytest = !!usp && fs.existsSync(path.join(usp, 'pytest'));
        } catch { /* python3 없음 */ }
        const p = profile();
        const got = await detectTestRunner(base, execPath, p);
        expect(fs.existsSync(path.join(base, 'pytest-ran-inside'))).toBe(false);
        expectNoEscape('pytest-ran');
        if (userPytest) expect(got).toBe('pytest');
        else console.warn('사용자 site 에 pytest 가 없어 "pytest 로 탐지" 단언을 건너뜀');
    }, 30000);

    it('실제 python3: 샌드박스 안 py_compile 이 문법 오류를 잡는다', async () => {
        const f = write('bad.py', 'def f(:\n');
        const r = await collectDiagnostics(base, [f], undefined, profile());
        if (r.serverKind === 'py_compile' && r.diagnostics.length > 0) {
            expect(r.diagnostics[0]).toMatchObject({ path: 'bad.py', line: 1, severity: 'error', source: 'py_compile' });
        } else {
            throw new Error(`python3 py_compile 이 샌드박스 안에서 진단을 내지 못함: ${JSON.stringify(r)}`);
        }
    }, 30000);

    (fs.existsSync(repoTsc) ? it : it.skip)('실제 tsc: 샌드박스 안에서도 타입 오류를 그대로 낸다', async () => {
        write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true }, include: ['*.ts'] }));
        const f = write('a.ts', 'const n: number = "x";\n');
        fs.mkdirSync(path.join(base, 'node_modules', '.bin'), { recursive: true });
        fs.symlinkSync(repoTsc, path.join(base, 'node_modules', '.bin', 'tsc'));
        const plain = await collectDiagnostics(base, [f]);
        const boxed = await collectDiagnostics(base, [f], undefined, profile());
        expect(boxed.serverKind).toBe('tsc');
        expect(boxed.diagnostics.length).toBeGreaterThan(0);
        expect(boxed).toEqual(plain);
    }, 60000);
});
