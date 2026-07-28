import { matchCapabilityPreset, FALLBACK_CAPABILITIES } from './model-defaults';

describe('matchCapabilityPreset (startsWith-longest)', () => {
    it('현 기본 모델 qwen3.6-35b-a3b → a3b 키 (vision:true, toolCalling:true — 2026-06-12 의도 복원)', () => {
        const caps = matchCapabilityPreset('qwen3.6-35b-a3b');
        expect(caps).not.toBeNull();
        expect(caps!.vision).toBe(true);
        expect(caps!.toolCalling).toBe(true);
        expect(caps!.thinking).toBe(true);
    });

    it('suffixed variant → base 프리셋 상속 (startsWith-longest, vision:true)', () => {
        expect(matchCapabilityPreset('qwen3.6-35b-a3b:cloud')!.vision).toBe(true);
    });

    it('대소문자 무관 (lowercase 통일)', () => {
        expect(matchCapabilityPreset('QWEN3.6-35B-A3B')!.vision).toBe(true);
    });

    it('미래 variant -2m (키 없음) → startsWith-longest 로 a3b 키 커버 (갈림 해소)', () => {
        const caps = matchCapabilityPreset('qwen3.6-35b-a3b-2m');
        expect(caps).not.toBeNull();
        expect(caps!.vision).toBe(true);
    });

    it('gpt-3.5-turbo alias → gpt 키 (toolCalling:true, vision:false)', () => {
        const caps = matchCapabilityPreset('gpt-3.5-turbo');
        expect(caps!.toolCalling).toBe(true);
        expect(caps!.vision).toBe(false);
    });

    it('미등록 모델(kimi-k2) → null', () => {
        expect(matchCapabilityPreset('kimi-k2')).toBeNull();
    });

    it('중간-substring 오매칭 배제 (includes 였다면 매칭됐을 케이스) → null', () => {
        expect(matchCapabilityPreset('my-gpt-3.5-turbo-clone')).toBeNull();
    });

    it('FALLBACK_CAPABILITIES 는 보수적 (toolCalling:false, streaming:true)', () => {
        expect(FALLBACK_CAPABILITIES).toEqual({
            toolCalling: false, thinking: false, vision: false, streaming: true,
        });
    });
});
