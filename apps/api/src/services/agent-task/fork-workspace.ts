/**
 * fork 작업 공간 복원 — 턴 체크포인트마다 작업 공간을 git ref 로 남기고, 갈라져 나온 작업이 그 시점의 파일로 시작한다.
 *
 * 종전 fork 는 대화·계획만 복원해 작업 디렉토리가 비어 있었다(routes/agent-task-fork.routes). 탐색 분기에는 파일 상태가
 * 필요하다(StateFork, arXiv 2609.38648).
 *
 * - 스냅숏: 코드 diff 용 기준점(.git, code-diff.initWorkspaceBaseline)이 있는 작업 공간에서 HEAD 를 옮기지 않고
 *   현재 상태를 `refs/omk/turn-N` 으로 남긴다. HEAD 를 옮기면 완료 시 diff(기준점 대비)가 비게 된다.
 * - 복원: 새 작업의 작업 공간에 기준점이 아직 없을 때(첫 실행) 한 번만, 원 작업의 그 턴 ref 를 풀어 넣는다.
 *   원 작업 공간이 이미 지워졌거나(실패·취소 종료, 보존 TTL 경과) ref 가 없으면 빈 작업 공간으로 진행한다.
 *
 * 전부 fail-open 이고 docker 샌드박스(호스트 작업 공간이 있는 실행기)에서만 동작한다.
 * 켜고 끄는 것은 AGENT_TASK_LIMITS.FORK_WORKSPACE_RESTORE_ENABLED (기본 OFF).
 *
 * @module services/agent-task/fork-workspace
 */
import { join } from 'path';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getTaskSandboxConfig } from '../../config/task-sandbox';
import { sanitizeId } from '../task-sandbox/sandbox';
import { restoreWorkspaceSnapshot } from '../task-sandbox/snapshot-restore';
import type { TaskRuntime } from '../task-sandbox/runtime';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/** code-diff 와 같은 git 공통 옵션(bind-mount 소유자 차이·커밋 identity). */
const GIT = 'git -c safe.directory=/workspace -c user.email=agent@openmake.local -c user.name=openmake-agent';

/** PURE: 턴 스냅숏 ref — 첫 턴 도중의 체크포인트(턴 -1)는 `pre`. */
export function turnSnapshotRef(turn: number): string {
    return `refs/omk/turn-${turn < 0 ? 'pre' : turn}`;
}

/** 현재 작업 공간을 턴 ref 로 남긴다 — 기준점(.git)이 있을 때만, HEAD 는 그대로. */
export async function snapshotWorkspaceTurn(runtime: TaskRuntime, turn: number): Promise<void> {
    if (!AGENT_TASK_LIMITS.FORK_WORKSPACE_RESTORE_ENABLED || runtime.localWorkdir === null) return;
    try {
        const r = await runtime.execRaw(
            `[ -d .git ] && ${GIT} add -A && t=$(${GIT} write-tree) && c=$(${GIT} commit-tree "$t" -p HEAD -m turn-${turn}) && ${GIT} update-ref ${turnSnapshotRef(turn)} "$c"`,
        );
        if (r.exitCode !== 0) logger.debug(`[AgentTask] 턴 스냅숏 건너뜀 (turn ${turn}): ${r.stderr || r.stdout}`);
    } catch (e) {
        logger.warn(`[AgentTask] 턴 스냅숏 실패 (무시): ${e instanceof Error ? e.message : e}`);
    }
}

/** fork 출처 — agent_tasks 의 forked_from_* 열(141). */
export interface ForkOrigin { forked_from_task_id?: string | null; forked_from_turn?: number | null }

/**
 * 갈라져 나온 작업의 작업 공간 복원 — 기준점이 아직 없는 첫 실행에서만. 복원했으면 true.
 * 기준점 생성(initWorkspaceBaseline) **전에** 불러야 복원된 파일이 기준점에 들어가 이 작업의 diff 가 자기 변경분만 담는다.
 */
export async function restoreForkedWorkspace(runtime: TaskRuntime, origin: ForkOrigin | undefined): Promise<boolean> {
    if (!AGENT_TASK_LIMITS.FORK_WORKSPACE_RESTORE_ENABLED || runtime.localWorkdir === null) return false;
    const srcTaskId = origin?.forked_from_task_id;
    const turn = origin?.forked_from_turn;
    if (!srcTaskId || turn === null || turn === undefined) return false;
    try {
        const probe = await runtime.execRaw('[ -d .git ] && echo has-git');
        if (probe.stdout.includes('has-git')) return false;
        const cfg = getTaskSandboxConfig();
        const restored = await restoreWorkspaceSnapshot(join(cfg.workspaceRoot, sanitizeId(srcTaskId)), runtime.workspacePath, turnSnapshotRef(turn), cfg);
        logger.info(`[AgentTask] fork 작업 공간 ${restored ? '복원' : '복원 안 함(원 작업 공간·스냅숏 없음)'}: ${srcTaskId}@${turn}`);
        return restored;
    } catch (e) {
        logger.warn(`[AgentTask] fork 작업 공간 복원 실패 (무시): ${e instanceof Error ? e.message : e}`);
        return false;
    }
}
