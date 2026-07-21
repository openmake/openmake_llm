/**
 * 코드 작업 diff 캡처 (openmake_code v1) — workspace git baseline + 완료 시 변경분 diff.
 *
 * 실행 시작 시(입력 첨부 기록 후) workspace 를 baseline 커밋으로 스냅샷하고, 작업 완료 시
 * 에이전트가 만든 변경분만 `git diff` 로 캡처해 step_type='diff' 스텝으로 영속화한다.
 * git 은 task-runtime 이미지에 상시 설치되어 있으며, 모든 호출은 컨테이너 내부 execRaw
 * (승인 게이트 비대상 — 에이전트 도구 호출이 아닌 시스템 산출물 기록)로 수행한다.
 *
 * 모두 fail-open: git 실패는 작업을 실패시키지 않는다 (diff 는 부가 산출물).
 *
 * @module services/agent-task/code-diff
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import type { TaskRuntime } from '../task-sandbox/runtime';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/**
 * git 공통 옵션 — bind-mount workspace 는 호스트 uid 소유라 컨테이너 uid 와 다를 수 있어
 * safe.directory 필수. 커밋 identity 는 전역 config 없이 인라인(-c) 지정(루트 read-only).
 */
const GIT = 'git -c safe.directory=/workspace -c user.email=agent@openmake.local -c user.name=openmake-agent';

/**
 * workspace 를 git baseline 으로 스냅샷 — 멱등: .git 이 이미 있으면 아무것도 하지 않는다.
 * (resume 재진입 시 이전 실행의 에이전트 변경분이 baseline 에 흡수되어 diff 에서 사라지는
 * 것을 막는다.) 입력 첨부(uploads/) 기록 후에 호출해 첨부가 baseline 에 포함되게 한다.
 */
export async function initWorkspaceBaseline(runtime: TaskRuntime): Promise<void> {
    try {
        const r = await runtime.execRaw(
            `[ -d .git ] || { ${GIT} init -q && ${GIT} add -A && ${GIT} commit -q --allow-empty -m baseline; }`,
        );
        if (r.exitCode !== 0) {
            logger.warn(`[AgentTask] git baseline 실패 (${runtime.workspacePath}): ${r.stderr || r.stdout}`);
        }
    } catch (e) {
        logger.warn(`[AgentTask] git baseline 실패: ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * baseline 이후 에이전트 변경분 diff 캡처 — 신규 파일 포함(add -A 후 --cached).
 * 변경 없음/git 미초기화/실패는 null (diff 스텝 미기록). 출력 캡은 sandbox exec 공통
 * outputCap 이 적용되며, 잘린 경우 말미에 표식을 덧붙인다.
 */
export async function captureWorkspaceDiff(runtime: TaskRuntime): Promise<string | null> {
    try {
        const r = await runtime.execRaw(
            `[ -d .git ] && ${GIT} add -A && ${GIT} diff --cached --no-color`,
        );
        if (r.exitCode !== 0) return null;
        const diff = r.stdout.trim();
        if (!diff) return null;
        return r.truncated ? `${diff}\n...[diff 가 길어 잘렸습니다]` : diff;
    } catch (e) {
        logger.warn(`[AgentTask] diff 캡처 실패: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}

/**
 * 완료 직전 diff 캡처+영속+WS 발행 일괄 처리 — AgentTaskService 의 3개 completed 경로 공용.
 * 샌드박스 없음/기능 OFF/빈 diff 는 no-op 으로 stepNumber 그대로 반환.
 */
export async function maybePersistCodeDiff(
    runtime: TaskRuntime | null,
    cfg: { codeDiffEnabled: boolean },
    taskId: string,
    stepNumber: number,
    emit: (stepType: string, toolName?: string, content?: string | null) => void,
): Promise<number> {
    if (!runtime || !cfg.codeDiffEnabled) return stepNumber;
    const diff = await captureWorkspaceDiff(runtime);
    if (!diff) return stepNumber;
    const next = await persistDiffStep(taskId, diff, stepNumber);
    emit('diff', 'git_diff', diff);
    return next;
}

/**
 * diff 를 step_type='diff' 스텝으로 영속화 — 프론트 상세가 +/− 색상으로 렌더.
 * 저장 실패는 작업을 실패시키지 않는다 (persistArtifactSteps 와 동일 계약).
 */
export async function persistDiffStep(taskId: string, diff: string, stepNumber: number): Promise<number> {
    try {
        await getUnifiedDatabase().addAgentTaskStep({
            taskId,
            stepNumber: stepNumber++,
            stepType: 'diff',
            toolName: 'git_diff',
            content: diff,
        });
    } catch (e) {
        logger.warn(`[AgentTask] diff 스텝 저장 실패: ${taskId} — ${e}`);
    }
    return stepNumber;
}
