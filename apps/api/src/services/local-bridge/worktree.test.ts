/**
 * RemoteExecutor worktree 격리 라우팅 테스트.
 *
 * 로컬 실행기는 사용자 머신에서 직접 파일을 만지므로, 격리가 걸린 뒤에는 **모든 경로가
 * worktree 하위로 라우팅**되어야 한다. 하나라도 새면 사용자의 현재 작업트리를 건드린다.
 * 격리 실패 시에는 기존 동작(연결 폴더 직접 작업)으로 폴백해야 한다 — 지금 되던 작업이
 * 죽으면 안 되기 때문이다.
 */
const requests: Array<Record<string, unknown>> = [];
let respond: (p: Record<string, unknown>) => Record<string, unknown>;

jest.mock('./registry', () => ({
    getLocalBridgeRegistry: () => ({
        getDevice: () => ({ deviceId: 'dev-1', label: 'MacBook', folderName: 'proj' }),
        request: async (_userId: string, payload: Record<string, unknown>) => {
            requests.push(payload);
            return respond(payload);
        },
    }),
}));

import { RemoteExecutor } from './remote-executor';

const WT_REL = '.openmake/worktrees/task-abcdef12';
const BRANCH = 'omk-task/task-abc';

/** worktree add 를 성공시키는 기본 응답기. */
const okResponder = (p: Record<string, unknown>): Record<string, unknown> => {
    if (p.kind === 'worktree' && p.op === 'add') return { ok: true, worktreeRel: WT_REL, branch: BRANCH };
    if (p.kind === 'worktree' && p.op === 'diff') return { ok: true, stdout: 'diff --git a/x b/x\n+hello' };
    if (p.kind === 'worktree' && p.op === 'remove') return { ok: true, kept: false };
    if (p.kind === 'listAll') return { ok: true, entries: [`${WT_REL}/src/a.ts`, 'other/b.ts'] };
    return { ok: true, stdout: '', entries: [], content: '' };
};

beforeEach(() => {
    requests.length = 0;
    respond = okResponder;
});

async function isolated(): Promise<RemoteExecutor> {
    const ex = new RemoteExecutor('task-abcdef12', 'user-1');
    await ex.create();
    requests.length = 0; // create 왕복은 이후 검증에서 제외
    return ex;
}

describe('worktree 격리 — 경로 라우팅', () => {
    it('create 가 worktree 를 요청하고 브랜치를 노출한다', async () => {
        const ex = new RemoteExecutor('task-abcdef12', 'user-1');
        await ex.create();
        expect(requests).toContainEqual(expect.objectContaining({ kind: 'worktree', op: 'add', taskId: 'task-abcdef12' }));
        expect(ex.isolatedBranch).toBe(BRANCH);
    });

    it('파일 쓰기·읽기·삭제 경로가 worktree 하위로 라우팅된다', async () => {
        const ex = await isolated();
        await ex.writeFile('src/a.ts', 'x');
        await ex.readFile('src/a.ts');
        await ex.deleteFile('src/a.ts');
        for (const r of requests) expect(r.path).toBe(`${WT_REL}/src/a.ts`);
    });

    it('디렉토리 목록의 기본 경로(.)는 worktree 루트로 해석된다', async () => {
        const ex = await isolated();
        await ex.listDir();
        expect(requests[0].path).toBe(WT_REL);
    });

    it('exec 는 worktree 로 이동해 실행된다', async () => {
        const ex = await isolated();
        await ex.exec('npm test');
        expect(requests[0]).toMatchObject({ kind: 'exec', command: `cd ${WT_REL} && npm test` });
    });

    it('전체 목록은 worktree 하위만 남기고 prefix 를 벗긴다', async () => {
        const ex = await isolated();
        expect(await ex.listWorkspaceFiles()).toEqual(['src/a.ts']);
    });
});

describe('worktree 격리 — diff·정리', () => {
    it('captureDiff 가 worktree diff 를 돌려준다', async () => {
        const ex = await isolated();
        expect(await ex.captureDiff()).toContain('+hello');
        expect(requests[0]).toMatchObject({ kind: 'worktree', op: 'diff' });
    });

    it('변경이 없으면(빈 diff) null — diff 스텝을 남기지 않는다', async () => {
        const ex = await isolated();
        respond = (p) => (p.kind === 'worktree' && p.op === 'diff' ? { ok: true, stdout: '  \n' } : okResponder(p));
        expect(await ex.captureDiff()).toBeNull();
    });

    it('cleanup 이 worktree 정리 후 세션 종료를 통지한다', async () => {
        const ex = await isolated();
        await ex.cleanup();
        expect(requests.map((r) => `${r.kind}:${r.op ?? ''}`)).toEqual(['worktree:remove', 'task_end:']);
    });
});

describe('worktree 격리 실패 시 폴백', () => {
    it('git 레포가 아니면 격리 없이 기존 경로로 동작한다', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: false, error: 'git 레포가 아닙니다' } : okResponder(p));
        const ex = new RemoteExecutor('task-abcdef12', 'user-1');
        await ex.create();
        requests.length = 0;

        expect(ex.isolatedBranch).toBeNull();
        await ex.writeFile('src/a.ts', 'x');
        expect(requests[0].path).toBe('src/a.ts');
        await ex.exec('npm test');
        expect(requests[1].command).toBe('npm test');
        expect(await ex.captureDiff()).toBeNull();
    });

    it('격리가 없으면 cleanup 이 worktree 정리를 시도하지 않는다', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: false, error: 'git 레포가 아닙니다' } : okResponder(p));
        const ex = new RemoteExecutor('task-abcdef12', 'user-1');
        await ex.create();
        requests.length = 0;
        await ex.cleanup();
        expect(requests).toEqual([{ kind: 'task_end' }]);
    });

    it('디바이스 미연결이면 create 가 throw 한다 (기존 계약 유지)', async () => {
        jest.resetModules();
        jest.doMock('./registry', () => ({
            getLocalBridgeRegistry: () => ({ getDevice: () => null, request: async () => ({ ok: false }) }),
        }));
        const { RemoteExecutor: R } = require('./remote-executor');
        await expect(new R('task-abcdef12', 'user-1').create()).rejects.toThrow('연결된 로컬 디바이스가 없습니다');
    });
});
