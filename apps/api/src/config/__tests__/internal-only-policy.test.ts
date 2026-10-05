/**
 * 내부 전용 처리 정책 — 대상 판정과 추가 도구 분류 (Companion P1-5).
 */
let bridgeEnabled = true;
jest.mock('../local-bridge', () => ({ LOCAL_BRIDGE: { get ENABLED() { return bridgeEnabled; } } }));

import { INTERNAL_ONLY, isInternalOnlyRun, splitInternalOnlyTools } from '../internal-only-policy';

const tool = (name: string) => ({ function: { name } });

describe('isInternalOnlyRun', () => {
    beforeEach(() => { bridgeEnabled = true; });
    afterEach(() => jest.restoreAllMocks());

    it('로컬 실행 작업은 내부 전용이다', () => {
        expect(isInternalOnlyRun({ executor: 'local' })).toBe(true);
    });
    it('서버 샌드박스 작업·실행기 미지정은 대상이 아니다', () => {
        expect(isInternalOnlyRun({ executor: 'sandbox' })).toBe(false);
        expect(isInternalOnlyRun({})).toBe(false);
    });
    it('로컬 실행 기능이 꺼져 있으면 대상이 아니다 (그 작업은 로컬로 돌지 않는다)', () => {
        bridgeEnabled = false;
        expect(isInternalOnlyRun({ executor: 'local' })).toBe(false);
    });
    it('관리자가 끄면 대상이 아니다', () => {
        jest.replaceProperty(INTERNAL_ONLY, 'LOCAL_TASKS_ENABLED', false);
        expect(isInternalOnlyRun({ executor: 'local' })).toBe(false);
    });
});

describe('splitInternalOnlyTools', () => {
    it('허용 목록에 있는 추가 도구만 남기고 나머지는 뺀다', () => {
        const r = splitInternalOnlyTools([tool('web_search'), tool('load_skill'), tool('github::create_issue')], ['load_skill']);
        expect(r.kept.map((t) => t.function.name)).toEqual(['load_skill']);
        expect(r.removed).toEqual(['web_search', 'github::create_issue']);
    });
    it('허용 목록이 비면 전부 뺀다', () => {
        expect(splitInternalOnlyTools([tool('load_skill')], []).kept).toEqual([]);
    });
    it('기본 허용 목록은 스킬 불러오기뿐이다', () => {
        expect(INTERNAL_ONLY.ALLOWED_EXTRA_TOOLS).toEqual(['load_skill']);
    });
});
