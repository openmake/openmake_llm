import type { NextFunction, Request, Response } from 'express';
import { guestOnAuthError, readHealthProcessSection } from '../health-process-section';

const mem: NodeJS.MemoryUsage = { rss: 123_456, heapUsed: 45_678, heapTotal: 0, external: 0, arrayBuffers: 0 };

// JWT 에서 꺼낸 사용자 모양(AuthUser: userId·role)으로 요청을 흉내 낸다
const adminReq: Pick<Request, 'user'> = { user: { userId: 'bench-admin', role: 'admin' } };
const userReq: Pick<Request, 'user'> = { user: { userId: 'bench-user', role: 'user' } };
const guestReq: Pick<Request, 'user'> = {};

describe('readHealthProcessSection — /api/health 의 관리자 전용 process 필드', () => {
    it('관리자에게는 pid·rss·heapUsed·uptimeSec 를 준다', () => {
        const section = readHealthProcessSection(adminReq, mem);
        expect(section).toEqual({ pid: process.pid, rss: 123_456, heapUsed: 45_678, uptimeSec: expect.any(Number) });
    });

    it('일반 사용자에게는 주지 않는다', () => {
        expect(readHealthProcessSection(userReq, mem)).toBeUndefined();
    });

    it('게스트(인증 없음)에게는 주지 않는다', () => {
        expect(readHealthProcessSection(guestReq, mem)).toBeUndefined();
    });
});

describe('guestOnAuthError — /api/health 의 선택 인증이 DB 오류로 실패해도 500 이 아니라 게스트로 계속한다', () => {
    // 미들웨어가 next 를 부를 때까지 기다린다(오류 경로는 비동기 catch 에서 부른다)
    function run(auth: (req: Request, res: Response, next: NextFunction) => Promise<void>, req: Request) {
        const res = {} as Response;
        const next = jest.fn();
        guestOnAuthError(auth)(req, res, next);
        return new Promise<jest.Mock>((resolve) => { setImmediate(() => resolve(next)); });
    }

    it('사용자 조회가 던지면 req.user·req.token 을 비우고 오류 없이 next() — 관리자 process 필드도 빠진다', async () => {
        const req = { user: { userId: 'u', role: 'admin' }, token: 't' } as unknown as Request;
        const failing = async (): Promise<void> => { throw new Error('connection terminated'); };
        const next = await run(failing, req);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(undefined);
        expect(req.user).toBeUndefined();
        expect(req.token).toBeUndefined();
        expect(readHealthProcessSection(req, mem)).toBeUndefined();
    });

    it('정상 경로는 인증 미들웨어의 next 를 한 번만 넘긴다', async () => {
        const req = {} as Request;
        const ok = async (r: Request, _res: Response, n: NextFunction): Promise<void> => {
            r.user = { userId: 'bench-admin', role: 'admin' };
            n();
        };
        const next = await run(ok, req);
        expect(next).toHaveBeenCalledTimes(1);
        expect(readHealthProcessSection(req, mem)).toEqual(expect.objectContaining({ rss: 123_456 }));
    });

    it('next 를 부른 뒤에 던지면 next 를 다시 부르지 않는다', async () => {
        const late = async (_r: Request, _res: Response, n: NextFunction): Promise<void> => {
            n();
            throw new Error('늦은 오류');
        };
        const next = await run(late, {} as Request);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
