/**
 * 테스트 러너 탐지 — 서버의 완료 관문(workspace-test-verify)이 "이 폴더에 돌릴 테스트가 있는가"를 물을 때 쓴다.
 *
 * 종전에는 서버가 탐지용 셸 한 줄을 exec 로 보내, 사용자가 시키지 않은 명령의 확인 창이 떴다.
 * 탐지는 읽기 전용이므로 lsp_diagnostics·code_nav 처럼 전용 kind 로 받아 확인 없이 처리한다 —
 * 서버 문자열을 실행하지 않고(파일 확인 + 고정 인자의 pytest 탐지 `python3 -I -c …` 한 번), 테스트 실행 자체는
 * 종전대로 exec(사용자 확인)를 거친다.
 *
 * 조건은 서버 프로브(DETECT_PROBE)와 같다: npm → pytest → go 순, 러너를 설치하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { MAX_BUFFER, TEST_RUNNER_PROBE_TIMEOUT_MS } from './constants';
import { buildExecEnv } from './exec-env';
import { onPath } from './exec-path';
import { readRegularFile } from './git-trust';
import { SandboxProfileMissingError, sandboxExecFailed, wrapInSandbox } from './sandbox';

export type TestRunnerToken = 'npm' | 'pytest' | 'go' | 'none';

const exists = (p: string): boolean => { try { fs.accessSync(p); return true; } catch { return false; } };

/**
 * 표식 파일 읽기 — 코어가 샌드박스 밖에서 동기로 읽으므로 일반 파일만·MAX_BUFFER 이하만 읽는다(FIFO 면 이벤트 루프가 멈췄다,
 * 리뷰 R5). 그 밖(심링크·FIFO·큰 파일·없음)은 "표식 없음"이다.
 */
const readMarker = (p: string): string | null => readRegularFile(p, MAX_BUFFER);

function fileContains(p: string, needle: string): boolean {
    return readMarker(p)?.includes(needle) ?? false;
}

/** scripts.test 가 있고 기본 자리표시자가 아니며, node_modules 가 있거나 런타임만으로 도는 `node …` 스크립트인가. */
function hasNpmTest(dir: string): boolean {
    try {
        const pkg = JSON.parse(readMarker(path.join(dir, 'package.json')) ?? '') as { scripts?: { test?: unknown } };
        const script = typeof pkg.scripts?.test === 'string' ? pkg.scripts.test : '';
        return !!script && !/no test specified/.test(script) && (exists(path.join(dir, 'node_modules')) || /^node\b/.test(script));
    } catch { return false; }
}

function hasPytestMarker(dir: string): boolean {
    const at = (name: string): string => path.join(dir, name);
    if (exists(at('pytest.ini')) || exists(at('conftest.py'))) return true;
    if (fileContains(at('pyproject.toml'), 'tool.pytest') || fileContains(at('setup.cfg'), 'tool:pytest')) return true;
    try {
        if (fs.statSync(at('tests')).isDirectory()) return true;
    } catch { /* tests 없음 */ }
    try { return fs.readdirSync(dir).some((n) => /^test_.*\.py$/.test(n)); } catch { return false; }
}

/**
 * pytest 가 설치돼 있는가 — import 하지 않고 find_spec 으로 찾기만 한다(모듈을 실행하지 않는다). cwd 가 사용자 폴더라
 * `-c` 는 그 폴더를 모듈 검색 맨 앞에 둔다 — `-I`(격리 모드)로 cwd·PYTHON* 환경을 빼, 폴더의 pytest.py 를 찾지도
 * 실행하지도 않는다. `-I` 는 사용자 site 도 빼므로(pip --user 로만 깐 pytest — macOS 시스템 python3 의 보통 경우)
 * 그 경로만 찾는 대상으로 뒤에 더한다(`.pth` 처리·import 없음 — find_spec 은 위치만 찾는다).
 * 자식은 도구 프로파일(exec 프로파일 + 네트워크 차단) 안에서, 환경은 exec 와 같은 allowlist 로 띄운다.
 */
const PYTEST_PROBE = "import importlib.util,site,sys; sys.path.append(site.getusersitepackages()); sys.exit(0 if importlib.util.find_spec('pytest') else 1)";

function canImportPytest(dir: string, execPath: string, sandbox: string | null | undefined): Promise<boolean> {
    const cmd = wrapInSandbox('python3', ['-I', '-c', PYTEST_PROBE], sandbox); // 프로파일 없음이면 throw — 띄우지 않는다
    const wrapped = typeof sandbox === 'string';
    // 감쌀 때는 python3 를 먼저 찾는다 — 없으면 sandbox-exec 의 execvp 실패(71)가 아니라 종전대로 "못 찾음"이다.
    if (wrapped && !onPath('python3', execPath)) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
        execFile(cmd.file, cmd.args,
            { cwd: dir, timeout: TEST_RUNNER_PROBE_TIMEOUT_MS, env: buildExecEnv(process.env, execPath) },
            (err, _stdout, stderr) => {
                // sandbox-exec 자체 실패(프로파일 파일 유실 등)는 "없음"으로 삼키지 않고 프로파일 없음과 같이 거절한다.
                if (err && sandboxExecFailed(wrapped, err.code, String(stderr ?? ''))) reject(new SandboxProfileMissingError());
                else resolve(!err);
            });
    });
}

/**
 * dirAbs 는 호출측이 스코프를 확정한 절대경로, execPath 는 exec 와 같은 보강 PATH.
 * sandbox 는 python3 를 감쌀 도구 프로파일 — undefined 면 감싸지 않고, null 이면 python3 를 띄워야 할 때 거절한다.
 */
export async function detectTestRunner(dirAbs: string, execPath: string, sandbox?: string | null): Promise<TestRunnerToken> {
    if (hasNpmTest(dirAbs)) return 'npm';
    if (hasPytestMarker(dirAbs) && await canImportPytest(dirAbs, execPath, sandbox)) return 'pytest';
    if (exists(path.join(dirAbs, 'go.mod')) && onPath('go', execPath)) return 'go';
    return 'none';
}
