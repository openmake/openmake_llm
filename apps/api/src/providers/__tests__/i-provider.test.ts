import { ProviderError } from '../provider-errors';
import { parseFullModelId, buildFullModelId } from '../i-provider';

describe.skip('ProviderError', () => {
    it('각 에러 코드별 인스턴스 생성 가능', () => {
        const err = new ProviderError('GUEST_NOT_ALLOWED', '게스트 차단');
        expect(err.code).toBe('GUEST_NOT_ALLOWED');
        expect(err.message).toBe('게스트 차단');
        expect(err.name).toBe('ProviderError');
        expect(err instanceof Error).toBe(true);
    });

    it('cause 옵션 전달 가능', () => {
        const inner = new Error('inner');
        const err = new ProviderError('UPSTREAM_ERROR', 'wrapper', inner);
        expect(err.cause).toBe(inner);
    });
});

describe.skip('parseFullModelId', () => {
    it.each([
        ['local-llm:gemma4:e4b', 'local-llm', 'gemma4:e4b'],
        ['anthropic:claude-sonnet-4-5', 'anthropic', 'claude-sonnet-4-5'],
        ['openrouter:anthropic/claude-3.5-sonnet', 'openrouter', 'anthropic/claude-3.5-sonnet'],
        ['groq:llama-3.3-70b-versatile', 'groq', 'llama-3.3-70b-versatile'],
    ])('"%s" → provider="%s", model="%s"', (full, expectedProvider, expectedModel) => {
        const { providerId, modelId } = parseFullModelId(full);
        expect(providerId).toBe(expectedProvider);
        expect(modelId).toBe(expectedModel);
    });

    it.each(['no-colon', 'leading:', ':trailing', '', ':'])(
        '잘못된 형식 "%s" 거부',
        (bad) => {
            expect(() => parseFullModelId(bad)).toThrow(/Invalid model id format/);
        },
    );
});

describe.skip('buildFullModelId', () => {
    it('provider와 model을 콜론으로 결합', () => {
        expect(buildFullModelId('local-llm', 'gemma4:e4b')).toBe('local-llm:gemma4:e4b');
        expect(buildFullModelId('anthropic', 'claude-sonnet-4-5')).toBe('anthropic:claude-sonnet-4-5');
    });
});
