/**
 * skill-runtime 채팅 턴 통합 — 스킬 작성 의도 턴의 create_skill 노출·안내문 (opt-in SKILL_AUTHOR_INTENT_ENABLED).
 */
import type { ChatTurnIntegration } from '../../../services/chat-service/turn-integrations';
import { skillAuthorChatIntegration } from '../chat-integration';
import { isSkillAuthorIntent } from '../skill-author-intent';
import { SKILL_AUTHOR_GUIDE_CONTENT } from '../prompts';

// 형 일치 고정 — 통합 파일은 래칫 때문에 Base 타입을 import 하지 않는다
const typed: ChatTurnIntegration = skillAuthorChatIntegration;

const INTENT = [
    '한국 의료법 자문 스킬 만들어줘',
    '세금 신고 스킬을 하나 새로 만들어 줘',
    '에이전트 스킬 등록해줘',
    '이런 작업 자주 하니까 skill 로 만들어',
    'Create a skill for reviewing SQL migrations',
    'can you make me a new code review skill',
    'turn this into a skill',
];
const NON_INTENT = [
    '파이썬 코딩 스킬을 늘리는 방법 알려줘',
    'how can I improve my coding skills',
    '배정된 스킬 목록 보여줘',
    '오늘 날씨 어때?',
    '',
];

describe('isSkillAuthorIntent', () => {
    it.each(INTENT)('의도: %s', (m) => expect(isSkillAuthorIntent(m)).toBe(true));
    it.each(NON_INTENT)('의도 아님: %s', (m) => expect(isSkillAuthorIntent(m)).toBe(false));
});

describe('skillAuthorChatIntegration', () => {
    const saved = process.env.SKILL_AUTHOR_INTENT_ENABLED;
    afterEach(() => {
        if (saved === undefined) delete process.env.SKILL_AUTHOR_INTENT_ENABLED;
        else process.env.SKILL_AUTHOR_INTENT_ENABLED = saved;
    });

    it('플래그 OFF(기본) — 의도 턴이어도 아무 것도 하지 않는다(종전 동작)', () => {
        delete process.env.SKILL_AUTHOR_INTENT_ENABLED;
        const m = INTENT[0];
        expect(typed.detectIntent?.(m)).toBe(false);
        expect(typed.forceIncludeTools?.(m)).toEqual([]);
        expect(typed.systemPromptParts?.({ message: m })).toEqual([]);
    });

    it('플래그 ON — 의도 턴에 create_skill 포함 + 안내문', () => {
        process.env.SKILL_AUTHOR_INTENT_ENABLED = 'true';
        const m = INTENT[0];
        expect(typed.detectIntent?.(m)).toBe(true);
        expect(typed.forceIncludeTools?.(m)).toEqual([{ nameIncludes: 'create_skill', reason: '스킬 작성 의도' }]);
        expect(typed.systemPromptParts?.({ message: m })).toEqual([SKILL_AUTHOR_GUIDE_CONTENT]);
    });

    it('플래그 ON — 의도 아닌 턴엔 싣지 않는다(상시 노출 금지)', () => {
        process.env.SKILL_AUTHOR_INTENT_ENABLED = 'true';
        const m = NON_INTENT[0];
        expect(typed.forceIncludeTools?.(m)).toEqual([]);
        expect(typed.systemPromptParts?.({ message: m })).toEqual([]);
    });
});
