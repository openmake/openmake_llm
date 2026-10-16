/**
 * /api/health 의 관리자 전용 process 필드 — 부하 harness(scripts/bench/api-load.mjs)가
 * 같은 프로세스의 RSS 를 바이트 단위로 표본하고, pid 로 측정 중 재시작을 알아챈다.
 * 공개 응답의 services.memory.rssMB(MiB 정수)는 그대로 둔다 — 비관리자 응답은 바뀌지 않는다.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isAdmin } from '../auth/auth-core';
import { createLogger } from '../utils/logger';

const log = createLogger('HealthRoute');

export interface HealthProcessSection {
    pid: number;
    rss: number;
    heapUsed: number;
    uptimeSec: number;
}

export function readHealthProcessSection(
    req: Pick<Request, 'user'>,
    mem: NodeJS.MemoryUsage = process.memoryUsage(),
): HealthProcessSection | undefined {
    const role = req.user?.role;
    if (!role || !isAdmin(role)) return undefined;
    return { pid: process.pid, rss: mem.rss, heapUsed: mem.heapUsed, uptimeSec: Math.round(process.uptime()) };
}

/**
 * /api/health 용 선택 인증 — 쿠키 사용자 조회(DB)가 실패해도 헬스가 500 이 되지 않게 게스트로 계속한다.
 * 헬스는 DB 장애 때 더 필요하다. 인증 미들웨어가 next 를 부르기 전에 실패하면 req.user·req.token 을 비우고
 * 게스트로 넘긴다(관리자 process 필드만 빠진다). next 를 이미 불렀다면 다시 부르지 않는다.
 */
export function guestOnAuthError(auth: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
    return (req, res, next) => {
        let passed = false;
        const once: NextFunction = (err?: unknown) => {
            passed = true;
            next(err);
        };
        auth(req, res, once).catch((e: unknown) => {
            if (passed) return;
            log.warn(`[/api/health] 선택 인증 실패 — 게스트로 응답한다: ${e instanceof Error ? e.message : String(e)}`);
            req.user = undefined;
            req.token = undefined;
            once();
        });
    };
}
