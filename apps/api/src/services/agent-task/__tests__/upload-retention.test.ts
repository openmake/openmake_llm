/**
 * 업로드 보존 스윕 유닛 테스트 — 종료+만료 task 원본 회수, 진행형/최근 종료 보호,
 * 고아 디렉토리 mtime 가드, tmp/ 잔재 청소, retention 0 비활성.
 * UPLOAD_ROOT 를 임시 디렉토리로 격리(모듈 로드 전 env 오버라이드).
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Pool } from 'pg';

const TMP_ROOT = path.join(os.tmpdir(), `upload-retention-test-${process.pid}`);
process.env.AGENT_TASK_UPLOAD_ROOT = TMP_ROOT;

// env 반영을 위해 상수 모듈보다 늦게 import (jest 는 파일 내 import 호이스팅 — require 사용)
const { sweepExpiredTaskUploads } = require('../upload-retention') as typeof import('../upload-retention');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // 고정 기준 시각
const RETENTION = 30 * DAY;    // 기본값과 동일

function poolWithRows(rows: Array<{ id: string; status: string; finished_at: Date | null }>): Pool {
    return { query: jest.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

async function makeTaskDir(name: string, files: Record<string, string> = { 'a.txt': 'x' }): Promise<string> {
    const dir = path.join(TMP_ROOT, name);
    await fs.mkdir(dir, { recursive: true });
    for (const [f, c] of Object.entries(files)) await fs.writeFile(path.join(dir, f), c);
    return dir;
}

async function exists(p: string): Promise<boolean> {
    try { await fs.stat(p); return true; } catch { return false; }
}

beforeEach(async () => {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
    await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterAll(async () => {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe('sweepExpiredTaskUploads', () => {
    it('종료+만료 task 원본만 회수하고 진행형·최근 종료는 유지한다', async () => {
        const expired = await makeTaskDir('task-expired');
        const recent = await makeTaskDir('task-recent');
        const running = await makeTaskDir('task-running');
        const pool = poolWithRows([
            { id: 'task-expired', status: 'completed', finished_at: new Date(NOW - RETENTION - DAY) },
            { id: 'task-recent', status: 'failed', finished_at: new Date(NOW - DAY) },
            { id: 'task-running', status: 'running', finished_at: new Date(NOW - RETENTION - DAY) },
        ]);

        const r = await sweepExpiredTaskUploads(pool, NOW);

        expect(r.sweptTasks).toBe(1);
        expect(await exists(expired)).toBe(false);
        expect(await exists(recent)).toBe(true);
        expect(await exists(running)).toBe(true);
    });

    it('tmp/·chunked/ 는 task 스윕 대상에서 제외한다', async () => {
        await makeTaskDir('tmp');
        await makeTaskDir('chunked');
        const pool = poolWithRows([]);

        await sweepExpiredTaskUploads(pool, NOW);

        // DB 조회 자체가 일어나지 않아야 한다 (task 디렉토리 0개)
        expect((pool.query as jest.Mock)).not.toHaveBeenCalled();
        expect(await exists(path.join(TMP_ROOT, 'chunked'))).toBe(true);
    });

    it('DB 행이 없는 고아 디렉토리는 mtime 이 보존기간을 지난 것만 제거한다', async () => {
        const oldOrphan = await makeTaskDir('orphan-old');
        const freshOrphan = await makeTaskDir('orphan-fresh');
        const oldTime = new Date(NOW - RETENTION - DAY);
        await fs.utimes(oldOrphan, oldTime, oldTime);
        const freshTime = new Date(NOW - DAY);
        await fs.utimes(freshOrphan, freshTime, freshTime);
        const pool = poolWithRows([]);

        const r = await sweepExpiredTaskUploads(pool, NOW);

        expect(r.orphanDirs).toBe(1);
        expect(await exists(oldOrphan)).toBe(false);
        expect(await exists(freshOrphan)).toBe(true);
    });

    it('tmp/ 의 오래된 잔재 파일만 지운다', async () => {
        const tmpDir = path.join(TMP_ROOT, 'tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const stale = path.join(tmpDir, 'stale.part');
        const fresh = path.join(tmpDir, 'fresh.part');
        await fs.writeFile(stale, 'x');
        await fs.writeFile(fresh, 'y');
        const staleTime = new Date(NOW - 2 * DAY); // CHUNK_UPLOAD_TTL_MS 기본 24h 초과
        await fs.utimes(stale, staleTime, staleTime);
        const freshTime = new Date(NOW - 60 * 1000); // 고정 NOW 기준의 "방금" (실제 시계와 무관)
        await fs.utimes(fresh, freshTime, freshTime);
        const pool = poolWithRows([]);

        const r = await sweepExpiredTaskUploads(pool, NOW);

        expect(r.tmpFiles).toBe(1);
        expect(await exists(stale)).toBe(false);
        expect(await exists(fresh)).toBe(true);
    });

    it('retention 0 이면 원본 회수 없이 tmp 청소만 수행한다', async () => {
        process.env.AGENT_TASK_UPLOAD_RETENTION_DAYS = '0';
        jest.resetModules();
        const mod = require('../upload-retention') as typeof import('../upload-retention');
        try {
            const expired = await makeTaskDir('task-expired-off');
            const tmpDir = path.join(TMP_ROOT, 'tmp');
            await fs.mkdir(tmpDir, { recursive: true });
            const stale = path.join(tmpDir, 'stale.part');
            await fs.writeFile(stale, 'x');
            const staleTime = new Date(NOW - 2 * DAY);
            await fs.utimes(stale, staleTime, staleTime);
            const pool = poolWithRows([
                { id: 'task-expired-off', status: 'completed', finished_at: new Date(NOW - RETENTION - DAY) },
            ]);

            const r = await mod.sweepExpiredTaskUploads(pool, NOW);

            expect(r).toEqual({ sweptTasks: 0, orphanDirs: 0, tmpFiles: 1 });
            expect((pool.query as jest.Mock)).not.toHaveBeenCalled();
            expect(await exists(expired)).toBe(true);
        } finally {
            delete process.env.AGENT_TASK_UPLOAD_RETENTION_DAYS;
            jest.resetModules();
        }
    });
});
