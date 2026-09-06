/**
 * Agent Task workspace 테스트 게이트 (2026-09-06).
 *
 * 완료 관문(finalize)에서 workspace 에 **이미 있는** 테스트 러너를 감지하면 1회 실행하고, 실패하면
 * 출력 끝부분을 주입해 수정 턴을 준다. deliverable-verify(아티팩트 문법 검사)와 같은 원칙 —
 * 실행 grounding 이 self-critique 보다 값싸고 정확하다 — 를 **레포 작업**으로 넓힌 것이다.
 * 30일 실측: 작업 70건 중 55건이 파일을 편집했지만 bash 로 테스트를 돈 것은 2건뿐이었다.
 *
 * 설계 원칙:
 *  - 러너를 설치하지 않는다(LSP 진단과 같은 규칙, 컨테이너는 network none). 감지 조건은
 *    npm(package.json scripts.test + node_modules) · pytest(설정/tests + import 가능) · go(go.mod + go).
 *  - 러너가 없으면 `ran=false` 로 조용히 통과 — 리포트형 작업(운영 대부분)에는 영향이 0 이다.
 *  - 파일을 편집한 작업에만 적용(usedTools 에 쓰기 도구). 읽기만 한 작업의 테스트 실패는 그 작업 탓이 아니다.
 *  - 전 구간 fail-open: 감지·실행 인프라 오류는 통과(ok=true). 실패는 러너 exit≠0 뿐이다.
 *  - 코드를 실제로 실행한다 — 컨테이너는 격리(network none·자원 캡)이고, 로컬 브리지에선 exec 가
 *    디바이스 confirmExec 를 거친다.
 *
 * @module services/agent-task/workspace-test-verify
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import type { TaskRuntime } from '../task-sandbox/runtime';

const logger = createLogger('AgentTaskService');

/** 파일을 바꾸는 도구 — 이 중 하나라도 썼을 때만 게이트가 적용된다. */
export const WRITE_TOOL_NAMES: readonly string[] = ['str_replace_editor', 'file_ops', 'bash', 'python_execute', 'skill_run'];

export type TestRunner = 'npm' | 'pytest' | 'go';

/** 러너별 실행 명령 — CI=1 로 watch 모드·대화형 프롬프트를 막는다. */
export const RUNNER_COMMANDS: Record<TestRunner, string> = {
    npm: 'CI=1 npm test --silent 2>&1',
    pytest: 'python3 -m pytest -q -x --no-header -p no:cacheprovider 2>&1',
    go: 'go test ./... 2>&1',
};

/**
 * 감지 프로브 — POSIX sh 한 번으로 러너 토큰을 출력한다(로컬 브리지 macOS 호환: GNU 전용 옵션 없음).
 * npm: scripts.test 가 있고 기본 자리표시자("no test specified")가 아니며, node_modules 가 있거나 `node …` 스크립트여야 한다.
 * pytest: 설정 파일 또는 tests 디렉토리/루트의 test_*.py 가 있고 pytest 가 import 돼야 한다.
 */
export const DETECT_PROBE = [
    // node_modules 가 없어도 `node --test` 처럼 런타임만으로 도는 스크립트는 허용한다.
    'if [ -f package.json ] && node -e \'const s=(require("./package.json").scripts||{}).test||"";const ok=s&&!/no test specified/.test(s)&&(require("fs").existsSync("node_modules")||/^node\\b/.test(s));process.exit(ok?0:1)\' 2>/dev/null; then echo npm; exit 0; fi',
    'if { [ -f pytest.ini ] || [ -f conftest.py ] || { [ -f pyproject.toml ] && grep -q "tool.pytest" pyproject.toml; } || { [ -f setup.cfg ] && grep -q "tool:pytest" setup.cfg; } || [ -d tests ] || ls test_*.py >/dev/null 2>&1; } && python3 -c "import pytest" 2>/dev/null; then echo pytest; exit 0; fi',
    'if [ -f go.mod ] && command -v go >/dev/null 2>&1; then echo go; exit 0; fi',
    'echo none',
].join('; ');

export interface WorkspaceTestResult {
    /** 러너를 감지해 실제로 실행했는지. */
    ran: boolean;
    /** 실행하지 않았거나 통과했으면 true. */
    ok: boolean;
    runner?: TestRunner;
    /** 실패 시 모델에 주입할 출력(끝부분). */
    report: string;
}

export function hasWriteTool(usedTools: ReadonlySet<string>): boolean {
    return WRITE_TOOL_NAMES.some((t) => usedTools.has(t));
}

export async function detectWorkspaceTestRunner(runtime: TaskRuntime): Promise<TestRunner | null> {
    const r = await runtime.execRaw(DETECT_PROBE);
    const token = r.stdout.trim().split('\n').pop()?.trim();
    return token === 'npm' || token === 'pytest' || token === 'go' ? token : null;
}

/** 출력 끝부분 우선 절단 — 실패 요약(FAIL/Error/N failed)은 보통 마지막에 있다. */
export function tailReport(output: string, maxChars: number): string {
    const t = output.trim();
    return t.length > maxChars ? `…(앞 ${t.length - maxChars}자 생략)\n${t.slice(-maxChars)}` : t;
}

/**
 * 테스트 게이트 본체 — 절대 throw 하지 않는다. 결과는 `test_verify` 스텝으로 남긴다(관측, fail-open).
 */
export async function verifyWorkspaceTests(
    runtime: TaskRuntime,
    taskId: string,
    usedTools: ReadonlySet<string>,
    stepNumber: number,
    signal?: AbortSignal,
): Promise<WorkspaceTestResult & { stepNumber: number }> {
    const skip = { ran: false, ok: true, report: '', stepNumber };
    try {
        if (signal?.aborted || !hasWriteTool(usedTools)) return skip;
        const runner = await detectWorkspaceTestRunner(runtime);
        if (!runner) return skip;
        const r = await runtime.execRaw(RUNNER_COMMANDS[runner]);
        const failed = r.exitCode !== 0 || r.timedOut;
        const output = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`;
        const report = failed
            ? tailReport(`${output}\n[exit=${r.exitCode}${r.timedOut ? ' TIMEOUT' : ''}]`, AGENT_TASK_LIMITS.WORKSPACE_TEST_REPORT_MAX_CHARS)
            : '';
        logger.info(`[TestGate] ${taskId}: ${runner} ${failed ? '실패' : '통과'} (exit=${r.exitCode}, ${r.durationMs}ms)`);
        let next = stepNumber;
        try {
            await getUnifiedDatabase().addAgentTaskStep({
                taskId, stepNumber: next, stepType: 'test_verify', toolName: runner,
                content: failed
                    ? `테스트 게이트: ${runner} 실패 (exit=${r.exitCode}) — 수정 턴 부여\n${report}`
                    : `테스트 게이트: ${runner} 통과 (${r.durationMs}ms)\n${tailReport(output, 600)}`,
            });
            next++;
        } catch (e) {
            logger.debug(`[TestGate] 스텝 기록 실패(무시): ${e instanceof Error ? e.message : e}`);
        }
        return { ran: true, ok: !failed, runner, report, stepNumber: next };
    } catch (e) {
        logger.warn(`[TestGate] 게이트 실패 — fail-open: ${e instanceof Error ? e.message : e}`);
        return skip;
    }
}
