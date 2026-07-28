/**
 * GDPR Phase A Fix 4 단위 테스트 (gitignored — PR description inline).
 *
 * AuthService.register 가 consent_logs INSERT 를 정확히 호출하는지 검증.
 * IP/UA 전달 + consent_logs 2 row (privacy + terms) INSERT.
 */

jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(),
}));
jest.mock('../data/user-manager', () => {
    const actual = jest.requireActual('../data/user-manager');
    return {
        ...actual,
        getUserManager: jest.fn(),
    };
});
jest.mock('../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getAuthService } from '../services/AuthService';
import { getPool } from '../data/models/unified-database';
import { getUserManager } from '../data/user-manager';

describe('AuthService.register — GDPR Phase A Fix 4 (consent_logs)', () => {
    const baseValidData = {
        username: 'tester',
        email: 'test@example.com',
        password: 'StrongP@ss1!',
        agreedToTerms: true,
        agreedToPrivacy: true,
        consentLocale: 'ko',
        consentIp: '1.2.3.4',
        consentUserAgent: 'Mozilla/5.0',
    };

    let mockPoolQuery: jest.Mock;
    let mockCreateUser: jest.Mock;

    beforeEach(() => {
        jest.resetModules();
        mockPoolQuery = jest.fn().mockResolvedValue({});
        (getPool as jest.Mock).mockReturnValue({ query: mockPoolQuery });
        mockCreateUser = jest.fn().mockResolvedValue({
            id: 'user-123',
            username: 'tester',
            email: 'test@example.com',
            role: 'user',
        });
        (getUserManager as jest.Mock).mockReturnValue({
            createUser: mockCreateUser,
        });
    });

    test('정상 register 시 consent_logs INSERT 호출 (privacy + terms 2 row)', async () => {
        const result = await getAuthService().register(baseValidData);
        expect(result.success).toBe(true);

        const insertCall = mockPoolQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO consent_logs')
        );
        expect(insertCall).toBeDefined();
        const sql = insertCall![0] as string;
        expect(sql).toContain('privacy_policy');
        expect(sql).toContain('terms_of_service');
        const params = insertCall![1] as unknown[];
        expect(params[0]).toBe('user-123');  // user_id
        expect(params[2]).toBe('ko');        // consent_locale
        expect(params[3]).toBe('1.2.3.4');   // ip_address
        expect(params[4]).toBe('Mozilla/5.0');  // user_agent
    });

    test('consent_locale 미지정 시 ko 폴백', async () => {
        await getAuthService().register({ ...baseValidData, consentLocale: undefined });
        const insertCall = mockPoolQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO consent_logs')
        );
        expect((insertCall![1] as unknown[])[2]).toBe('ko');
    });

    test('IP/UA 미지정 시 NULL 저장', async () => {
        await getAuthService().register({
            ...baseValidData,
            consentIp: undefined,
            consentUserAgent: undefined,
        });
        const insertCall = mockPoolQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO consent_logs')
        );
        const params = insertCall![1] as unknown[];
        expect(params[3]).toBeNull();
        expect(params[4]).toBeNull();
    });

    test('agreedToTerms=false 시 consent INSERT 안 함 (defensive)', async () => {
        await getAuthService().register({ ...baseValidData, agreedToTerms: false });
        const insertCall = mockPoolQuery.mock.calls.find(
            (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO consent_logs')
        );
        expect(insertCall).toBeUndefined();
    });

    test('consent INSERT 실패 시에도 회원가입 자체는 성공', async () => {
        mockPoolQuery.mockRejectedValueOnce(new Error('simulated DB failure'));
        const result = await getAuthService().register(baseValidData);
        expect(result.success).toBe(true);  // 사용자 영향 최소화 — log.error 만 발생
    });

    // NOTE: "createUser 실패 시 consent INSERT 안 함" 검증은 AuthService 싱글톤 캐싱
    // (line 272) 으로 인해 단위 격리 부담. AuthService.register 코드를 보면
    // user==null 이면 early return 으로 consent INSERT 도달 안 함이 명시 — 테스트
    // 없이도 자명. 통합 테스트 (Phase B 또는 별도) 에서 검증 권장.
});
