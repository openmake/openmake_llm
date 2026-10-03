/**
 * 작업 공간 스냅숏 복원 — 원 작업 공간의 git ref 를 풀어 새 작업 공간에 쓴다(fork 작업 공간 복원, agent-task/fork-workspace).
 *
 * @module services/task-sandbox/snapshot-restore
 */
import { stat } from 'fs/promises';
import { join } from 'path';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import { SANDBOX_WORKSPACE_DIR } from './workspace-path';
import { runProcess } from './sandbox';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TaskSandbox');
const WORKSPACE = SANDBOX_WORKSPACE_DIR;

/** 스냅숏 ref 이름 — 셸에 그대로 들어가므로 git ref 문자만 허용한다. */
const SNAPSHOT_REF_RE = /^refs\/[A-Za-z0-9._/-]+$/;

/**
 * PURE: 작업 공간 스냅숏 복원용 일회성 컨테이너 `docker run --rm` 인자 (유닛테스트 대상).
 * 원 작업 공간(srcHostWorkdir)의 git ref 를 풀어 새 작업 공간(dstHostWorkdir)에 쓴다 — fork 작업 공간 복원.
 * 원 작업 공간은 읽기 전용으로 붙이고, 네트워크·권한은 메인 샌드박스와 같은 수준으로 잠근다.
 * 호스트에 git 이 없어도 되도록 task-runtime 이미지의 git 을 쓴다. tar 는 /tmp(tmpfs)에 만들었다가 푼다
 * (파이프로 이으면 archive 실패가 tar 의 종료 코드에 가려진다).
 */
export function buildSnapshotRestoreArgs(
    srcHostWorkdir: string,
    dstHostWorkdir: string,
    ref: string,
    cfg: TaskSandboxConfig,
): string[] {
    if (!SNAPSHOT_REF_RE.test(ref)) throw new Error(`스냅숏 ref 형식이 아닙니다: ${ref}`);
    const a: string[] = ['run', '--rm', '--init'];
    a.push('--network', 'none');
    a.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
    a.push('--pids-limit', String(cfg.pidsLimit), '--memory', cfg.memory, '--memory-swap', cfg.memory, '--cpus', cfg.cpus);
    a.push('--user', cfg.user);
    a.push('--read-only', '--tmpfs', '/tmp:rw,exec');
    a.push('-v', `${srcHostWorkdir}:/src:ro`, '-v', `${dstHostWorkdir}:${WORKSPACE}:rw`);
    a.push('-w', WORKSPACE);
    a.push(cfg.image, 'sh', '-c',
        `git --git-dir=/src/.git -c safe.directory='*' archive -o /tmp/snapshot.tar ${ref} && tar -xf /tmp/snapshot.tar -C ${WORKSPACE}`);
    return a;
}

/**
 * 원 작업 공간의 스냅숏 ref 를 새 작업 공간에 복원한다. 원 작업 공간이나 그 기준점(.git)이 없으면 false,
 * 컨테이너가 실패(ref 없음 등)해도 false — 호출부는 빈 작업 공간으로 진행한다.
 */
export async function restoreWorkspaceSnapshot(
    srcHostWorkdir: string,
    dstHostWorkdir: string,
    ref: string,
    cfg: TaskSandboxConfig,
): Promise<boolean> {
    try { await stat(join(srcHostWorkdir, '.git')); } catch { return false; }
    const r = await runProcess(cfg.dockerPath, buildSnapshotRestoreArgs(srcHostWorkdir, dstHostWorkdir, ref, cfg),
        { timeoutMs: cfg.execTimeoutMs, outputCap: 8192 });
    if (r.exitCode !== 0) logger.info(`작업 공간 스냅숏 복원 안 됨 (${ref}): ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    return r.exitCode === 0;
}
