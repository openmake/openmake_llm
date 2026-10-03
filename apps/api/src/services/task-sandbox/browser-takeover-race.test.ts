/**
 * 넘겨받기와 실행의 경합 — 브라우저 명령이 도는 동안 사용자가 넘겨받았으면 결과를 버린다.
 * 종전에는 시작 전에만 확인해, 넘겨받은 뒤 끝난 실행의 결과가 그대로 모델에 갔다.
 */
import { mkdtemp, writeFile, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TaskSandbox } from './sandbox';
import { getTaskSandboxConfig } from '../../config/task-sandbox';
import { BROWSER_TAKEOVER_DISCARDED_MESSAGE } from '../../prompts/agent-task-browser-web';

/** docker 대역 — 브라우저 run 이 한 번 돌고 나면 넘겨받기 세션(inspect)이 켜진 것으로 답한다(takeover=true 일 때). */
async function fakeDocker(dir: string, takeover: boolean): Promise<string> {
    const bin = join(dir, 'docker');
    await writeFile(bin, [
        '#!/bin/sh',
        'case "$*" in',
        `  "run --rm"*) touch '${dir}/ran'; printf '{"ok":true,"finalUrl":"about:blank","results":[]}' ;;`,
        `  inspect*) if [ -f '${dir}/ran' ] && [ '${takeover}' = true ]; then echo true; else exit 1; fi ;;`,
        '  *) exit 0 ;;',
        'esac',
        '',
    ].join('\n'), 'utf8');
    await chmod(bin, 0o755);
    return bin;
}

async function run(takeover: boolean) {
    const base = await mkdtemp(join(tmpdir(), 'omk-race-'));
    try {
        const sb = new TaskSandbox('r1', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: await fakeDocker(base, takeover), egressProxyEnabled: false });
        await sb.create();
        return await sb.runBrowser('a.json');
    } finally { await rm(base, { recursive: true, force: true }); }
}

describe('브라우저 실행 중 넘겨받기', () => {
    it('실행이 끝났을 때 사용자가 넘겨받은 상태면 결과를 버리고 안내를 돌려준다', async () => {
        const r = await run(true);
        expect(r.stdout).toBe('');
        expect(r.stderr).toBe(BROWSER_TAKEOVER_DISCARDED_MESSAGE);
        expect(r.exitCode).not.toBe(0);
    });

    it('넘겨받지 않았으면 결과를 그대로 돌려준다', async () => {
        const r = await run(false);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('"ok":true');
    });
});
