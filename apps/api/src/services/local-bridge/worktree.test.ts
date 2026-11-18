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
/** 기기가 알린 기능 값 — 기본은 새 기기(무시 파일 보존을 안다). */
let deviceCaps = new Set<string>(['worktree_keep_ignored']);

jest.mock('./registry', () => ({
    getLocalBridgeRegistry: () => ({
        getDevice: () => ({ deviceId: 'dev-1', label: 'MacBook', folderName: 'proj' }),
        supports: (_u: string, _d: string | undefined, cap: string) => deviceCaps.has(cap),
        request: async (_userId: string, payload: Record<string, unknown>) => {
            requests.push(payload);
            return respond(payload);
        },
    }),
}));

jest.mock('../org/effective-policy', () => ({ resolveEffectivePolicy: async () => ({ browserSite: undefined }) }));
jest.mock('./browser-policy-audit', () => ({ auditBrowserPolicyBlock: async () => undefined }));

import { RemoteExecutor } from './remote-executor';
import { LOCAL_BRIDGE } from '../../config/local-bridge';

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
    deviceCaps = new Set<string>(['worktree_keep_ignored']);
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
        expect(requests).toEqual([{ kind: 'task_end', taskId: 'task-abcdef12' }]);
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

describe('worktree 격리 상태(isolation, 200)', () => {
    async function created(): Promise<RemoteExecutor> {
        const ex = new RemoteExecutor('task-abcdef12', 'user-1');
        await ex.create();
        return ex;
    }

    it('create 전에는 null', () => {
        expect(new RemoteExecutor('task-abcdef12', 'user-1').isolation).toBeNull();
    });

    it('격리 성공 → worktree + 기기가 준 branch·worktreeRel', async () => {
        expect((await created()).isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: WT_REL, rootRel: WT_REL });
    });

    it('ok·worktreeRel 은 있는데 branch 가 없으면 null(격리는 걸린다)', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: true, worktreeRel: WT_REL } : okResponder(p));
        const ex = await created();
        expect(ex.isolation).toBeNull();
        await ex.writeFile('a.txt', 'x');
        expect(requests[requests.length - 1].path).toBe(`${WT_REL}/a.txt`);
    });

    it('기기가 준 branch·worktreeRel 이 문자열이 아니면 null(branch 없음과 같은 경로)', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: true, worktreeRel: WT_REL, branch: { x: 1 } } as never : okResponder(p));
        expect((await created()).isolation).toBeNull();
        respond = (p) => (p.kind === 'worktree' ? { ok: true, worktreeRel: 42, branch: BRANCH } as never : okResponder(p));
        expect((await created()).isolation).toBeNull();
    });

    it('"git 레포가 아닙니다" → direct/not_repo', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: false, error: 'git 레포가 아닙니다' } : okResponder(p));
        expect((await created()).isolation).toEqual({ state: 'direct', reason: 'not_repo' });
    });

    it('그 밖의 기기 오류 → direct/unavailable', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: false, error: 'worktree add 실패' } : okResponder(p));
        expect((await created()).isolation).toEqual({ state: 'direct', reason: 'unavailable' });
    });

    it('전송 실패·능력 미지원은 문구와 무관하게 direct/unavailable', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: false, transport: 'timeout', error: 'git 레포가 아닙니다' } : okResponder(p));
        expect((await created()).isolation).toEqual({ state: 'direct', reason: 'unavailable' });
        respond = (p) => (p.kind === 'worktree' ? { ok: false, unsupported: true, error: 'git 레포가 아닙니다' } : okResponder(p));
        expect((await created()).isolation).toEqual({ state: 'direct', reason: 'unavailable' });
    });

    it('WORKTREE_ENABLED=false → direct/disabled (worktree 요청 없음)', async () => {
        const restore = jest.replaceProperty(LOCAL_BRIDGE, 'WORKTREE_ENABLED', false);
        try {
            const ex = await created();
            expect(ex.isolation).toEqual({ state: 'direct', reason: 'disabled' });
            expect(requests.some((r) => r.kind === 'worktree')).toBe(false);
        } finally { restore.restore(); }
    });

    it('cleanup: kept:true → outcome kept, kept:false → removed', async () => {
        respond = (p) => (p.kind === 'worktree' && p.op === 'remove' ? { ok: true, kept: true } : okResponder(p));
        const kept = await created();
        await kept.cleanup();
        expect(kept.isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: WT_REL, rootRel: WT_REL, outcome: 'kept' });
        respond = okResponder;
        const removed = await created();
        await removed.cleanup();
        expect(removed.isolation).toMatchObject({ state: 'worktree', outcome: 'removed' });
    });

    it('cleanup: 무시 파일만 남아 보존(kept + ignoredOnly) → isolation 에 ignoredOnly 를 싣는다', async () => {
        respond = (p) => (p.kind === 'worktree' && p.op === 'remove' ? { ok: true, kept: true, ignoredOnly: true } : okResponder(p));
        const ex = await created();
        await ex.cleanup();
        expect(ex.isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: WT_REL, rootRel: WT_REL, outcome: 'kept', ignoredOnly: true });
    });

    it('cleanup: kept 만이면 ignoredOnly 를 싣지 않는다', async () => {
        respond = (p) => (p.kind === 'worktree' && p.op === 'remove' ? { ok: true, kept: true } : okResponder(p));
        const ex = await created();
        await ex.cleanup();
        expect(ex.isolation).not.toHaveProperty('ignoredOnly');
    });

    describe('옛 기기 보완(worktree_keep_ignored 없음, 설계 2026-11-18 ignored-cleanup K6)', () => {
        const removeSent = (): boolean => requests.some((r) => r.kind === 'worktree' && r.op === 'remove');
        const taskEndSent = (): boolean => requests.some((r) => r.kind === 'task_end');

        it('파일을 쓴 작업은 remove 를 보내지 않고 kept 로 기록한다(task_end 는 보낸다)', async () => {
            deviceCaps = new Set();
            const ex = await created();
            await ex.writeFile('out/report.md', 'r');
            await ex.cleanup();
            expect(removeSent()).toBe(false);
            expect(taskEndSent()).toBe(true);
            expect(ex.isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: WT_REL, rootRel: WT_REL, outcome: 'kept' });
        });

        it('쓰기가 없으면 지금처럼 remove 를 보낸다', async () => {
            deviceCaps = new Set();
            const ex = await created();
            await ex.cleanup();
            expect(removeSent()).toBe(true);
            expect(ex.isolation).toMatchObject({ outcome: 'removed' });
        });

        it('쓰기가 실패했으면 파일이 없으므로 remove 를 보낸다', async () => {
            deviceCaps = new Set();
            respond = (p) => (p.kind === 'write' ? { ok: false, error: 'x' } : okResponder(p));
            const ex = await created();
            await expect(ex.writeFile('a.txt', 'x')).rejects.toThrow();
            await ex.cleanup();
            expect(removeSent()).toBe(true);
        });

        it('능력을 알린 새 기기는 쓰기가 있어도 remove 를 보낸다(판단은 기기)', async () => {
            const ex = await created();
            await ex.writeFile('a.txt', 'x');
            await ex.cleanup();
            expect(removeSent()).toBe(true);
        });

        it('브라우저 요청이 성공한 작업도 remove 를 보내지 않는다', async () => {
            deviceCaps = new Set(['browser']);
            const ex = await created();
            await ex.runBrowserSpec({ actions: [{ type: 'goto', url: 'https://example.com' }], approvedHosts: [] });
            await ex.cleanup();
            expect(removeSent()).toBe(false);
            expect(ex.isolation).toMatchObject({ outcome: 'kept' });
        });
    });

    it('cleanup: remove 실패·예외면 outcome 을 채우지 않는다', async () => {
        respond = (p) => (p.kind === 'worktree' && p.op === 'remove' ? { ok: false, error: 'x' } : okResponder(p));
        const failed = await created();
        await failed.cleanup();
        expect(failed.isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: WT_REL, rootRel: WT_REL });
        respond = (p) => { if (p.kind === 'worktree' && p.op === 'remove') throw new Error('boom'); return okResponder(p); };
        const thrown = await created();
        await thrown.cleanup();
        expect(thrown.isolation).not.toHaveProperty('outcome');
    });
});

