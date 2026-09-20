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

function run(req: Partial<Request>): Promise<{ status?: number; body?: { error?: { code?: string } }; nexted: boolean }> {
    return new Promise((resolve) => {
        const out: { status?: number; body?: { error?: { code?: string } }; nexted: boolean } = { nexted: false };
        const res = {
            status(code: number) { out.status = code; return this; },
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

    it('판정이 실패해도 막지 않는다(fail-open)', async () => {
        checkAddonEntitlement.mockRejectedValue(new Error('정책 조회 실패'));
        const r = await run({});
        expect(r.nexted).toBe(true);
    });
});
