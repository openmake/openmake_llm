/**
 * 테스트 러너 탐지 — 서버의 완료 관문(workspace-test-verify)이 "이 폴더에 돌릴 테스트가 있는가"를 물을 때 쓴다.
 *
 * 종전에는 서버가 탐지용 셸 한 줄을 exec 로 보내, 사용자가 시키지 않은 명령의 확인 창이 떴다.
 * 탐지는 읽기 전용이므로 lsp_diagnostics·code_nav 처럼 전용 kind 로 받아 확인 없이 처리한다 —
 * 서버 문자열을 실행하지 않고(파일 확인 + 고정 인자의 `python3 -c "import pytest"` 한 번), 테스트 실행 자체는
 * 종전대로 exec(사용자 확인)를 거친다.
 *
 * 조건은 서버 프로브(DETECT_PROBE)와 같다: npm → pytest → go 순, 러너를 설치하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { TEST_RUNNER_PROBE_TIMEOUT_MS } from './constants';
import { buildExecEnv } from './exec-env';

export type TestRunnerToken = 'npm' | 'pytest' | 'go' | 'none';

const exists = (p: string): boolean => { try { fs.accessSync(p); return true; } catch { return false; } };

function fileContains(p: string, needle: string): boolean {
    try { return fs.readFileSync(p, 'utf8').includes(needle); } catch { return false; }
}

/** scripts.test 가 있고 기본 자리표시자가 아니며, node_modules 가 있거나 런타임만으로 도는 `node …` 스크립트인가. */
function hasNpmTest(dir: string): boolean {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { scripts?: { test?: unknown } };
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

/** cwd 가 사용자 폴더라 그 안의 pytest.py·conftest 가 import 될 수 있다 — 자식 환경은 exec 와 같은 allowlist 로 제한한다. */
function canImportPytest(dir: string, execPath: string): Promise<boolean> {
    return new Promise((resolve) => {
        execFile('python3', ['-c', 'import pytest'],
            { cwd: dir, timeout: TEST_RUNNER_PROBE_TIMEOUT_MS, env: buildExecEnv(process.env, execPath) },
            (err) => resolve(!err));
    });
}

function onPath(bin: string, execPath: string): boolean {
    return execPath.split(':').filter(Boolean).some((d) => {
        try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true; } catch { return false; }
    });
}

/** dirAbs 는 호출측이 스코프를 확정한 절대경로, execPath 는 exec 와 같은 보강 PATH. */
export async function detectTestRunner(dirAbs: string, execPath: string): Promise<TestRunnerToken> {
    if (hasNpmTest(dirAbs)) return 'npm';
    if (hasPytestMarker(dirAbs) && await canImportPytest(dirAbs, execPath)) return 'pytest';
    if (exists(path.join(dirAbs, 'go.mod')) && onPath('go', execPath)) return 'go';
    return 'none';
}
