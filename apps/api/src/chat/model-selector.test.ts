import { checkModelCapability } from './model-selector';

describe('checkModelCapability — preset-authoritative', () => {
    it('미등록 auto-routing 모델(kimi-k2) → preset/profile miss → tier-3 optimistic (toolCalling:true)', () => {
        // matchCapabilityPreset null + profile defaultModel 불일치 → 보수적/optimistic 기본값
        expect(checkModelCapability('kimi-k2', 'toolCalling')).toBe(true);
    });

    it('qwen3.6-35b-a3b → preset 가 generic profile 보다 우선 (thinking:true, toolCalling:true)', () => {
        // 2026-06-12 toolCalling/thinking 의도 복원 — vLLM 이 tool-call-parser 로 구동 중이고
        // false 로 두면 채팅 경로의 caps 게이트가 모든 MCP 도구를 제거(tools=0)한다.
        expect(checkModelCapability('qwen3.6-35b-a3b', 'thinking')).toBe(true);
        expect(checkModelCapability('qwen3.6-35b-a3b', 'toolCalling')).toBe(true);
    });

    it('qwen3.6-35b-a3b → vision:true 는 preset 에서 유지 (라이브 검증된 vision)', () => {
        expect(checkModelCapability('qwen3.6-35b-a3b', 'vision')).toBe(true);
    });
});
