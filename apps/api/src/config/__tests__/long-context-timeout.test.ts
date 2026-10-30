import { envSchema } from '../env.schema';
import { validateConfig } from '../env-validate';
import { DEFAULT_CONFIG } from '../env-defaults';

describe('긴 문맥 추론용 LLM_TIMEOUT', () => {
    test('기본값은 그대로 두고 20분까지 허용한다', () => {
        const original = envSchema.safeParse({ NODE_ENV: 'test' });
        const extended = envSchema.safeParse({ NODE_ENV: 'test', LLM_TIMEOUT: '1200000' });
        expect(original.success && original.data.LLM_TIMEOUT).toBe(120000);
        expect(extended.success && extended.data.LLM_TIMEOUT).toBe(1200000);
        expect(() => validateConfig({ ...DEFAULT_CONFIG, nodeEnv: 'test', llmTimeout: 1200000 })).not.toThrow();
    });
    test('0 이하와 20분 초과는 거부한다', () => {
        expect(envSchema.safeParse({ NODE_ENV: 'test', LLM_TIMEOUT: '0' }).success).toBe(false);
        expect(envSchema.safeParse({ NODE_ENV: 'test', LLM_TIMEOUT: '1200001' }).success).toBe(false);
        expect(() => validateConfig({ ...DEFAULT_CONFIG, nodeEnv: 'test', llmTimeout: 1200001 })).toThrow();
    });
});
