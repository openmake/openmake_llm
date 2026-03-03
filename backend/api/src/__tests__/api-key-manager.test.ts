const mockGetConfig = jest.fn();
const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock('../config/env', () => ({
    getConfig: () => mockGetConfig(),
}));

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

jest.mock('../data/models/unified-database', () => ({
    getPool: () => ({
        query: mockQuery,
    }),
}));

import { ApiKeyManager, resetApiKeyManager, getApiKeyManager } from '../ollama/api-key-manager';

type EnvConfig = {
    ollamaDefaultModel: string;
    ollamaModels: string[];
    ollamaSshKey: string | undefined;
    ollamaApiKeyPrimary: string | undefined;
    ollamaApiKeySecondary: string | undefined;
    ollamaApiKey: string | undefined;
};

const baseConfig: EnvConfig = {
    ollamaDefaultModel: 'llama3',
    ollamaModels: [],
    ollamaSshKey: undefined,
    ollamaApiKeyPrimary: undefined,
    ollamaApiKeySecondary: undefined,
    ollamaApiKey: undefined,
};

function clearApiKeyEnvVars(): void {
    for (const key of Object.keys(process.env)) {
        if (/^OLLAMA_API_KEY_\d+$/.test(key)) {
            delete process.env[key];
        }
    }
}