describe('이어받은 세그먼트의 worktree (worktreeKey)', () => {
    it('worktree add·diff·remove 는 물려받은 키로, exec·task_end 는 자기 taskId 로 보낸다', async () => {
        const ex = new RemoteExecutor('seg2-0000-0000', 'user-1', undefined, undefined, 'root-1111-1111');
        await ex.create();
        await ex.exec('ls');
        await ex.captureDiff();
        await ex.cleanup();
        const wt = requests.filter((r) => r.kind === 'worktree');
        expect(wt.map((r) => r.op)).toEqual(['add', 'diff', 'remove']);
        expect(wt.every((r) => r.taskId === 'root-1111-1111')).toBe(true);
        expect(requests.find((r) => r.kind === 'exec')).toEqual(expect.objectContaining({ taskId: 'seg2-0000-0000' }));
        expect(requests.find((r) => r.kind === 'task_end')).toEqual(expect.objectContaining({ taskId: 'seg2-0000-0000' }));
    });

    it('키를 주지 않으면 종전대로 자기 taskId', async () => {
        const ex = new RemoteExecutor('task-abcdef12', 'user-1');
        await ex.create();
        await ex.cleanup();
        expect(requests.filter((r) => r.kind === 'worktree').every((r) => r.taskId === 'task-abcdef12')).toBe(true);
    });

    it('handover 면 worktree remove 를 보내지 않고 task_end 만 보낸다(outcome 없음)', async () => {
        const ex = await isolated();
        await ex.cleanup(false, { handover: true });
        expect(requests.map((r) => `${r.kind}:${r.op ?? ''}`)).toEqual(['task_end:']);
        expect(ex.isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: WT_REL, rootRel: WT_REL });
    });
});

