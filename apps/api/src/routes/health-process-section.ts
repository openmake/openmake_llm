/**
 * /api/health 의 관리자 전용 process 필드 — 부하 harness(scripts/bench/api-load.mjs)가
 * 같은 프로세스의 RSS 를 바이트 단위로 표본하고, pid 로 측정 중 재시작을 알아챈다.
 * 이 값이 있을 때(관리자)만 /api/health 가 전체 응답(services.memory.rssMB 등)을 준다 — 비관리자는 상태 필드만(W4).
 *
 * 헬스는 DB 장애를 알리려고 있으므로 이 경로는 DB 에 닿지 않는다: 관리자 여부는 서명된 JWT 의
 * role 로만 판단한다(블랙리스트·사용자 조회 없음). 잘못됐거나 만료된 토큰은 게스트로 본다(401·500 없음).
 * 받아들인 대가: 폐기(로그아웃)됐거나 비활성화됐거나 일반 사용자로 강등된 관리자의 만료 전 토큰으로도
 * process 필드(pid·rss·heapUsed·uptimeSec — 민감도 낮음)를 읽을 수 있다 — role 은 토큰이 만료될 때까지
 * 발급 당시 값이다. access 토큰은 단명이라 노출 창이 짧다.
 */
import type { Request } from 'express';
import { extractToken, isAdmin, looksLikeJWT, verifyTokenSignature } from '../auth/auth-core';
import { AUTH_COOKIES } from '../config/security';

export interface HealthProcessSection {
    pid: number;
    rss: number;
    heapUsed: number;
    uptimeSec: number;
}

export function readHealthProcessSection(
    req: Pick<Request, 'cookies' | 'headers'>,
    mem: NodeJS.MemoryUsage = process.memoryUsage(),
): HealthProcessSection | undefined {
    // 쿠키(httpOnly) 우선, 다음 Authorization 헤더 — optionalAuth 와 같은 순서
    const cookieToken: unknown = req.cookies?.[AUTH_COOKIES.ACCESS];
    const token = typeof cookieToken === 'string' && cookieToken ? cookieToken : extractToken(req.headers.authorization);
    if (!token || !looksLikeJWT(token)) return undefined;
    const role = verifyTokenSignature(token)?.role;
    if (!role || !isAdmin(role)) return undefined;
    return { pid: process.pid, rss: mem.rss, heapUsed: mem.heapUsed, uptimeSec: Math.round(process.uptime()) };
}
