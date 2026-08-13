/**
 * ensure-secrets — 부팅 시크릿 자동 생성/영속/멱등 검증 (임시 디렉토리, 무DB).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureBootSecrets } from '../ensure-secrets';

const KEYS = ['JWT_SECRET', 'API_KEY_PEPPER', 'TOKEN_ENCRYPTION_KEY'] as const;

describe('ensureBootSecrets', () => {
    let dir: string;
    let envPath: string;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-secrets-'));
        envPath = path.join(dir, '.env');
        for (const k of KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it('부재 시크릿 3종을 생성해 .env 에 영속하고 process.env 에 주입한다', () => {
        const generated = ensureBootSecrets(envPath);
        expect(generated.sort()).toEqual([...KEYS].sort());

        const content = fs.readFileSync(envPath, 'utf-8');
        for (const k of KEYS) {
            const value = process.env[k];
            expect(value).toMatch(/^[0-9a-f]{64}$/); // 64-hex (openssl rand -hex 32 동등)
            expect(content).toContain(`${k}=${value}`);
        }
    });

    it('멱등 — 두 번째 호출은 no-op 이고 값이 유지된다', () => {
        ensureBootSecrets(envPath);
        const first = KEYS.map((k) => process.env[k]);
        const second = ensureBootSecrets(envPath);
        expect(second).toEqual([]);
        expect(KEYS.map((k) => process.env[k])).toEqual(first);
    });

    it('이미 설정된 키는 건드리지 않고 부재 키만 생성한다', () => {
        process.env.JWT_SECRET = 'existing-jwt-secret';
        const generated = ensureBootSecrets(envPath);
        expect(generated.sort()).toEqual(['API_KEY_PEPPER', 'TOKEN_ENCRYPTION_KEY']);
        expect(process.env.JWT_SECRET).toBe('existing-jwt-secret');
        expect(fs.readFileSync(envPath, 'utf-8')).not.toContain('JWT_SECRET=');
    });

    it('기존 .env 내용을 보존하며 append 한다', () => {
        fs.writeFileSync(envPath, 'PORT=52416\n');
        ensureBootSecrets(envPath);
        const content = fs.readFileSync(envPath, 'utf-8');
        expect(content).toContain('PORT=52416');
        expect(content).toContain('JWT_SECRET=');
    });

    it('영속 실패 시 throw 하고 process.env 를 오염시키지 않는다 (fail-fast)', () => {
        // 디렉토리 경로를 .env 로 넘기면 파일 쓰기가 실패한다
        expect(() => ensureBootSecrets(dir)).toThrow('영속');
        for (const k of KEYS) expect(process.env[k]).toBeUndefined();
    });
});
