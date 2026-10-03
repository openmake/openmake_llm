/**
 * 일회성 브라우저 컨테이너 — 이름을 붙이고, 시간 초과 때 컨테이너까지 치우고, 부팅 회수 대상에 넣는다.
 * 종전에는 이름이 없어 시간 초과 때 docker CLI 만 죽고 컨테이너(chromium)는 계속 돌았다.
 */
import { mkdtemp, writeFile, readFile, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('../../config/agent-task-browser-web', () => ({
    ...jest.requireActual('../../config/agent-task-browser-web'),
    BROWSER_RUN: { ...jest.requireActual('../../config/agent-task-browser-web').BROWSER_RUN, MIN_TIMEOUT_MS: 300 },
}));

import { buildBrowserRunArgs, browserRunContainerName, reapOrphanTaskSandboxes, TaskSandbox } from './sandbox';
import { getTaskSandboxConfig } from '../../config/task-sandbox';

/** docker 대역 — 인자를 기록한다. HANG 이 든 run 은 멈춰 있고, ps 는 접두마다 다른 id 를 돌려준다. */
async function fakeDocker(dir: string): Promise<{ bin: string; log: string }> {
    const bin = join(dir, 'docker'); const log = join(dir, 'docker.log');
    await writeFile(bin, [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> '${log}'`,
        'case "$*" in',
        '  "run --rm"*HANG*) exec sleep 30 ;;',
        '  "ps -aq"*name=omk-brun-*) echo b1 ;;',
        '  "ps -aq"*name=omk-task-*) echo t1 ;;',
        '  inspect*) exit 1 ;;',
        '  *) exit 0 ;;',
        'esac',
        '',
    ].join('\n'), 'utf8');
    await chmod(bin, 0o755);
    return { bin, log };
}
const lines = async (p: string) => (await readFile(p, 'utf8').catch(() => '')).split('\n').filter(Boolean);

describe('일회성 브라우저 컨테이너 이름·정리', () => {
    it('이름은 전용 접두 + 작업 id + 호출마다 다른 꼬리다', () => {
        const a = browserRunContainerName('task/1');
        const b = browserRunContainerName('task/1');
        expect(a).toMatch(/^omk-brun-task_1-[0-9a-f]{8}$/);
        expect(a).not.toBe(b);
        expect(a).not.toContain('omk-task-');
        expect(a).not.toContain('omk-browser-');
    });

    it('이름을 주면 docker run 에 --name 으로 붙는다', () => {
        const r = buildBrowserRunArgs('/tmp/ws/abc', 'a.json', getTaskSandboxConfig(), undefined, 'omk-brun-abc-12345678');
        expect(r.slice(0, 5)).toEqual(['run', '--rm', '--init', '--name', 'omk-brun-abc-12345678']);
    });

    it('시간 초과면 그 이름의 컨테이너를 강제로 지운다', async () => {
        const base = await mkdtemp(join(tmpdir(), 'omk-brun-'));
        try {
            const { bin, log } = await fakeDocker(base);
            const sb = new TaskSandbox('b1', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, execTimeoutMs: 100, egressProxyEnabled: false });
            await sb.create();
            const r = await sb.runBrowser('HANG.json');
            expect(r.timedOut).toBe(true);
            const l = await lines(log);
            const name = /--name (omk-brun-b1-[0-9a-f]{8})/.exec(l.find((x) => x.startsWith('run --rm')) ?? '')?.[1];
            expect(name).toBeTruthy();
            expect(l).toContain(`rm -f ${name}`);
        } finally { await rm(base, { recursive: true, force: true }); }
    });

    it('정상 종료면 정리 호출을 하지 않는다', async () => {
        const base = await mkdtemp(join(tmpdir(), 'omk-brun-'));
        try {
            const { bin, log } = await fakeDocker(base);
            const sb = new TaskSandbox('b2', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, egressProxyEnabled: false });
            await sb.create();
            expect((await sb.runBrowser('ok.json')).exitCode).toBe(0);
            expect((await lines(log)).filter((x) => x.startsWith('rm -f omk-brun-'))).toHaveLength(0);
        } finally { await rm(base, { recursive: true, force: true }); }
    });

    it('부팅 회수는 영속 샌드박스와 일회성 브라우저 컨테이너를 모두 지운다', async () => {
        const base = await mkdtemp(join(tmpdir(), 'omk-brun-'));
        try {
            const { bin, log } = await fakeDocker(base);
            expect(await reapOrphanTaskSandboxes({ ...getTaskSandboxConfig(), dockerPath: bin })).toBe(2);
            const l = await lines(log);
            expect(l).toContain('rm -f t1');
            expect(l).toContain('rm -f b1');
        } finally { await rm(base, { recursive: true, force: true }); }
    });
});
