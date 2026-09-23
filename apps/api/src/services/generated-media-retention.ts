/**
 * @module services/generated-media-retention
 * @description `/generated` 생성 미디어(이미지·오디오·영상) 보존 스윕 — TTL 초과 파일 삭제. 예약 리포트 게시 디렉토리(reports/) 제외.
 * 사용자 결정(2026-09-12): /generated 구조 유지 + TTL 정리만(소유·접근 제어는 범위 밖). 부팅 1회 + MAINTENANCE_SWEEP_MS 주기.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GENERATED_MEDIA_RETENTION } from '../config/capabilities';
import { resolveGeneratedDir, resolveGeneratedPrivateDir } from '../tools/generated-media';
import { createLogger } from '../utils/logger';

const logger = createLogger('GeneratedMediaRetention');

function reapDir(dir: string, now: number): { scanned: number; removed: string[] } {
    let scanned = 0; const removed: string[] = [];
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { scanned, removed }; }
    for (const e of entries) {
        if (!e.isFile()) continue; // 하위 디렉토리(reports/ 등)는 건드리지 않는다
        if (GENERATED_MEDIA_RETENTION.EXCLUDED_DIRS.includes(e.name)) continue;
        scanned++;
        const abs = path.join(dir, e.name);
        try {
            const st = fs.statSync(abs);
            if (now - st.mtimeMs > GENERATED_MEDIA_RETENTION.TTL_MS) { fs.unlinkSync(abs); removed.push(e.name); }
        } catch { /* 개별 파일 실패 무시 */ }
    }
    return { scanned, removed };
}

/**
 * 공개 root(종전)와 비공개 디렉토리(P04 신규) 둘 다 스윕한다. 지운 파일은 `generated_artifacts.deleted_at` 에 남긴다
 * (삭제된 파일을 링크만으로 되살리지 않는다 — fire-and-forget, 실패는 로그).
 */
export function reapStaleGeneratedMedia(now = Date.now(), dir = resolveGeneratedDir(), privateDir = resolveGeneratedPrivateDir()): { scanned: number; removed: number } {
    const a = reapDir(dir, now);
    const b = dir === privateDir ? { scanned: 0, removed: [] as string[] } : reapDir(privateDir, now);
    const removed = [...a.removed, ...b.removed];
    if (removed.length > 0) {
        logger.info(`생성 미디어 ${removed.length}개 삭제 (TTL ${Math.round(GENERATED_MEDIA_RETENTION.TTL_MS / 86400000)}일 초과, 검사 ${a.scanned + b.scanned})`);
        void (async () => {
            const { getPool } = await import('../data/models/unified-database');
            const { GeneratedArtifactsRepository } = await import('../data/repositories/generated-artifacts-repo');
            await new GeneratedArtifactsRepository(getPool()).markDeleted(removed);
        })().catch((err: unknown) => logger.debug(`삭제 기록 실패(무시): ${err instanceof Error ? err.message : String(err)}`));
    }
    return { scanned: a.scanned + b.scanned, removed: removed.length };
}
