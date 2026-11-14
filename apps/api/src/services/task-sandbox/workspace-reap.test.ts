import { reapStaleWorkspaces } from './sandbox';
import { getTaskSandboxConfig } from '../../config/task-sandbox';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('reapStaleWorkspaces', () => {
    const roots: string[] = []; // setup() 이 만든 루트 — 끝나면 지운다
    afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
    function setup() {
        const root = mkdtempSync(join(tmpdir(), 'omk-reap-'));
        roots.push(root);
        mkdirSync(join(root, 'task-a'));
        mkdirSync(join(root, 'task-b'));
        writeFileSync(join(root, 'task-a', 'out.txt'), 'x');
        return { ...getTaskSandboxConfig(), workspaceRoot: root, workspaceTtlMs: 1000 };
    }

    it('nowMs 가 TTL 만큼 미래면 모든 stale 디렉토리 삭제', async () => {
        const cfg = setup();
        // 디렉토리 mtime ≈ 현재. nowMs 를 충분히 큰 값으로 주면 diff > ttl → 삭제.
        const removed = await reapStaleWorkspaces(Date.now() + 10_000, cfg);
        expect(removed).toBe(2);
        expect(existsSync(join(cfg.workspaceRoot, 'task-a'))).toBe(false);
    });

    it('nowMs 가 과거(diff<ttl)면 아무것도 삭제하지 않음', async () => {
        const cfg = setup();
        const removed = await reapStaleWorkspaces(0, cfg);
        expect(removed).toBe(0);
        expect(existsSync(join(cfg.workspaceRoot, 'task-a'))).toBe(true);
    });

    it('없는 루트는 0', async () => {
        const cfg = { ...getTaskSandboxConfig(), workspaceRoot: '/nonexistent/omk-xyz', workspaceTtlMs: 1000 };
        expect(await reapStaleWorkspaces(Date.now() + 10_000, cfg)).toBe(0);
    });
});
