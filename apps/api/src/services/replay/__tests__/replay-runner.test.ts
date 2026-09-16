/**
 * 리플레이 러너(F24.7) 순수 함수 — 유사도, 모델 결정(외부 번들은 명시 필수), 번들 → 입력 변환.
 */
import { textSimilarity, resolveReplayModel, bundleToChatInput } from '../replay-runner';
import type { ReplayBundle } from '../../../observability/replay-capture';

const bundle = (over: Partial<ReplayBundle> = {}): ReplayBundle => ({
    version: 1, requestId: 'r', capturedAt: 'x', provider: { providerId: 'local-llm', modelId: 'qwen3.8-27b', fullId: 'qwen3.8-27b' },
    messages: [{ role: 'user', content: '사진 설명', images_omitted: { count: 1, bytes: 10 } }], truncated: false, ...over,
});

describe('textSimilarity', () => {
    it('같으면 1, 전혀 다르면 0 에 가깝고 공백은 무시', () => {
        expect(textSimilarity('서울은 수도다', '서울은  수도다')).toBe(1);
        expect(textSimilarity('abcdef', 'uvwxyz')).toBe(0);
        expect(textSimilarity('', '')).toBe(1);
    });
});

describe('resolveReplayModel', () => {
    it('로컬 번들은 원 모델, 외부 번들은 명시 모델 필요', () => {
        expect(resolveReplayModel(bundle())).toBe('qwen3.8-27b');
        expect(resolveReplayModel(bundle({ provider: { providerId: 'openrouter', modelId: 'x', fullId: 'openrouter:x' } }), 'qwen3.8-27b')).toBe('qwen3.8-27b');
        expect(() => resolveReplayModel(bundle({ provider: { providerId: 'openrouter', modelId: 'x', fullId: 'openrouter:x' } }))).toThrow('model 을 지정');
    });
});

describe('bundleToChatInput', () => {
    it('이미지 생략을 본문에 표시하고, 이름만 남은 절단 도구는 넘기지 않는다', () => {
        expect(bundleToChatInput(bundle()).messages[0].content).toContain('이미지 1장 생략');
        expect(bundleToChatInput(bundle({ tools: [{ name: 'web_search' }] })).tools).toBeUndefined();
        expect(bundleToChatInput(bundle({ tools: [{ type: 'function', function: { name: 'web_search', parameters: {} } }] })).tools).toHaveLength(1);
    });
});
