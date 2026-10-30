import { envSchema } from '../env.schema';
import { validateConfig } from '../env-validate';
import { DEFAULT_CONFIG } from '../env-defaults';

describe('LLM timeout for long-context inference', () => {
    test('allows a 20-minute timeout without changing the default', () => {
        const original = envSchema.safeParse({ NODE_ENV: 'test' });
        const extended = envSchema.safeParse({ NODE_ENV: 'test', LLM_TIMEOUT: '1200000' });
        expect(original.success && original.data.LLM_TIMEOUT).toBe(120000);
        expect(extended.success && extended.data.LLM_TIMEOUT).toBe(1200000);
        expect(() => validateConfig({ ...DEFAULT_CONFIG, nodeEnv: 'test', llmTimeout: 1200000 })).not.toThrow();
    });
    test('rejects nonpositive values and values above 20 minutes', () => {
        expect(envSchema.safeParse({ NODE_ENV: 'test', LLM_TIMEOUT: '0' }).success).toBe(false);
        expect(envSchema.safeParse({ NODE_ENV: 'test', LLM_TIMEOUT: '1200001' }).success).toBe(false);
        expect(() => validateConfig({ ...DEFAULT_CONFIG, nodeEnv: 'test', llmTimeout: 1200001 })).toThrow();
    });
});
