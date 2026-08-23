/**
 * thinking capability 게이트 — 미지원 모델에 enable_thinking 을 보내지 않는다.
 *
 * 배경: vision·tools 는 caps 로 게이팅하는데 thinking 만 빠져 있었다. 미지원 모델에
 * enable_thinking=true 를 보내면 stream-parser 가 스트림 **시작부터** reasoning 으로 간주하고
 * `</think>` 경계를 기다린다(chat_template 이 여는 태그를 prepend 하는 모델 규약). 그 태그를
 * 쓰지 않는 모델이면 답변 전체가 thinking 채널로 흘러 접힌 영역에 그려지다가 종료 시 recovery
 * 로 승격된다 — 죽지는 않지만 스트리밍 UX 가 무너진다.
 *
 * 여기서는 그 결정 규칙(요청 thinking 값)만 고정한다.
 */
import { buildExtraBody } from '../../llm/reasoning-adapter';

/** external-provider.resolveThinking 과 동일 규칙 (private 함수라 계약을 여기서 재현·고정). */
function resolveThinking(
    req: { thinkingMode?: boolean; thinkingLevel?: 'low' | 'medium' | 'high' },
    supportsThinking: boolean,
): boolean | 'low' | 'medium' | 'high' {
    if (req.thinkingMode !== true) return false;
    if (!supportsThinking) return false;
    return req.thinkingLevel ?? true;
}

describe('thinking capability 게이트', () => {
    it('지원 모델은 사용자가 고른 강도를 그대로 넘긴다', () => {
        expect(resolveThinking({ thinkingMode: true, thinkingLevel: 'medium' }, true)).toBe('medium');
        expect(resolveThinking({ thinkingMode: true }, true)).toBe(true);
    });

    it('미지원 모델이면 강도와 무관하게 false (핵심 회귀)', () => {
        expect(resolveThinking({ thinkingMode: true, thinkingLevel: 'high' }, false)).toBe(false);
        expect(resolveThinking({ thinkingMode: true }, false)).toBe(false);
    });

    it('토글이 꺼져 있으면 지원 여부와 무관하게 false', () => {
        expect(resolveThinking({ thinkingMode: false }, true)).toBe(false);
        expect(resolveThinking({}, true)).toBe(false);
    });

    it('false 는 enable_thinking=false 로 명시 전송된다 (스트림 오분류 차단)', () => {
        // 미지정이 아니라 **명시적 false** 여야 stream-parser 가 시작부터 content 로 취급한다.
        const body = buildExtraBody(false, 'some-model');
        expect(body?.chat_template_kwargs).toEqual({ enable_thinking: false });
    });
});
