/**
 * add-on 라우트 게이트의 **배선** (2026-09-20 라이브 검증에서 발견한 결함의 회귀 테스트).
 *
 * 결함: 게이트는 add-on 라우터의 자체 인증보다 먼저 돌고 앱에는 전역 인증 미들웨어가 없어, `req.user` 가
 * 늘 비어 있었다 → 조직 사용권 축이 통째로 건너뛰어져 allowlist 밖 add-on 이 403 이 아니라 200 이었다.
 * 판정 서비스(`entitlement.test.ts`)만 mock 한 단위 테스트로는 이 배선 누락이 보이지 않았다.
 */
import type { NextFunction, Request, Response } from 'express';

const checkAddonEntitlement = jest.fn();
jest.mock('../../services/addon/entitlement', () => ({ checkAddonEntitlement: (...a: unknown[]) => checkAddonEntitlement(...a) }));

const optionalAuth = jest.fn();
jest.mock('../../auth', () => ({ optionalAuth: (...a: unknown[]) => optionalAuth(...a) }));

import { addonGuard } from '../routes';

function run(req: Partial<Request>): Promise<{ status?: number; body?: { error?: { code?: string } }; headers: Record<string, string>; nexted: boolean }> {
    return new Promise((resolve) => {
        const out: { status?: number; body?: { error?: { code?: string } }; headers: Record<string, string>; nexted: boolean } = { headers: {}, nexted: false };
        const res = {
            status(code: number) { out.status = code; return this; },
            set(name: string, value: string) { out.headers[name] = value; return this; },
            json(body: { error?: { code?: string } }) { out.body = body; resolve(out); return this; },
        } as unknown as Response;
        const next: NextFunction = () => { out.nexted = true; resolve(out); };
        addonGuard('deep-research')(req as Request, res, next);
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    // 실제 optionalAuth 처럼 쿠키의 사용자를 req.user 에 채우고 통과시킨다
    optionalAuth.mockImplementation(async (req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { user: { id: string } }).user = { id: '3' };
        next();
    });
});

describe('addonGuard', () => {
    it('인증 문맥이 없으면 먼저 채운 뒤 **그 사용자로** 사용권을 판정한다', async () => {
        checkAddonEntitlement.mockResolvedValue('not-entitled');

        const r = await run({});

        expect(optionalAuth).toHaveBeenCalledTimes(1);
        expect(checkAddonEntitlement).toHaveBeenCalledWith('deep-research', '3');
        expect(r.status).toBe(403);
        expect(r.body?.error?.code).toBe('ADDON_NOT_ENTITLED');
        expect(r.nexted).toBe(false);
    });

    it('앞선 인증이 이미 채운 문맥(v1 라우터)은 다시 인증하지 않는다', async () => {
        checkAddonEntitlement.mockResolvedValue('ok');

        const r = await run({ user: { id: '7' } } as unknown as Partial<Request>);

        expect(optionalAuth).not.toHaveBeenCalled();
        expect(checkAddonEntitlement).toHaveBeenCalledWith('deep-research', '7');
        expect(r.nexted).toBe(true);
    });

    it('꺼진 add-on 은 404 ADDON_DISABLED', async () => {
        checkAddonEntitlement.mockResolvedValue('disabled');
        const r = await run({});
        expect(r.status).toBe(404);
        expect(r.body?.error?.code).toBe('ADDON_DISABLED');
    });

    it('비로그인 요청은 조직 축 없이 판정하고 통과시킨다(인증은 add-on 라우터의 몫)', async () => {
        optionalAuth.mockImplementation(async (_req: Request, _res: Response, next: NextFunction) => { next(); });
        checkAddonEntitlement.mockResolvedValue('ok');

        const r = await run({});

        expect(checkAddonEntitlement).toHaveBeenCalledWith('deep-research', undefined);
        expect(r.nexted).toBe(true);
    });

    it('optionalAuth 가 reject 해도 멈추지 않고 사용자 없이 판정한다', async () => {
        optionalAuth.mockRejectedValue(new Error('토큰 검증 중 DB 장애'));
        checkAddonEntitlement.mockResolvedValue('ok');

        const r = await run({});

        expect(checkAddonEntitlement).toHaveBeenCalledWith('deep-research', undefined);
        expect(r.nexted).toBe(true);
    });

    it('상태를 확인하지 못하면 503 ADDON_STATE_UNKNOWN + Retry-After (꺼짐 404 와 구분)', async () => {
        checkAddonEntitlement.mockResolvedValue('state-unknown');
        const r = await run({});
        expect(r.status).toBe(503);
        expect(r.body?.error?.code).toBe('ADDON_STATE_UNKNOWN');
        expect(r.headers['Retry-After']).toBe('5');
        expect(r.nexted).toBe(false);
    });

    it('부팅에 실패한 add-on 은 503 ADDON_FAILED — Retry-After 없음(관리자 조치 필요)', async () => {
        checkAddonEntitlement.mockResolvedValue('failed');
        const r = await run({});
        expect(r.status).toBe(503);
        expect(r.body?.error?.code).toBe('ADDON_FAILED');
        expect(r.headers['Retry-After']).toBeUndefined();
        expect(r.nexted).toBe(false);
    });

    it('판정 함수가 던져도 통과시키지 않는다 — 503 ADDON_STATE_UNKNOWN', async () => {
        checkAddonEntitlement.mockRejectedValue(new Error('정책 조회 실패'));
        const r = await run({});
        expect(r.status).toBe(503);
        expect(r.body?.error?.code).toBe('ADDON_STATE_UNKNOWN');
        expect(r.nexted).toBe(false);
    });
});