describe('ApiKeyManager', () => {
    beforeEach(() => {
        clearApiKeyEnvVars();
        process.env.OLLAMA_API_KEY_1 = '';
        delete process.env.OLLAMA_API_KEY_1;

        mockGetConfig.mockReset();
        mockGetConfig.mockReturnValue({ ...baseConfig });

        mockQuery.mockClear();
        mockQuery.mockResolvedValue({ rows: [] });

        resetApiKeyManager();
    });

    afterEach(() => {
        clearApiKeyEnvVars();
        resetApiKeyManager();
    });

    describe('constructor', () => {
        test('빈 키 목록으로 초기화 (config.keys 없음, 환경변수도 없음)', () => {
            const manager = new ApiKeyManager();

            expect(manager.getTotalKeys()).toBe(0);
            expect(manager.hasValidKey()).toBe(false);
            expect(manager.getCurrentKey()).toBe('');
            expect(manager.getCurrentModel()).toBe('llama3');
            expect(manager.getSshKey()).toBeUndefined();
        });

        test('config.keys로 초기화 (config.keys=[\'key1\',\'key2\'])', () => {
            const manager = new ApiKeyManager({ keys: ['key1', 'key2'] });

            expect(manager.getTotalKeys()).toBe(2);
            expect(manager.getCurrentKey()).toBe('key1');
            expect(manager.getCurrentKeyIndex()).toBe(0);
            expect(manager.hasValidKey()).toBe(true);
        });

        test('빈 문자열 키는 무시됨', () => {
            const manager = new ApiKeyManager({ keys: ['key1', '   ', '', 'key2'] });

            expect(manager.getTotalKeys()).toBe(2);
            expect(manager.getKeyByIndex(0)).toBe('key1');
            expect(manager.getKeyByIndex(1)).toBe('key2');
        });

        test('config.models와 매핑됨', () => {
            const manager = new ApiKeyManager({
                keys: ['key1', 'key2'],
                models: ['model-a', 'model-b'],
                sshKey: 'test-ssh-key',
            });

            expect(manager.getCurrentModel()).toBe('model-a');
            expect(manager.getKeyByIndex(1)).toBe('key2');
            expect(manager.getSshKey()).toBe('test-ssh-key');
        });
    });

    describe('getCurrentKey / getCurrentModel', () => {
        test('키 없을 때 빈 문자열 반환', () => {
            const manager = new ApiKeyManager({ keys: [] });

            expect(manager.getCurrentKey()).toBe('');
        });

        test('현재 인덱스의 키/모델 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'], models: ['m1', 'm2'] });

            manager.setKeyIndex(1);

            expect(manager.getCurrentKey()).toBe('k2');
            expect(manager.getCurrentModel()).toBe('m2');
        });

        test('models 배열이 짧으면 ollamaDefaultModel 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'], models: ['m1'] });

            manager.setKeyIndex(1);

            expect(manager.getCurrentModel()).toBe('llama3');
        });
    });

    describe('hasValidKey / getTotalKeys', () => {
        test('키 없으면 hasValidKey = false', () => {
            const manager = new ApiKeyManager({ keys: [] });

            expect(manager.hasValidKey()).toBe(false);
        });

        test('키 있으면 hasValidKey = true', () => {
            const manager = new ApiKeyManager({ keys: ['k1'] });

            expect(manager.hasValidKey()).toBe(true);
        });

        test('getTotalKeys 정확한 개수 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });

            expect(manager.getTotalKeys()).toBe(3);
        });
    });

    // getKeyModelPair / getAllKeyModelPairs 테스트 제거됨 (메서드 제거됨 → getNextAvailableKey로 대체)

    describe('getAuthHeaders / getAuthHeadersForIndex', () => {
        test('키 없으면 빈 객체', () => {
            const manager = new ApiKeyManager({ keys: [] });

            expect(manager.getAuthHeaders()).toEqual({});
        });

        test('키 있으면 Authorization Bearer 헤더', () => {
            const manager = new ApiKeyManager({ keys: ['secret-key'] });

            expect(manager.getAuthHeaders()).toEqual({ Authorization: 'Bearer secret-key' });
            expect(manager.getAuthHeadersForIndex(0)).toEqual({ Authorization: 'Bearer secret-key' });
        });

        test('범위 밖 인덱스는 빈 객체', () => {
            const manager = new ApiKeyManager({ keys: ['k1'] });

            expect(manager.getAuthHeadersForIndex(-1)).toEqual({});
            expect(manager.getAuthHeadersForIndex(1)).toEqual({});
        });
    });

    describe('reportSuccess', () => {
        test('failureCount 리셋', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.reportFailure();
            expect(manager.getStatus().failures).toBe(1);

            manager.reportSuccess();
            expect(manager.getStatus().failures).toBe(0);
        });

        test('현재 키 실패 기록 삭제 (간접 검증: getStatus)', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.reportFailure();
            expect(manager.getStatus().keyStatuses[0].failCount).toBe(1);

            manager.reportSuccess();
            expect(manager.getStatus().keyStatuses[0].failCount).toBe(0);
            expect(manager.getStatus().keyStatuses[0].lastFail).toBeNull();
        });
    });

    describe('reportFailure / rotation', () => {
        test('단일 키: 실패해도 로테이션 없음 (false 반환)', () => {
            const manager = new ApiKeyManager({ keys: ['single-key'] });

            const rotated = manager.reportFailure();

            expect(rotated).toBe(false);
            expect(manager.getCurrentKeyIndex()).toBe(0);
            expect(manager.getStatus().failures).toBe(1);
        });

        test('2개 키: 2회 실패 후 로테이션 (true 반환, currentKeyIndex 변경)', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            expect(manager.reportFailure()).toBe(false);
            expect(manager.getCurrentKeyIndex()).toBe(0);

            expect(manager.reportFailure()).toBe(true);
            expect(manager.getStatus().activeKeyIndex).toBe(1);
        });

        test('인증 에러(401/403/429) 첫 번째 실패에도 즉시 로테이션', () => {
            const manager401 = new ApiKeyManager({ keys: ['k1', 'k2'] });
            expect(manager401.reportFailure({ response: { status: 401 } })).toBe(true);
            expect(manager401.getCurrentKeyIndex()).toBe(1);

            const manager403 = new ApiKeyManager({ keys: ['k1', 'k2'] });
            expect(manager403.reportFailure({ response: { status: 403 } })).toBe(true);
            expect(manager403.getCurrentKeyIndex()).toBe(1);

            const manager429 = new ApiKeyManager({ keys: ['k1', 'k2'] });
            expect(manager429.reportFailure({ response: { status: 429 } })).toBe(true);
            expect(manager429.getCurrentKeyIndex()).toBe(1);
        });

        test('로테이션 후 failureCount 리셋', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.reportFailure();
            expect(manager.getStatus().failures).toBe(1);

            manager.reportFailure();
            expect(manager.getStatus().failures).toBe(0);
        });
    });

    describe('reset', () => {
        test('currentKeyIndex 0으로, failureCount 0으로, lastFailover null로 초기화', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.setKeyIndex(1);
            manager.reportFailure();
            manager.reportFailure();

            const beforeReset = manager.getStatus();
            expect(beforeReset.activeKeyIndex).toBeGreaterThanOrEqual(0);
            expect(beforeReset.lastFailover).toBeInstanceOf(Date);

            manager.reset();

            const afterReset = manager.getStatus();
            expect(afterReset.activeKeyIndex).toBe(0);
            expect(afterReset.failures).toBe(0);
            expect(afterReset.lastFailover).toBeNull();
            expect(afterReset.keyStatuses.every(status => status.failCount === 0 && status.lastFail === null)).toBe(true);
        });
    });

    describe('setKeyIndex', () => {
        test('유효 인덱스로 전환 성공', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });

            expect(manager.setKeyIndex(2)).toBe(true);
            expect(manager.getCurrentKeyIndex()).toBe(2);
            expect(manager.getStatus().failures).toBe(0);
        });

        test('범위 밖 인덱스는 false 반환, 인덱스 변경 없음', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            expect(manager.setKeyIndex(5)).toBe(false);
            expect(manager.getCurrentKeyIndex()).toBe(0);
        });
    });

    describe('getNextResetTime / isAllKeysExhausted / getKeysInCooldownCount', () => {
        test('키 없으면 getNextResetTime null', () => {
            const manager = new ApiKeyManager({ keys: [] });

            expect(manager.getNextResetTime()).toBeNull();
            expect(manager.isAllKeysExhausted()).toBe(false);
            expect(manager.getKeysInCooldownCount()).toBe(0);
        });

        test('실패 기록 없으면 null (사용 가능한 키 있음)', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            expect(manager.getNextResetTime()).toBeNull();
            expect(manager.isAllKeysExhausted()).toBe(false);
            expect(manager.getKeysInCooldownCount()).toBe(0);
        });

        test('모든 키 쿨다운 중이면 Date 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.reportFailure({ response: { status: 401 } });
            manager.reportFailure({ response: { status: 401 } });

            const nextReset = manager.getNextResetTime();
            expect(nextReset).toBeInstanceOf(Date);
            expect(manager.getKeysInCooldownCount()).toBe(2);
        });

        test('isAllKeysExhausted는 getNextResetTime !== null과 동일', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.reportFailure({ response: { status: 401 } });
            manager.reportFailure({ response: { status: 401 } });

            expect(manager.isAllKeysExhausted()).toBe(manager.getNextResetTime() !== null);
        });
    });

    describe('getStatus', () => {
        test('초기 상태 정확히 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'], models: ['m1'] });

            expect(manager.getStatus()).toEqual({
                activeKeyIndex: 0,
                totalKeys: 2,
                failures: 0,
                lastFailover: null,
                keyStatuses: [
                    { index: 0, model: 'm1', failCount: 0, lastFail: null },
                    { index: 1, model: 'llama3', failCount: 0, lastFail: null },
                ],
            });
        });

        test('실패 후 상태 업데이트 반영', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });

            manager.reportFailure();

            const status = manager.getStatus();
            expect(status.failures).toBe(1);
            expect(status.keyStatuses[0].failCount).toBe(1);
            expect(status.keyStatuses[0].lastFail).toBeInstanceOf(Date);
        });
    });

    describe('싱글톤 관리 (getApiKeyManager / resetApiKeyManager)', () => {
        test('resetApiKeyManager 후 getApiKeyManager 새 인스턴스 반환', () => {
            const first = getApiKeyManager();

            resetApiKeyManager();

            const second = getApiKeyManager();
            expect(second).not.toBe(first);
        });

        test('연속 getApiKeyManager 호출은 동일 인스턴스', () => {
            const first = getApiKeyManager();
            const second = getApiKeyManager();

            expect(second).toBe(first);
        });
    });

    describe('환경변수에서 키 로드 (loadKeysFromEnv)', () => {
        test('OLLAMA_API_KEY_1, _2 환경변수에서 로드', () => {
            process.env.OLLAMA_API_KEY_1 = 'test-key-1';
            process.env.OLLAMA_API_KEY_2 = 'test-key-2';

            const manager = new ApiKeyManager();

            expect(manager.getTotalKeys()).toBe(2);
            expect(manager.getKeyByIndex(0)).toBe('test-key-1');
            expect(manager.getKeyByIndex(1)).toBe('test-key-2');
        });

        test('숫자 순서 정렬됨', () => {
            process.env.OLLAMA_API_KEY_10 = 'key-10';
            process.env.OLLAMA_API_KEY_2 = 'key-2';
            process.env.OLLAMA_API_KEY_1 = 'key-1';

            const manager = new ApiKeyManager();

            expect(manager.getTotalKeys()).toBe(3);
            expect(manager.getKeyByIndex(0)).toBe('key-1');
            expect(manager.getKeyByIndex(1)).toBe('key-2');
            expect(manager.getKeyByIndex(2)).toBe('key-10');
        });

        test('빈 값 무시됨', () => {
            process.env.OLLAMA_API_KEY_1 = 'valid-key';
            process.env.OLLAMA_API_KEY_2 = '   ';
            process.env.OLLAMA_API_KEY_3 = '';

            const manager = new ApiKeyManager();

            expect(manager.getTotalKeys()).toBe(1);
            expect(manager.getKeyByIndex(0)).toBe('valid-key');
        });
    });

    describe('getNextAvailableKey (키풀 라운드로빈)', () => {
        test('키 없으면 -1 반환', () => {
            const manager = new ApiKeyManager({ keys: [] });
            expect(manager.getNextAvailableKey()).toBe(-1);
        });

        test('첣 호출: 인덱스 0 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });
            expect(manager.getNextAvailableKey()).toBe(0);
        });

        test('연속 호출 시 라운드로빈 순환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });
            expect(manager.getNextAvailableKey()).toBe(0);
            expect(manager.getNextAvailableKey()).toBe(1);
            expect(manager.getNextAvailableKey()).toBe(2);
            expect(manager.getNextAvailableKey()).toBe(0); // 다시 처음으로
        });

        test('excludeIndex 지정 시 해당 인덱스 건너뜀', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });
            // 0번을 먼저 소비하고
            expect(manager.getNextAvailableKey()).toBe(0);
            // 1번을 제외하면 2번 반환
            expect(manager.getNextAvailableKey(1)).toBe(2);
        });

        test('쿨다운 중인 키 건너뜀', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });
            // k1(인덱스 0) 실패 기록
            manager.recordKeyFailure(0, { response: { status: 429 } });
            // 0번 건너뛰고 1번 반환
            expect(manager.getNextAvailableKey()).toBe(1);
        });

        test('모든 키 쿨다운이면 -1 반환', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2'] });
            manager.recordKeyFailure(0, { response: { status: 429 } });
            manager.recordKeyFailure(1, { response: { status: 429 } });
            expect(manager.getNextAvailableKey()).toBe(-1);
        });

        test('excludeIndex + 쿨다운 조합', () => {
            const manager = new ApiKeyManager({ keys: ['k1', 'k2', 'k3'] });
            // k1(0) 쿨다운, k2(1) 제외 → k3(2) 반환
            manager.recordKeyFailure(0, { response: { status: 429 } });
            expect(manager.getNextAvailableKey(1)).toBe(2);
        });
    });

    describe('getKeyByIndex', () => {
        test('유효 인덱스는 키 문자열 반환', () => {
            const manager = new ApiKeyManager({ keys: ['key-a', 'key-b'] });
            expect(manager.getKeyByIndex(0)).toBe('key-a');
            expect(manager.getKeyByIndex(1)).toBe('key-b');
        });

        test('범위 밖 인덱스는 빈 문자열 반환', () => {
            const manager = new ApiKeyManager({ keys: ['key-a'] });
            expect(manager.getKeyByIndex(-1)).toBe('');
            expect(manager.getKeyByIndex(1)).toBe('');
        });
    });
});
