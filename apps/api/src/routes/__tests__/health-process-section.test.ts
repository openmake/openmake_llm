import type { Request } from 'express';
import { readHealthProcessSection } from '../health-process-section';

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
