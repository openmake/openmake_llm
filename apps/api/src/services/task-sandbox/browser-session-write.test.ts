/**
 * 브라우저 세션 스크립트 호스트 쓰기 — 컨테이너 안에서 심어 둔 심링크를 따라가지 않는다 (보안 점검 E7).
 */
import { mkdtemp, writeFile, readFile, symlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { startBrowserSession } from './browser-session';
import { getTaskSandboxConfig, BROWSER_SESSION } from '../../config/task-sandbox';

describe('startBrowserSession 세션 스크립트 쓰기', () => {
    let base: string;
    beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'omk-bs-write-')); });
    afterEach(async () => { await rm(base, { recursive: true, force: true }); });

    it('세션 스크립트 자리에 심링크가 있으면 ELOOP 로 거부하고 링크 대상 파일을 덮어쓰지 않는다', async () => {
        const outside = join(base, 'host-secret.txt');
        await writeFile(outside, 'original');
        const ws = await mkdtemp(join(base, 'ws-'));
        await symlink(outside, join(ws, BROWSER_SESSION.SCRIPT_FILE));
        // docker 대신 /usr/bin/false — inspect 실패 → 세션 없음 → 스크립트 쓰기로 진행
        const cfg = { ...getTaskSandboxConfig(), dockerPath: '/usr/bin/false', egressProxyEnabled: false };
        await expect(startBrowserSession('t-link', ws, {}, cfg)).rejects.toMatchObject({ code: 'ELOOP' });
        expect(await readFile(outside, 'utf8')).toBe('original');
    });
});
