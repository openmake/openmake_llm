/**
 * fork 작업 공간 복원 — 턴 체크포인트마다 작업 공간을 git ref 로 남기고, 갈라져 나온 작업이 그 시점 파일로 시작한다.
 * 가짜 TaskRuntime(execRaw 스텁)과 가짜 복원 함수로 명령·가드·fail-open 을 검증한다.
 */
const restoreWorkspaceSnapshot = jest.fn();
jest.mock('../../task-sandbox/snapshot-restore', () => ({
    restoreWorkspaceSnapshot: (...a: unknown[]) => restoreWorkspaceSnapshot(...a),
}));
jest.mock('../../../config/task-sandbox', () => ({
    ...jest.requireActual('../../../config/task-sandbox'),
    getTaskSandboxConfig: () => ({ workspaceRoot: '/tmp/ws', image: 'img', dockerPath: 'docker', user: '1000:1000' }),
}));

import { snapshotWorkspaceTurn, restoreForkedWorkspace, turnSnapshotRef } from '../fork-workspace';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import type { TaskRuntime } from '../../task-sandbox/runtime';

const ok = (stdout = '') => ({ stdout, stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1 });
const runtime = (execRaw: jest.Mock, localWorkdir: string | null = '/tmp/ws/new1') =>
    ({ execRaw, localWorkdir, workspacePath: localWorkdir ?? '' } as unknown as TaskRuntime);

beforeEach(() => { jest.restoreAllMocks(); restoreWorkspaceSnapshot.mockReset(); });
const enable = () => jest.replaceProperty(AGENT_TASK_LIMITS, 'FORK_WORKSPACE_RESTORE_ENABLED', true);

describe('turnSnapshotRef', () => {
    it('턴마다 다른 ref — 첫 턴 도중 체크포인트(-1)도 유효한 이름', () => {
        expect(turnSnapshotRef(3)).toBe('refs/omk/turn-3');
        expect(turnSnapshotRef(-1)).toBe('refs/omk/turn-pre');
    });
});

describe('snapshotWorkspaceTurn', () => {
    it('HEAD 를 옮기지 않고 현재 작업 공간을 턴 ref 로 남긴다', async () => {
        enable();
        const execRaw = jest.fn().mockResolvedValue(ok());
        await snapshotWorkspaceTurn(runtime(execRaw), 2);
        const cmd = execRaw.mock.calls[0][0] as string;
        expect(cmd).toContain('[ -d .git ] &&');
        expect(cmd).toContain('write-tree');
        expect(cmd).toContain('commit-tree');
        expect(cmd).toContain('update-ref refs/omk/turn-2');
        expect(cmd).not.toMatch(/ commit -/); // HEAD 를 옮기면 완료 시 diff(baseline 대비)가 비게 된다
    });

    it('꺼져 있으면(기본) 아무것도 하지 않는다', async () => {
        const execRaw = jest.fn();
        await snapshotWorkspaceTurn(runtime(execRaw), 2);
        expect(execRaw).not.toHaveBeenCalled();
    });

    it('호스트 작업 공간이 없는 실행기(로컬 브리지)는 건너뛴다', async () => {
        enable();
        const execRaw = jest.fn();
        await snapshotWorkspaceTurn(runtime(execRaw, null), 2);
        expect(execRaw).not.toHaveBeenCalled();
    });

    it('exec 실패는 던지지 않는다(fail-open)', async () => {
        enable();
        await expect(snapshotWorkspaceTurn(runtime(jest.fn().mockRejectedValue(new Error('docker down'))), 2)).resolves.toBeUndefined();
    });
});

describe('restoreForkedWorkspace', () => {
    const origin = { forked_from_task_id: 'src-task', forked_from_turn: 2 };

    it('갈라져 나온 작업의 빈 작업 공간에 원 작업의 그 턴 스냅숏을 복원한다', async () => {
        enable();
        restoreWorkspaceSnapshot.mockResolvedValue(true);
        const execRaw = jest.fn().mockResolvedValue(ok('')); // .git 없음
        expect(await restoreForkedWorkspace(runtime(execRaw), origin)).toBe(true);
        expect(restoreWorkspaceSnapshot).toHaveBeenCalledWith('/tmp/ws/src-task', '/tmp/ws/new1', 'refs/omk/turn-2', expect.anything());
    });

    it('이미 기준점(.git)이 있는 작업 공간은 건드리지 않는다 — 재개 때 다시 덮어쓰지 않게', async () => {
        enable();
        const execRaw = jest.fn().mockResolvedValue(ok('has-git'));
        expect(await restoreForkedWorkspace(runtime(execRaw), origin)).toBe(false);
        expect(restoreWorkspaceSnapshot).not.toHaveBeenCalled();
    });

    it('fork 가 아닌 작업, 꺼진 플래그, 호스트 작업 공간 없는 실행기는 복원하지 않는다', async () => {
        const execRaw = jest.fn().mockResolvedValue(ok(''));
        expect(await restoreForkedWorkspace(runtime(execRaw), origin)).toBe(false); // 플래그 OFF
        enable();
        expect(await restoreForkedWorkspace(runtime(execRaw), { forked_from_task_id: null, forked_from_turn: null })).toBe(false);
        expect(await restoreForkedWorkspace(runtime(execRaw), undefined)).toBe(false);
        expect(await restoreForkedWorkspace(runtime(execRaw, null), origin)).toBe(false);
        expect(restoreWorkspaceSnapshot).not.toHaveBeenCalled();
    });

    it('원 작업 id 는 경로로 쓰기 전에 정리한다(경로 탈출 차단)', async () => {
        enable();
        restoreWorkspaceSnapshot.mockResolvedValue(true);
        await restoreForkedWorkspace(runtime(jest.fn().mockResolvedValue(ok(''))), { forked_from_task_id: '../../etc', forked_from_turn: 0 });
        expect(restoreWorkspaceSnapshot.mock.calls[0][0]).toBe('/tmp/ws/.._.._etc');
    });

    it('복원 실패는 던지지 않고 false (fail-open — 빈 작업 공간으로 진행)', async () => {
        enable();
        restoreWorkspaceSnapshot.mockRejectedValue(new Error('docker down'));
        expect(await restoreForkedWorkspace(runtime(jest.fn().mockResolvedValue(ok(''))), origin)).toBe(false);
    });
});
