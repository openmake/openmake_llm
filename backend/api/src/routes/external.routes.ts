/**
 * External Routes
 * 외부 서비스 연결 관리 API 라우트
 * 
 * - GET / — 사용자 외부 연결 목록
 * - POST / — 외부 연결 생성/업데이트
 * - GET /:serviceType — 특정 서비스 연결 조회
 * - PUT /:connectionId/tokens — 토큰 갱신
 * - DELETE /:serviceType — 서비스 연결 해제
 * - GET /:connectionId/files — 캐시된 파일 목록
 * - POST /:connectionId/files — 외부 파일 캐시
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest, notFound, internalError } from '../utils/api-response';
import { requireAuth } from '../auth';
import { getUnifiedDatabase, ExternalServiceType } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('ExternalRoutes');
const router = Router();

const VALID_SERVICE_TYPES: ExternalServiceType[] = ['google_drive', 'notion', 'github', 'slack', 'dropbox'];

function isValidServiceType(value: string): value is ExternalServiceType {
    return VALID_SERVICE_TYPES.includes(value as ExternalServiceType);
}

/**
 * GET /api/external
 * 사용자의 외부 서비스 연결 목록 조회
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const db = getUnifiedDatabase();
        const userId = String(req.user!.id);

        const connections = await db.getUserConnections(userId);

        res.json(success(connections));
    } catch (error) {
        logger.error('외부 연결 목록 조회 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

/**
 * POST /api/external
 * 외부 서비스 연결 생성/업데이트
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const { serviceType, accessToken, refreshToken, tokenExpiresAt, accountEmail, accountName, metadata } = req.body;

        if (!serviceType) {
            res.status(400).json(badRequest('서비스 타입은 필수입니다'));
            return;
        }
        if (!isValidServiceType(serviceType)) {
            res.status(400).json(badRequest(`유효하지 않은 서비스 타입입니다: ${serviceType}. 허용: ${VALID_SERVICE_TYPES.join(', ')}`));
            return;
        }

        const db = getUnifiedDatabase();
        const connectionId = uuidv4();
        const userId = String(req.user!.id);

        await db.createExternalConnection({
            id: connectionId,
            userId,
            serviceType,
            accessToken,
            refreshToken,
            tokenExpiresAt,
            accountEmail,
            accountName,
            metadata,
        });

        // createExternalConnection uses ON CONFLICT — fetch the actual record
        const connection = await db.getUserConnectionByService(userId, serviceType);

        logger.info(`외부 연결 생성/업데이트: ${serviceType} by user ${userId}`);
        res.status(201).json(success(connection));
    } catch (error) {
        logger.error('외부 연결 생성 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

/**
 * GET /api/external/:serviceType
 * 특정 서비스 연결 조회
 */
router.get('/:serviceType', requireAuth, async (req: Request, res: Response) => {
    try {
        const { serviceType } = req.params;

        if (!isValidServiceType(serviceType)) {
            res.status(400).json(badRequest(`유효하지 않은 서비스 타입입니다: ${serviceType}`));
            return;
        }

        const db = getUnifiedDatabase();
        const userId = String(req.user!.id);

        const connection = await db.getUserConnectionByService(userId, serviceType);
        if (!connection) {
            res.status(404).json(notFound('외부 연결'));
            return;
        }

        res.json(success(connection));
    } catch (error) {
        logger.error('외부 연결 조회 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

/**
 * PUT /api/external/:connectionId/tokens
 * 연결 토큰 갱신
 */
router.put('/:connectionId/tokens', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectionId } = req.params;
        const { accessToken, refreshToken, expiresAt } = req.body;

        if (!accessToken) {
            res.status(400).json(badRequest('accessToken은 필수입니다'));
            return;
        }

        const db = getUnifiedDatabase();

        const connection = await db.getExternalConnection(connectionId);
        if (!connection) {
            res.status(404).json(notFound('외부 연결'));
            return;
        }
        if (connection.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
            res.status(403).json({ success: false, error: '접근 권한이 없습니다' });
            return;
        }

        await db.updateConnectionTokens(connectionId, {
            accessToken,
            refreshToken,
            expiresAt,
        });

        const updated = await db.getExternalConnection(connectionId);

        logger.info(`외부 연결 토큰 갱신: ${connectionId}`);
        res.json(success(updated));
    } catch (error) {
        logger.error('외부 연결 토큰 갱신 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

/**
 * DELETE /api/external/:serviceType
 * 서비스 연결 해제
 */
router.delete('/:serviceType', requireAuth, async (req: Request, res: Response) => {
    try {
        const { serviceType } = req.params;

        if (!isValidServiceType(serviceType)) {
            res.status(400).json(badRequest(`유효하지 않은 서비스 타입입니다: ${serviceType}`));
            return;
        }

        const db = getUnifiedDatabase();
        const userId = String(req.user!.id);

        const connection = await db.getUserConnectionByService(userId, serviceType);
        if (!connection) {
            res.status(404).json(notFound('외부 연결'));
            return;
        }

        await db.disconnectService(userId, serviceType);

        logger.info(`외부 서비스 연결 해제: ${serviceType} by user ${userId}`);
        res.json(success({ disconnected: true, serviceType }));
    } catch (error) {
        logger.error('외부 서비스 연결 해제 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

/**
 * GET /api/external/:connectionId/files
 * 캐시된 외부 파일 목록 조회
 */
router.get('/:connectionId/files', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectionId } = req.params;
        const db = getUnifiedDatabase();

        const connection = await db.getExternalConnection(connectionId);
        if (!connection) {
            res.status(404).json(notFound('외부 연결'));
            return;
        }
        if (connection.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
            res.status(403).json({ success: false, error: '접근 권한이 없습니다' });
            return;
        }

        const files = await db.getConnectionFiles(connectionId);

        res.json(success(files));
    } catch (error) {
        logger.error('외부 파일 목록 조회 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

/**
 * POST /api/external/:connectionId/files
 * 외부 파일 캐시
 */
router.post('/:connectionId/files', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectionId } = req.params;
        const { externalId, fileName, fileType, fileSize, webUrl, cachedContent } = req.body;

        if (!externalId || !fileName) {
            res.status(400).json(badRequest('externalId와 fileName은 필수입니다'));
            return;
        }

        const db = getUnifiedDatabase();

        const connection = await db.getExternalConnection(connectionId);
        if (!connection) {
            res.status(404).json(notFound('외부 연결'));
            return;
        }
        if (connection.user_id !== String(req.user!.id) && req.user!.role !== 'admin') {
            res.status(403).json({ success: false, error: '접근 권한이 없습니다' });
            return;
        }

        const fileId = uuidv4();

        await db.cacheExternalFile({
            id: fileId,
            connectionId,
            externalId,
            fileName,
            fileType,
            fileSize,
            webUrl,
            cachedContent,
        });

        // cacheExternalFile uses ON CONFLICT — fetch the actual cached file
        const cachedFile = await db.getCachedFile(connectionId, externalId);

        logger.info(`외부 파일 캐시: ${fileName} (connection: ${connectionId})`);
        res.status(201).json(success(cachedFile));
    } catch (error) {
        logger.error('외부 파일 캐시 오류:', error);
        res.status(500).json(internalError(String(error)));
    }
});

export default router;
