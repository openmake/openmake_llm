/**
 * 웹 SSO 클라이언트 허용 목록 — redirect URI 기본값을 두지 않는다(설치마다 주소가 다르다).
 */
describe('SSO_CLIENTS', () => {
    const saved = process.env.SSO_BENCH_REDIRECT_URI;
    afterEach(() => {
        if (saved === undefined) delete process.env.SSO_BENCH_REDIRECT_URI; else process.env.SSO_BENCH_REDIRECT_URI = saved;
        jest.resetModules();
    });

    it('SSO_BENCH_REDIRECT_URI 가 없으면 bench 를 허용 목록에 넣지 않는다', () => {
        delete process.env.SSO_BENCH_REDIRECT_URI;
        jest.isolateModules(() => {
            const { SSO_CLIENTS } = require('../security');
            expect(Object.hasOwn(SSO_CLIENTS, 'bench')).toBe(false);
        });
    });

    it('설정하면 그 주소만 쓴다', () => {
        process.env.SSO_BENCH_REDIRECT_URI = 'https://bench.example.com/api/auth/callback';
        jest.isolateModules(() => {
            const { SSO_CLIENTS } = require('../security');
            expect(SSO_CLIENTS.bench.redirectUri).toBe('https://bench.example.com/api/auth/callback');
        });
    });
});
