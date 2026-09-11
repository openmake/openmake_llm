/**
 * @module services/generated-media-retention
 * @description `/generated` 생성 미디어(이미지·오디오·영상) 보존 스윕 — TTL 초과 파일 삭제. 예약 리포트 게시 디렉토리(reports/) 제외.
 * 사용자 결정(2026-09-12): /generated 구조 유지 + TTL 정리만(소유·접근 제어는 범위 밖). 부팅 1회 + MAINTENANCE_SWEEP_MS 주기.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GENERATED_MEDIA_RETENTION } from '../config/capabilities';
import { resolveGeneratedDir } from '../mcp/generated-media';
import { createLogger } from '../utils/logger';

const logger = createLogger('GeneratedMediaRetention');

export function reapStaleGeneratedMedia(now = Date.now(), dir = resolveGeneratedDir()): { scanned: number; removed: number } {
    let scanned = 0; let removed = 0;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { scanned, removed }; }
    for (const e of entries) {
        if (!e.isFile()) continue; // 하위 디렉토리(reports/ 등)는 건드리지 않는다
        if (GENERATED_MEDIA_RETENTION.EXCLUDED_DIRS.includes(e.name)) continue;
        scanned++;
        const abs = path.join(dir, e.name);
        try {
            const st = fs.statSync(abs);
            if (now - st.mtimeMs > GENERATED_MEDIA_RETENTION.TTL_MS) { fs.unlinkSync(abs); removed++; }
        } catch { /* 개별 파일 실패 무시 */ }
    }
    if (removed > 0) logger.info(`생성 미디어 ${removed}개 삭제 (TTL ${Math.round(GENERATED_MEDIA_RETENTION.TTL_MS / 86400000)}일 초과, 검사 ${scanned})`);
    return { scanned, removed };
}
