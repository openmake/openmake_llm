/**
 * resolveLanguagePolicy — 결정 로그 선택 (2026-09-15).
 *
 * 배경: 사고 요약 언어를 정하려고 request-handler 가 한 번 더 판정하면서
 * `[LanguageResolver] 언어 정책 결정` 로그가 요청당 2줄 찍혔다.
 */
const mockInfo = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: mockInfo, warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { resolveLanguagePolicy } from '../language-resolver';

const MESSAGE = 'How do I get to the airport from downtown?';

beforeEach(() => mockInfo.mockReset());

describe('resolveLanguagePolicy — 결정 로그', () => {
    it('기본은 결정 로그를 한 번 남긴다', () => {
        resolveLanguagePolicy(MESSAGE);

        expect(mockInfo).toHaveBeenCalledTimes(1);
    });

    it('log:false 는 같은 판정을 돌려주고 로그를 남기지 않는다', () => {
        const logged = resolveLanguagePolicy(MESSAGE);
        mockInfo.mockReset();

        const silent = resolveLanguagePolicy(MESSAGE, undefined, { log: false });

        expect(silent?.resolvedLanguage).toBe(logged?.resolvedLanguage);
        expect(mockInfo).not.toHaveBeenCalled();
    });
});
