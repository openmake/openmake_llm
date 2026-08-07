/**
 * deriveOpenAICompatSessionKey 결정성 회귀 테스트.
 *
 * OpenAI 호환 클라이언트(Discord 봇 등)의 연속 호출을 하나의 conversation 세션으로
 * 묶기 위해 (owner, requestUser, UTC 날짜)로부터 결정적 세션 키를 유도한다.
 * 이 키가 결정적이지 않거나 날짜/사용자 축을 무시하면 세션이 파편화되거나 뒤섞인다.
 */
import { deriveOpenAICompatSessionKey } from '../openai-compat.routes';
import { OPENAI_COMPAT_SESSION } from '../../config/openai-compat';

describe('deriveOpenAICompatSessionKey', () => {
    const day = new Date('2026-08-07T10:00:00Z');
    const sameDayLater = new Date('2026-08-07T23:59:59Z');
    const nextDay = new Date('2026-08-08T00:00:01Z');

    it('같은 입력 → 같은 키 (결정성)', () => {
        const a = deriveOpenAICompatSessionKey('user-1', 'bot-a', day);
        const b = deriveOpenAICompatSessionKey('user-1', 'bot-a', day);
        expect(a).toBe(b);
    });

    it('prefix 와 해시 길이가 config 상수를 따른다', () => {
        const key = deriveOpenAICompatSessionKey('user-1', 'bot-a', day);
        expect(key.startsWith(OPENAI_COMPAT_SESSION.KEY_PREFIX)).toBe(true);
        const hex = key.slice(OPENAI_COMPAT_SESSION.KEY_PREFIX.length);
        expect(hex).toHaveLength(OPENAI_COMPAT_SESSION.HASH_HEX_LENGTH);
        expect(hex).toMatch(/^[0-9a-f]+$/);
    });

    it('다른 requestUser → 다른 키', () => {
        const a = deriveOpenAICompatSessionKey('user-1', 'bot-a', day);
        const b = deriveOpenAICompatSessionKey('user-1', 'bot-b', day);
        expect(a).not.toBe(b);
    });

    it('다른 owner → 다른 키', () => {
        const a = deriveOpenAICompatSessionKey('user-1', 'bot-a', day);
        const b = deriveOpenAICompatSessionKey('user-2', 'bot-a', day);
        expect(a).not.toBe(b);
    });

    it('requestUser 없으면 default 로 취급 (undefined 와 "default" 동일)', () => {
        const a = deriveOpenAICompatSessionKey('user-1', undefined, day);
        const b = deriveOpenAICompatSessionKey('user-1', 'default', day);
        expect(a).toBe(b);
    });

    it('같은 UTC 날짜 내에서는 시각이 달라도 같은 키', () => {
        const a = deriveOpenAICompatSessionKey('user-1', 'bot-a', day);
        const b = deriveOpenAICompatSessionKey('user-1', 'bot-a', sameDayLater);
        expect(a).toBe(b);
    });

    it('UTC 날짜 경계를 넘으면 다른 키 (일자 파편화 방지)', () => {
        const a = deriveOpenAICompatSessionKey('user-1', 'bot-a', sameDayLater);
        const b = deriveOpenAICompatSessionKey('user-1', 'bot-a', nextDay);
        expect(a).not.toBe(b);
    });
});
