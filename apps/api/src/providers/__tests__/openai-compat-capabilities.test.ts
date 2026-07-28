/**
 * OpenAICompatProvider getCapabilities() — 모델 ID 패턴 기반 추론 검증
 *
 * 현실 정확성보다 "안전한 underestimate" 가 우선 — vision/thinking 매칭이
 * 잘못되면 사용자가 미지원 기능 토글을 켤 수 있어 UX 혼란.
 */
import { OpenAICompatProvider } from '../openai-compat-provider';

function caps(providerId: string, modelId: string) {
    const p = new OpenAICompatProvider({
        providerId,
        apiKey: 'placeholder',
        baseUrl: 'http://placeholder.example',
    });
    return p.getCapabilities(modelId);
}

describe('OpenAICompatProvider.getCapabilities — vision 추론', () => {
    it.each([
        ['gemini', 'gemini-2.5-pro'],
        ['gemini', 'gemini-2.5-flash'],
        ['gemini', 'gemini-2.0-flash-exp'],
        ['openrouter', 'openai/gpt-5'],
        ['openrouter', 'openai/gpt-4o'],
        ['openrouter', 'anthropic/claude-opus-4.5'],
        ['openrouter', 'anthropic/claude-sonnet-4.6'],
        ['mistral', 'pixtral-12b'],
        ['groq', 'llama-3.2-11b-vision-preview'],
        ['together', 'Qwen/Qwen2-VL-72B-Instruct'],
    ])('%s:%s → vision=true', (pid, mid) => {
        expect(caps(pid, mid).vision).toBe(true);
    });

    it.each([
        ['mistral', 'mistral-medium-latest'],
        ['mistral', 'codestral-latest'],
        ['groq', 'llama-3.3-70b-versatile'],
        ['together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
        ['cohere', 'command-r-plus'],
        ['openrouter', 'deepseek/deepseek-r1'],
    ])('%s:%s → vision=false (텍스트 전용)', (pid, mid) => {
        expect(caps(pid, mid).vision).toBe(false);
    });
});

describe('OpenAICompatProvider.getCapabilities — thinking 추론', () => {
    it.each([
        ['openrouter', 'deepseek/deepseek-r1'],
        ['openrouter', 'openai/o1-mini'],
        ['openrouter', 'anthropic/claude-opus-4.5'],
        ['openrouter', 'anthropic/claude-sonnet-4.6'],
    ])('%s:%s → thinking=true', (pid, mid) => {
        expect(caps(pid, mid).thinking).toBe(true);
    });

    it.each([
        ['gemini', 'gemini-2.5-flash'],
        ['groq', 'llama-3.3-70b-versatile'],
        ['mistral', 'mistral-medium-latest'],
    ])('%s:%s → thinking=false', (pid, mid) => {
        expect(caps(pid, mid).thinking).toBe(false);
    });
});

describe('OpenAICompatProvider.getCapabilities — toolCalling 정책', () => {
    it('Cohere — toolCalling=false (compatibility endpoint 미지원)', () => {
        expect(caps('cohere', 'command-r-plus').toolCalling).toBe(false);
        expect(caps('cohere', 'command-r').toolCalling).toBe(false);
    });

    it.each([
        ['gemini', 'gemini-2.5-pro'],
        ['groq', 'llama-3.3-70b-versatile'],
        ['mistral', 'mistral-large-latest'],
        ['openrouter', 'openai/gpt-5'],
    ])('%s:%s → toolCalling=true (기본)', (pid, mid) => {
        expect(caps(pid, mid).toolCalling).toBe(true);
    });
});

describe('OpenAICompatProvider.getCapabilities — embedding 모델 자동 감지', () => {
    // embedding 모델 분기 테스트: 2026-05-19 제거 (vector cache / semantic router 폐기)
});

describe('OpenAICompatProvider.getCapabilities — 알 수 없는 모델', () => {
    it('완전 미상 모델 → DEFAULT_CAPABILITIES (streaming + toolCalling만 true)', () => {
        const c = caps('openai-compatible', 'totally-unknown-model-9000');
        expect(c.streaming).toBe(true);
        expect(c.toolCalling).toBe(true);
        expect(c.vision).toBe(false);
        expect(c.thinking).toBe(false);
    });
});
