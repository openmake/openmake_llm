/**
 * Request ID 미들웨어
 * 
 * 모든 요청에 고유 ID를 부여하여 로깅/추적 지원
 * - 기존 X-Request-Id 헤더가 있으면 재사용 (업스트림 로드밸런서 등)
 * - 없으면 crypto.randomUUID()로 생성
 * - 요청 객체와 응답 헤더 양쪽에 설정
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { runWithRequestContext } from '../utils/request-context';

/**
 * Request ID 생성 및 첨부 미들웨어
 * AsyncLocalStorage 컨텍스트를 열어 하위 서비스에서 getRequestId()로 조회 가능
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const existingId = req.headers['x-request-id'];
    const id = (typeof existingId === 'string' && existingId.length > 0)
        ? existingId
        : crypto.randomUUID();

    req.requestId = id;
    res.setHeader('X-Request-Id', id);

    runWithRequestContext({ requestId: id }, () => next());
}
