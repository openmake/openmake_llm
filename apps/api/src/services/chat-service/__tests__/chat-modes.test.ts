/**
 * 채팅 모드 확장점 — 요청에서 모드를 모으는 규칙과 우선순위. 실제 모드 구성(addon-host)으로 검증한다.
 */
import { __setChatModesForTest, collectActiveModes, getChatModes, resolveActiveMode, restLegacyModeFlags, DEFAULT_INPUT_POLICY } from '../chat-modes';

afterEach(() => __setChatModesForTest(null));

describe('collectActiveModes', () => {
    it('새 필드 modes 와 구 불리언 필드를 같은 결과로 받는다', () => {
        const ids = getChatModes().map((m) => m.id);
        expect(ids.length).toBeGreaterThanOrEqual(2);
        for (const mode of getChatModes()) {
            expect(collectActiveModes({ modes: { [mode.id]: true } })).toEqual({ [mode.id]: true });
            expect(collectActiveModes({ [mode.legacyRequestFlag as string]: true })).toEqual({ [mode.id]: true });
        }
    });

    it('새 필드의 명시적 false 는 구 필드의 true 보다 우선한다', () => {
        const mode = getChatModes()[0];
        expect(collectActiveModes({ modes: { [mode.id]: false }, [mode.legacyRequestFlag as string]: true })).toBeUndefined();
    });

    it('등록되지 않은 모드 id 와 불리언이 아닌 값은 버린다', () => {
        expect(collectActiveModes({ modes: { 'unknown-mode': true } })).toBeUndefined();
        expect(collectActiveModes({ modes: 'x' })).toBeUndefined();
        expect(collectActiveModes({})).toBeUndefined();
    });

    it('REST 에서는 REST 가용 모드만 받는다 — 나머지는 새 필드로 와도 무시', () => {
        const restOnly = getChatModes().filter((m) => m.availableOverRest);
        const wsOnly = getChatModes().filter((m) => !m.availableOverRest);
        expect(restOnly.length).toBeGreaterThan(0);
        expect(wsOnly.length).toBeGreaterThan(0);
        for (const mode of wsOnly) {
            expect(collectActiveModes({ modes: { [mode.id]: true }, [mode.legacyRequestFlag as string]: true }, 'rest')).toBeUndefined();
            expect(restLegacyModeFlags()).not.toContain(mode.legacyRequestFlag);
        }
        for (const mode of restOnly) expect(restLegacyModeFlags()).toContain(mode.legacyRequestFlag);
    });

    it('모드가 0개면(add-on 전부 꺼짐) 어떤 필드도 모드를 켜지 못한다', () => {
        const flags = getChatModes().map((m) => m.legacyRequestFlag as string);
        __setChatModesForTest([]);
        expect(collectActiveModes(Object.fromEntries(flags.map((f) => [f, true])))).toBeUndefined();
        expect(restLegacyModeFlags()).toEqual([]);
    });
});

describe('resolveActiveMode', () => {
    it('여러 모드가 켜져 오면 등록 순서상 첫 모드가 턴을 가져간다', () => {
        const [first, second] = getChatModes();
        expect(resolveActiveMode({ [second.id]: true, [first.id]: true })?.id).toBe(first.id);
        expect(resolveActiveMode({ [second.id]: true })?.id).toBe(second.id);
        expect(resolveActiveMode(undefined)).toBeUndefined();
    });
});

describe('입력 정책', () => {
    it('일반 채팅은 전처리를 전부 하고, 모든 모드는 PDF vision 주입을 끈다', () => {
        expect(DEFAULT_INPUT_POLICY).toEqual({ pdfVision: true, urlPreanalysis: true, reuseAttachContext: true });
        for (const mode of getChatModes()) expect(mode.inputPolicy.pdfVision).toBe(false);
    });

    it('첨부를 거절하는 모드는 URL 사전 분석·첨부 재주입도 끈다 (첨부 컨텍스트를 소비하지 않는 모드)', () => {
        const rejecting = getChatModes().filter((m) => m.inputPolicy.rejectFileAttachmentsMessage);
        expect(rejecting.length).toBeGreaterThan(0);
        for (const mode of rejecting) {
            expect(mode.inputPolicy.urlPreanalysis).toBe(false);
            expect(mode.inputPolicy.reuseAttachContext).toBe(false);
        }
    });
});
