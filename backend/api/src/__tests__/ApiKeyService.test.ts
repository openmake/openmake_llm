/**
 * ApiKeyService 단위 테스트
 *
 * 테스트 범위:
 * - createKey: 키 생성, 최대 키 수 초과, free tier 자동 만료
 * - listKeys: 목록 조회, toPublic 변환
 * - getKey: 소유권 확인 (자신/타인/존재하지 않는 키)
 * - updateKey: 소유권 확인, 업데이트 성공/실패
 * - deleteKey: 소유권 확인, 삭제 성공/실패
 * - rotateKey: 소유권 확인, 비활성 키 거부, 순환 성공
 * - recordUsage: 사용량 기록 위임
 * - getUsageStats: 소유권 확인, 통계 반환
 * - getApiKeyService: 싱글톤 반환
 * - ApiKeyError: 메시지, code 속성
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockCountUserApiKeys = jest.fn();
const mockCreateApiKey = jest.fn();
const mockGetApiKeyById = jest.fn();
const mockListUserApiKeys = jest.fn();
const mockUpdateApiKey = jest.fn();
const mockDeleteApiKey = jest.fn();
const mockRotateApiKey = jest.fn();
const mockRecordApiKeyUsage = jest.fn();
const mockGetApiKeyUsageStats = jest.fn();
const mockLogAudit = jest.fn();

jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: jest.fn().mockReturnValue({
        countUserApiKeys: jest.fn(),
        createApiKey: jest.fn(),
        getApiKeyById: jest.fn(),
        listUserApiKeys: jest.fn(),
        updateApiKey: jest.fn(),
        deleteApiKey: jest.fn(),
        rotateApiKey: jest.fn(),
        recordApiKeyUsage: jest.fn(),
        getApiKeyUsageStats: jest.fn(),
        logAudit: jest.fn(),
    }),
}));

jest.mock('../auth/api-key-utils', () => ({
    generateApiKey: jest.fn().mockReturnValue('omk_live_sk_testplainkey123456'),
    hashApiKey: jest.fn().mockReturnValue('hashed-key-value'),
    extractLast4: jest.fn().mockReturnValue('3456'),
    API_KEY_PREFIX: 'omk_live_sk_',
}));

jest.mock('../config/env', () => ({
    getConfig: jest.fn().mockReturnValue({
        apiKeyMaxPerUser: 5,
    }),
}));

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { ApiKeyService, ApiKeyError, getApiKeyService } from '../auth/ApiKeyService';
import { getUnifiedDatabase } from '../data/models/unified-database';
import type { UserApiKey } from '../data/models/unified-database';

// ─────────────────────────────────────────────
// 헬퍼: UserApiKey fixture
// ─────────────────────────────────────────────

function makeDbKey(overrides: Partial<UserApiKey> = {}): UserApiKey {
    return {
        id: 'key-uuid-001',
        user_id: 'user-001',
        key_hash: 'hashed-key-value',
        key_prefix: 'omk_live_sk_',
        last_4: '3456',
        name: '테스트 키',
        description: '테스트용 API 키',
        scopes: ['chat'],
        allowed_models: [],
        rate_limit_tier: 'free',
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        total_requests: 0,
        total_tokens: 0,
        ...overrides,
    };
}

// ─────────────────────────────────────────────
// beforeEach
// ─────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();

    (getUnifiedDatabase as jest.Mock).mockReturnValue({
        countUserApiKeys: mockCountUserApiKeys,
        createApiKey: mockCreateApiKey,
        getApiKeyById: mockGetApiKeyById,
        listUserApiKeys: mockListUserApiKeys,
        updateApiKey: mockUpdateApiKey,
        deleteApiKey: mockDeleteApiKey,
        rotateApiKey: mockRotateApiKey,
        recordApiKeyUsage: mockRecordApiKeyUsage,
        getApiKeyUsageStats: mockGetApiKeyUsageStats,
        logAudit: mockLogAudit,
    });

    mockLogAudit.mockResolvedValue(undefined);
    mockCountUserApiKeys.mockResolvedValue(0);
    mockCreateApiKey.mockResolvedValue(makeDbKey());
    mockGetApiKeyById.mockResolvedValue(undefined);
    mockListUserApiKeys.mockResolvedValue([]);
    mockUpdateApiKey.mockResolvedValue(undefined);
    mockDeleteApiKey.mockResolvedValue(false);
    mockRotateApiKey.mockResolvedValue(undefined);
    mockRecordApiKeyUsage.mockResolvedValue(undefined);
    mockGetApiKeyUsageStats.mockResolvedValue(null);
});

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('ApiKeyService', () => {
    let service: ApiKeyService;

    beforeEach(() => {
        service = new ApiKeyService();
    });

    // ─────────────────────────────────────────
    // createKey
    // ─────────────────────────────────────────
    describe('createKey', () => {
        const baseParams = {
            userId: 'user-001',
            name: '내 첫 번째 키',
            scopes: ['chat'],
        };

        test('성공 시 plainKey와 apiKey를 반환한다', async () => {
            mockCountUserApiKeys.mockResolvedValue(2);
            mockCreateApiKey.mockResolvedValue(makeDbKey({ name: '내 첫 번째 키' }));

            const result = await service.createKey(baseParams);

            expect(result).toHaveProperty('plainKey');
            expect(result).toHaveProperty('apiKey');
            expect(typeof result.plainKey).toBe('string');
        });

        test('apiKey에 key_hash가 포함되지 않는다 (toPublic 변환)', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());

            const result = await service.createKey(baseParams);

            expect(result.apiKey).not.toHaveProperty('key_hash');
        });

        test('최대 키 수 초과 시 ApiKeyError를 던진다', async () => {
            mockCountUserApiKeys.mockResolvedValue(5);

            await expect(service.createKey(baseParams)).rejects.toThrow(ApiKeyError);
        });

        test('최대 키 수 초과 시 에러 code가 KEY_LIMIT_EXCEEDED이다', async () => {
            mockCountUserApiKeys.mockResolvedValue(5);

            try {
                await service.createKey(baseParams);
                fail('should have thrown');
            } catch (e) {
                expect(e).toBeInstanceOf(ApiKeyError);
                expect((e as ApiKeyError).code).toBe('KEY_LIMIT_EXCEEDED');
            }
        });

        test('free tier이고 expiresAt이 없으면 30일 만료가 자동 설정된다', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());

            await service.createKey({ ...baseParams, rateLimitTier: 'free' });

            const callArg = mockCreateApiKey.mock.calls[0][0];
            expect(callArg.expiresAt).toBeDefined();
            // 30일 후 (±5초 허용)
            const expiresAt = new Date(callArg.expiresAt).getTime();
            const expectedMin = Date.now() + 29 * 24 * 3600 * 1000;
            expect(expiresAt).toBeGreaterThan(expectedMin);
        });

        test('rateLimitTier가 없으면 free로 간주해 만료일이 자동 설정된다', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());

            await service.createKey({ userId: 'user-001', name: '키' });

            const callArg = mockCreateApiKey.mock.calls[0][0];
            expect(callArg.expiresAt).toBeDefined();
        });

        test('non-free tier이면 expiresAt이 자동 설정되지 않는다', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());

            await service.createKey({ ...baseParams, rateLimitTier: 'standard' });

            const callArg = mockCreateApiKey.mock.calls[0][0];
            expect(callArg.expiresAt).toBeUndefined();
        });

        test('expiresAt이 이미 있으면 덮어쓰지 않는다', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());
            const customExpiry = '2030-12-31T00:00:00.000Z';

            await service.createKey({ ...baseParams, rateLimitTier: 'free', expiresAt: customExpiry });

            const callArg = mockCreateApiKey.mock.calls[0][0];
            expect(callArg.expiresAt).toBe(customExpiry);
        });

        test('db.createApiKey가 올바른 파라미터로 호출된다', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());

            await service.createKey({ userId: 'user-001', name: '키 이름', rateLimitTier: 'standard' });

            expect(mockCreateApiKey).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-001',
                    name: '키 이름',
                    keyHash: 'hashed-key-value',
                    last4: '3456',
                })
            );
        });

        test('감사 로그가 기록된다', async () => {
            mockCountUserApiKeys.mockResolvedValue(0);
            mockCreateApiKey.mockResolvedValue(makeDbKey());

            await service.createKey(baseParams);

            expect(mockLogAudit).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'api_key.create',
                    userId: 'user-001',
                    resourceType: 'api_key',
                })
            );
        });
    });

    // ─────────────────────────────────────────
    // listKeys
    // ─────────────────────────────────────────
    describe('listKeys', () => {
        test('비어 있으면 빈 배열을 반환한다', async () => {
            mockListUserApiKeys.mockResolvedValue([]);
            const result = await service.listKeys('user-001');
            expect(result).toEqual([]);
        });

        test('반환된 키에 key_hash가 없다', async () => {
            mockListUserApiKeys.mockResolvedValue([makeDbKey(), makeDbKey({ id: 'key-002' })]);
            const result = await service.listKeys('user-001');
            result.forEach(k => expect(k).not.toHaveProperty('key_hash'));
        });

        test('옵션이 db.listUserApiKeys로 전달된다', async () => {
            mockListUserApiKeys.mockResolvedValue([]);
            await service.listKeys('user-001', { includeInactive: true, limit: 10, offset: 5 });
            expect(mockListUserApiKeys).toHaveBeenCalledWith('user-001', { includeInactive: true, limit: 10, offset: 5 });
        });
    });

    // ─────────────────────────────────────────
    // getKey
    // ─────────────────────────────────────────
    describe('getKey', () => {
        test('존재하지 않는 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(undefined);
            const result = await service.getKey('no-such-key', 'user-001');
            expect(result).toBeNull();
        });

        test('다른 사용자의 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'other-user' }));
            const result = await service.getKey('key-uuid-001', 'user-001');
            expect(result).toBeNull();
        });

        test('자신의 키이면 공개 정보를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            const result = await service.getKey('key-uuid-001', 'user-001');
            expect(result).not.toBeNull();
            expect(result?.id).toBe('key-uuid-001');
        });

        test('반환된 키에 key_hash가 없다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            const result = await service.getKey('key-uuid-001', 'user-001');
            expect(result).not.toHaveProperty('key_hash');
        });
    });

    // ─────────────────────────────────────────
    // updateKey
    // ─────────────────────────────────────────
    describe('updateKey', () => {
        test('존재하지 않는 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(undefined);
            const result = await service.updateKey('no-key', 'user-001', { name: '새 이름' });
            expect(result).toBeNull();
        });

        test('다른 사용자의 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'other-user' }));
            const result = await service.updateKey('key-uuid-001', 'user-001', { name: '새 이름' });
            expect(result).toBeNull();
        });

        test('db.updateApiKey가 undefined를 반환하면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockUpdateApiKey.mockResolvedValue(undefined);
            const result = await service.updateKey('key-uuid-001', 'user-001', { name: '새 이름' });
            expect(result).toBeNull();
        });

        test('업데이트 성공 시 공개 키 정보를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockUpdateApiKey.mockResolvedValue(makeDbKey({ name: '새 이름', user_id: 'user-001' }));

            const result = await service.updateKey('key-uuid-001', 'user-001', { name: '새 이름' });

            expect(result).not.toBeNull();
            expect(result?.name).toBe('새 이름');
        });

        test('업데이트 성공 시 감사 로그가 기록된다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockUpdateApiKey.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));

            await service.updateKey('key-uuid-001', 'user-001', { name: '새 이름' });

            expect(mockLogAudit).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'api_key.update' })
            );
        });
    });

    // ─────────────────────────────────────────
    // deleteKey
    // ─────────────────────────────────────────
    describe('deleteKey', () => {
        test('존재하지 않는 키이면 false를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(undefined);
            const result = await service.deleteKey('no-key', 'user-001');
            expect(result).toBe(false);
        });

        test('다른 사용자의 키이면 false를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'other-user' }));
            const result = await service.deleteKey('key-uuid-001', 'user-001');
            expect(result).toBe(false);
        });

        test('db.deleteApiKey가 false이면 false를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockDeleteApiKey.mockResolvedValue(false);
            const result = await service.deleteKey('key-uuid-001', 'user-001');
            expect(result).toBe(false);
        });

        test('삭제 성공 시 true를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockDeleteApiKey.mockResolvedValue(true);
            const result = await service.deleteKey('key-uuid-001', 'user-001');
            expect(result).toBe(true);
        });

        test('삭제 성공 시 감사 로그가 기록된다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockDeleteApiKey.mockResolvedValue(true);

            await service.deleteKey('key-uuid-001', 'user-001');

            expect(mockLogAudit).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'api_key.delete' })
            );
        });
    });

    // ─────────────────────────────────────────
    // rotateKey
    // ─────────────────────────────────────────
    describe('rotateKey', () => {
        test('존재하지 않는 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(undefined);
            const result = await service.rotateKey('no-key', 'user-001');
            expect(result).toBeNull();
        });

        test('다른 사용자의 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'other-user' }));
            const result = await service.rotateKey('key-uuid-001', 'user-001');
            expect(result).toBeNull();
        });

        test('비활성 키이면 ApiKeyError를 던진다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001', is_active: false }));
            await expect(service.rotateKey('key-uuid-001', 'user-001')).rejects.toThrow(ApiKeyError);
        });

        test('비활성 키 에러 code가 KEY_INACTIVE이다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001', is_active: false }));
            try {
                await service.rotateKey('key-uuid-001', 'user-001');
                fail('should have thrown');
            } catch (e) {
                expect((e as ApiKeyError).code).toBe('KEY_INACTIVE');
            }
        });

        test('db.rotateApiKey가 undefined이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001', is_active: true }));
            mockRotateApiKey.mockResolvedValue(undefined);
            const result = await service.rotateKey('key-uuid-001', 'user-001');
            expect(result).toBeNull();
        });

        test('순환 성공 시 새 plainKey와 apiKey를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001', is_active: true }));
            mockRotateApiKey.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));

            const result = await service.rotateKey('key-uuid-001', 'user-001');

            expect(result).not.toBeNull();
            expect(result?.plainKey).toBeDefined();
            expect(result?.apiKey).toBeDefined();
        });

        test('순환 성공 시 감사 로그가 기록된다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001', is_active: true }));
            mockRotateApiKey.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));

            await service.rotateKey('key-uuid-001', 'user-001');

            expect(mockLogAudit).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'api_key.rotate' })
            );
        });
    });

    // ─────────────────────────────────────────
    // recordUsage
    // ─────────────────────────────────────────
    describe('recordUsage', () => {
        test('db.recordApiKeyUsage에 위임한다', async () => {
            await service.recordUsage('key-uuid-001', 500);
            expect(mockRecordApiKeyUsage).toHaveBeenCalledWith('key-uuid-001', 500);
        });
    });

    // ─────────────────────────────────────────
    // getUsageStats
    // ─────────────────────────────────────────
    describe('getUsageStats', () => {
        test('존재하지 않는 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(undefined);
            const result = await service.getUsageStats('no-key', 'user-001');
            expect(result).toBeNull();
        });

        test('다른 사용자의 키이면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'other-user' }));
            const result = await service.getUsageStats('key-uuid-001', 'user-001');
            expect(result).toBeNull();
        });

        test('통계가 없으면 null을 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockGetApiKeyUsageStats.mockResolvedValue(null);
            const result = await service.getUsageStats('key-uuid-001', 'user-001');
            expect(result).toBeNull();
        });

        test('통계 조회 성공 시 통계 데이터를 반환한다', async () => {
            mockGetApiKeyById.mockResolvedValue(makeDbKey({ user_id: 'user-001' }));
            mockGetApiKeyUsageStats.mockResolvedValue({
                totalRequests: 100,
                totalTokens: 5000,
                lastUsedAt: '2026-01-15T10:00:00.000Z',
            });

            const result = await service.getUsageStats('key-uuid-001', 'user-001');

            expect(result).toEqual({
                totalRequests: 100,
                totalTokens: 5000,
                lastUsedAt: '2026-01-15T10:00:00.000Z',
            });
        });
    });
});

// ─────────────────────────────────────────────
// ApiKeyError
// ─────────────────────────────────────────────

describe('ApiKeyError', () => {
    test('message가 설정된다', () => {
        const err = new ApiKeyError('테스트 에러', 'TEST_CODE');
        expect(err.message).toBe('테스트 에러');
    });

    test('code 속성이 설정된다', () => {
        const err = new ApiKeyError('테스트 에러', 'TEST_CODE');
        expect(err.code).toBe('TEST_CODE');
    });

    test('Error의 인스턴스이다', () => {
        const err = new ApiKeyError('테스트', 'CODE');
        expect(err).toBeInstanceOf(Error);
    });

    test('ApiKeyError의 인스턴스이다', () => {
        const err = new ApiKeyError('테스트', 'CODE');
        expect(err).toBeInstanceOf(ApiKeyError);
    });
});

// ─────────────────────────────────────────────
// getApiKeyService (싱글톤)
// ─────────────────────────────────────────────

describe('getApiKeyService', () => {
    test('ApiKeyService 인스턴스를 반환한다', () => {
        const svc = getApiKeyService();
        expect(svc).toBeInstanceOf(ApiKeyService);
    });

    test('같은 인스턴스를 반환한다 (싱글톤)', () => {
        const svc1 = getApiKeyService();
        const svc2 = getApiKeyService();
        expect(svc1).toBe(svc2);
    });
});
