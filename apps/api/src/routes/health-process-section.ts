/**
 * /api/health 의 관리자 전용 process 필드 — 부하 harness(scripts/bench/api-load.mjs)가
 * 같은 프로세스의 RSS 를 바이트 단위로 표본하고, pid 로 측정 중 재시작을 알아챈다.
 * 이 값이 있을 때(관리자)만 /api/health 가 전체 응답(services.memory.rssMB 등)을 준다 — 비관리자는 상태 필드·add-on 절만(W4).
 *
 * 헬스는 DB 장애를 알리려고 있으므로 관리자 판정만 DB 를 본다: 서명된 JWT 의 role 이 관리자일 때만
 * getUserById 로 현재 role·is_active 를 다시 확인한다(보안 점검 M-4 — 강등·비활성 관리자의 만료 전 토큰 차단).
 * 블랙리스트는 보지 않는다. 잘못됐거나 만료된 토큰·일반 사용자 토큰은 DB 없이 게스트로 보고, DB 조회 실패·
 * 사용자 없음·비활성·관리자 아님은 모두 비관리자로 본다(축소 응답, 401·500 없음).
 * 받아들인 대가: 폐기(로그아웃)됐지만 만료 전인 관리자 토큰으로도 process 필드(pid·rss·heapUsed·uptimeSec —
 * 민감도 낮음)를 읽을 수 있다. access 토큰은 단명이라 노출 창이 짧다.
 */
import type { Request } from 'express';
import { extractToken, isAdmin, looksLikeJWT, verifyTokenSignature } from '../auth/auth-core';
import { AUTH_COOKIES } from '../config/security';
import { getUserManager } from '../data/user-manager';

export interface HealthProcessSection {
    pid: number;
    rss: number;
    heapUsed: number;
    uptimeSec: number;
}

/** 관리자 요청인지 — /api/health process 필드와 /metrics(METRICS_TOKEN 미설정) 공용. 던지지 않는다. */
export async function isAdminRequest(req: Pick<Request, 'cookies' | 'headers'>): Promise<boolean> {
    // 쿠키(httpOnly) 우선, 다음 Authorization 헤더 — optionalAuth 와 같은 순서
    const cookieToken: unknown = req.cookies?.[AUTH_COOKIES.ACCESS];
    const token = typeof cookieToken === 'string' && cookieToken ? cookieToken : extractToken(req.headers.authorization);
    if (!token || !looksLikeJWT(token)) return false;
    const payload = verifyTokenSignature(token);
    if (!payload?.role || !isAdmin(payload.role)) return false;
    try {
        const user = await getUserManager().getUserById(String(payload.userId));
        return !!user && user.is_active && isAdmin(user.role);
    } catch {
        return false;
    }
}

export async function readHealthProcessSection(
    req: Pick<Request, 'cookies' | 'headers'>,
    mem: NodeJS.MemoryUsage = process.memoryUsage(),
): Promise<HealthProcessSection | undefined> {
    if (!(await isAdminRequest(req))) return undefined;
    return { pid: process.pid, rss: mem.rss, heapUsed: mem.heapUsed, uptimeSec: Math.round(process.uptime()) };
}
