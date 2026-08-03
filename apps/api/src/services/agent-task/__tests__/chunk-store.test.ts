/**
 * 청크 업로드 스토어 유닛 테스트 — init/write/complete/claim 수명주기와 방어 로직.
 * UPLOAD_ROOT 를 임시 디렉토리로 격리(모듈 로드 전 env 오버라이드).
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const TMP_ROOT = path.join(os.tmpdir(), `chunk-store-test-${process.pid}`);
process.env.AGENT_TASK_UPLOAD_ROOT = TMP_ROOT;

// env 반영을 위해 상수 모듈보다 늦게 import (jest 는 파일 내 import 호이스팅 — require 사용)
const {
    initChunkedUpload, writeChunk, completeChunkedUpload, claimChunkedUpload,
    abortChunkedUpload,
} = require('../chunk-store') as typeof import('../chunk-store');

const USER = 'user-1';
const OTHER = 'user-2';

afterAll(async () => {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

async function makeUpload(content: Buffer, chunkSize: number) {
    const totalChunks = Math.max(1, Math.ceil(content.length / chunkSize));
    const { uploadId } = await initChunkedUpload(USER, {
        name: 'test.bin', type: 'application/octet-stream', size: content.length, totalChunks,
    });
    for (let i = 0; i < totalChunks; i++) {
        await writeChunk(uploadId, USER, i, content.subarray(i * chunkSize, (i + 1) * chunkSize));
    }
    return { uploadId, totalChunks };
}

describe('chunk-store 수명주기', () => {
    it('init → chunk → complete → claim 이 원본을 그대로 복원한다', async () => {
        const content = Buffer.from('A'.repeat(1000) + 'B'.repeat(500));
        const { uploadId } = await makeUpload(content, 400);
        const done = await completeChunkedUpload(uploadId, USER);
        expect(done).toMatchObject({ name: 'test.bin', size: 1500 });

        const claimed = await claimChunkedUpload(uploadId, USER, 'task-abc', 1000);
        expect(claimed.storedPath).toContain('task-abc');
        const restored = await fs.readFile(path.join(TMP_ROOT, claimed.storedPath));
        expect(restored.equals(content)).toBe(true);
        // claim 후 업로드 디렉토리는 제거됨 → 재클레임 불가
        await expect(claimChunkedUpload(uploadId, USER, 'task-abc', 1001))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('complete 는 멱등 — 두 번 호출해도 같은 결과', async () => {
        const { uploadId } = await makeUpload(Buffer.from('hello'), 3);
        await completeChunkedUpload(uploadId, USER);
        const again = await completeChunkedUpload(uploadId, USER);
        expect(again.size).toBe(5);
        await abortChunkedUpload(uploadId, USER);
    });
});

describe('chunk-store 방어', () => {
    it('소유자가 아니면 403', async () => {
        const { uploadId } = await makeUpload(Buffer.from('x'), 10);
        await expect(writeChunk(uploadId, OTHER, 0, Buffer.from('y')))
            .rejects.toMatchObject({ statusCode: 403 });
        await expect(claimChunkedUpload(uploadId, OTHER, 't', 0))
            .rejects.toMatchObject({ statusCode: 403 });
        await abortChunkedUpload(uploadId, USER);
    });

    it('경로 성분이 든 uploadId 는 400', async () => {
        await expect(writeChunk('../evil', USER, 0, Buffer.from('x')))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('청크 누락 시 complete 는 409, 보충 후 성공', async () => {
        const content = Buffer.from('0123456789');
        const { uploadId } = await initChunkedUpload(USER, {
            name: 'gap.bin', size: 10, totalChunks: 2,
        });
        await writeChunk(uploadId, USER, 0, content.subarray(0, 5));
        await expect(completeChunkedUpload(uploadId, USER))
            .rejects.toMatchObject({ statusCode: 409 });
        await writeChunk(uploadId, USER, 1, content.subarray(5));
        const done = await completeChunkedUpload(uploadId, USER);
        expect(done.size).toBe(10);
        await abortChunkedUpload(uploadId, USER);
    });

    it('선언 크기와 수신 합계 불일치는 409', async () => {
        const { uploadId } = await initChunkedUpload(USER, {
            name: 'short.bin', size: 100, totalChunks: 1,
        });
        await writeChunk(uploadId, USER, 0, Buffer.from('too-short'));
        await expect(completeChunkedUpload(uploadId, USER))
            .rejects.toMatchObject({ statusCode: 409 });
        await abortChunkedUpload(uploadId, USER);
    });

    it('index 범위 밖 청크·완료 전 claim 은 거절', async () => {
        const { uploadId } = await initChunkedUpload(USER, {
            name: 'r.bin', size: 3, totalChunks: 1,
        });
        await expect(writeChunk(uploadId, USER, 5, Buffer.from('x')))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(claimChunkedUpload(uploadId, USER, 't', 0))
            .rejects.toMatchObject({ statusCode: 409 });
        await abortChunkedUpload(uploadId, USER);
    });
});