describe('작업 폴더 위치(rootRel·isolatedPath) — 연결 폴더 기준', () => {
    it('격리 상태·isolatedPath 가 연결 폴더 기준 작업 폴더 경로를 싣는다(하위 폴더 선택)', async () => {
        respond = (p) => (p.kind === 'worktree' && p.op === 'add'
            ? { ok: true, worktreeRel: `${WT_REL}/sub`, branch: BRANCH } : okResponder(p));
        const ex = new RemoteExecutor('task-abcdef12', 'user-1', undefined, 'ws-git/sub');
        await ex.create();
        expect(ex.isolatedPath).toBe(`ws-git/sub/${WT_REL}/sub`);
        expect(ex.isolation).toEqual({ state: 'worktree', branch: BRANCH, worktreeRel: `${WT_REL}/sub`, rootRel: `ws-git/sub/${WT_REL}/sub` });
    });

    it('하위 폴더가 없으면 rootRel 은 worktreeRel 과 같다', async () => {
        const ex = await isolated();
        expect(ex.isolatedPath).toBe(WT_REL);
    });

    it('격리가 없으면 isolatedPath 는 null 이다', async () => {
        respond = (p) => (p.kind === 'worktree' ? { ok: false, error: 'git 레포가 아닙니다' } : okResponder(p));
        const ex = new RemoteExecutor('task-abcdef12', 'user-1', undefined, 'ws-plain');
        await ex.create();
        expect(ex.isolatedPath).toBeNull();
    });

    it('정리 뒤에도 rootRel 이 남는다(outcome 만 더해진다)', async () => {
        respond = (p) => (p.kind === 'worktree' && p.op === 'remove' ? { ok: true, kept: true } : okResponder(p));
        const ex = await isolated();
        await ex.cleanup();
        expect(ex.isolation).toMatchObject({ rootRel: WT_REL, outcome: 'kept' });
    });
});
