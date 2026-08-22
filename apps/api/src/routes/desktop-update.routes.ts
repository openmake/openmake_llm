/**
 * Desktop 앱 업데이트 배포 — 버전 매니페스트 + dmg 다운로드.
 *
 * 미서명(ad-hoc) 배포라 Squirrel 자동업데이트를 못 쓰므로, 앱이 이 API 로
 * 최신 버전을 확인하고 dmg 를 받아 자체 교체한다(sha256 은 매니페스트로 검증).
 * 공개 라우트(앱 배포용) — 파일명 화이트리스트로 경로 조작을 차단한다.
 *
 * GET /api/desktop/latest          → { version, file, sha256, url }
 * GET /api/desktop/download/:file  → dmg 스트림
 *
 * @module routes/desktop-update
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { DESKTOP_UPDATE } from '../config/desktop-update';
import { success, notFound, badRequest } from '../utils/api-response';
import { createLogger } from '../utils/logger';

const logger = createLogger('DesktopUpdate');
const router = Router();

router.get('/latest', (_req: Request, res: Response) => {
    const manifestPath = path.join(DESKTOP_UPDATE.DIR, 'latest.json');
    try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
            version?: string; file?: string; sha256?: string;
            native?: { version?: string; file?: string; sha256?: string };
        };
        if (!m.version || !m.file || !DESKTOP_UPDATE.FILE_PATTERN.test(m.file)) {
            res.status(404).json(notFound('업데이트 매니페스트가 올바르지 않습니다'));
            return;
        }
        // native 채널(SwiftUI 컴패니언) — 추가 전용: 블록이 없거나 형식이 어긋나면 기존 응답 그대로
        const n = m.native;
        const native = n && n.version && n.file && DESKTOP_UPDATE.FILE_PATTERN.test(n.file)
            ? { version: n.version, file: n.file, sha256: n.sha256 ?? null, url: `/api/desktop/download/${n.file}` }
            : null;
        res.json(success({
            version: m.version,
            file: m.file,
            sha256: m.sha256 ?? null,
            url: `/api/desktop/download/${m.file}`,
            ...(native ? { native } : {}),
        }));
    } catch {
        res.status(404).json(notFound('배포된 데스크톱 업데이트가 없습니다'));
    }
});

router.get('/download/:file', (req: Request, res: Response) => {
    const file = req.params.file;
    if (!DESKTOP_UPDATE.FILE_PATTERN.test(file)) {
        res.status(400).json(badRequest('허용되지 않는 파일명'));
        return;
    }
    const abs = path.join(DESKTOP_UPDATE.DIR, file);
    if (!fs.existsSync(abs)) {
        res.status(404).json(notFound('파일 없음'));
        return;
    }
    logger.info(`데스크톱 dmg 다운로드: ${file}`);
    res.download(abs, file);
});

export default router;
