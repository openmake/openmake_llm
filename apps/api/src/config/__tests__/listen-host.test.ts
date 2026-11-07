/**
 * LISTEN_HOST — API 수신 바인드 주소 opt-in(2026-11-07 점검).
 * 미설정이면 종전 동작(0.0.0.0) 그대로, 명시하면 그 값을 쓴다. SERVER_HOST(표시용 URL)와는 별개다.
 */
import { envSchema } from '../env.schema';
import { getConfig, resetConfig } from '../env';

describe('LISTEN_HOST → config.listenHost', () => {
    const ORIGINAL = process.env.LISTEN_HOST;

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.LISTEN_HOST;
        else process.env.LISTEN_HOST = ORIGINAL;
        resetConfig();
    });

    it('스키마는 미설정이면 값을 넣지 않는다(기본값은 env-defaults)', () => {
        const parsed = envSchema.safeParse({ NODE_ENV: 'development' });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.LISTEN_HOST).toBeUndefined();
    });

    it('미설정이면 0.0.0.0', () => {
        delete process.env.LISTEN_HOST;
        resetConfig();
        expect(getConfig().listenHost).toBe('0.0.0.0');
    });

    it('LISTEN_HOST=127.0.0.1 이면 그대로', () => {
        process.env.LISTEN_HOST = '127.0.0.1';
        resetConfig();
        expect(getConfig().listenHost).toBe('127.0.0.1');
    });

    it('SERVER_HOST 는 listenHost 에 영향을 주지 않는다', () => {
        const ORIGINAL_SERVER_HOST = process.env.SERVER_HOST;
        try {
            delete process.env.LISTEN_HOST;
            process.env.SERVER_HOST = 'localhost';
            resetConfig();
            expect(getConfig().listenHost).toBe('0.0.0.0');
            expect(getConfig().serverHost).toBe('localhost');
        } finally {
            if (ORIGINAL_SERVER_HOST === undefined) delete process.env.SERVER_HOST;
            else process.env.SERVER_HOST = ORIGINAL_SERVER_HOST;
        }
    });
});
