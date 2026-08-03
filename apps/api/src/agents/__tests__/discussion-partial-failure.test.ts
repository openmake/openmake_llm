/**
 * 부분 실패 정책 테스트 (2026-08-02, 갭 B).
 *
 * 종전: 전원 실패(0명)만 처리하고 부분 실패는 통과시켰다. 게다가 participants 를
 * *선택된* 전문가 기준으로 산출해, 3명 중 1명만 성공해도 "참여 전문가: A, B, C" 로
 * 표시되는 오표시가 있었다.
 *
 * 변경: 최소 인원 미달이면 실패분만 1회 재시도하고, participants 는 실제 의견을 낸
 * 전문가만 집계하며, 그래도 미달이면 degraded 를 세운다.
 */
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, DISCUSSION_MIN_PROPOSERS: 2 };
});

import { createDiscussionEngine } from '../discussion-engine';

const OPINION = '## 의견\n- 분석 내용입니다.\n- 추가 근거가 있습니다.';

/**
 * 의견 생성 호출인지 판별.
 *
 * 같은 generateResponse 로 ① 전문가 의견 ② 일관성 평가(영문) ③ 최종 합성(`# 💡 종합 분석가`)
 * 이 모두 호출된다. 합성 프롬프트도 `#` 로 시작하므로 헤더만으로는 구분되지 않아,
 * 의견 프롬프트에만 있는 "…전문가입니다" 문구로 판별한다(ko 로케일 고정).
 */
const isOpinionCall = (system: string) => /전문가입니다/.test(system);

/**
 * @param failPlan 의견 생성 호출 n번째(1-based)를 실패시킬지 판정
 */
function makeEngine(failPlan: (nthOpinionCall: number) => boolean) {
    let opinionCalls = 0;
    const generateResponse = jest.fn(async (system: string) => {
        if (!isOpinionCall(system)) return OPINION; // 합성·일관성 호출은 항상 성공
        opinionCalls++;
        if (failPlan(opinionCalls)) throw new Error('opinion failed');
        return OPINION;
    });
    const engine = createDiscussionEngine(generateResponse as never, {
        maxAgents: 3,
        maxRounds: 1,
        enableCrossReview: false,
        enableFactCheck: false,
        enableDeepThinking: false,
        userLanguage: 'ko',
    });
    return { engine, opinionCallCount: () => opinionCalls };
}

describe('Discussion — 부분 실패 정책', () => {
    it('참여자는 실제로 의견을 낸 전문가만 집계한다', async () => {
        const { engine } = makeEngine(() => false);
        const r = await engine.startDiscussion('테스트 주제');
        expect(r.participants.length).toBe(r.opinions.length);
        expect(r.participants.length).toBeGreaterThan(0);
        expect(r.degraded).toBeUndefined();
    });

    it('최소 인원 미달이면 실패분만 재시도한다 (전원 재시도 아님)', async () => {
        // 기준선: 전원 성공 시 의견 호출 수 = 선택된 전문가 수(라우터가 뽑는 인원은 가변).
        const base = makeEngine(() => false);
        await base.engine.startDiscussion('테스트 주제');
        const expertCount = base.opinionCallCount();
        expect(expertCount).toBeGreaterThanOrEqual(3);

        // 첫 2명 실패 → 성공 1명(최소 2 미달) → 실패한 2명만 재시도 → 성공
        const { engine, opinionCallCount } = makeEngine(n => n <= 2);
        const r = await engine.startDiscussion('테스트 주제');

        // 전문가 수 + 실패분(2) 만큼만 호출된다. 전원 재시도였다면 expertCount*2 가 된다.
        expect(opinionCallCount()).toBe(expertCount + 2);
        expect(r.participants.length).toBe(expertCount);
        expect(r.degraded).toBeUndefined();
    });

    it('재시도 후에도 미달이면 degraded 를 세운다', async () => {
        // 1번째 호출만 성공하고 나머지는 재시도 포함 전부 실패.
        const { engine } = makeEngine(n => n !== 1);
        const r = await engine.startDiscussion('테스트 주제');

        expect(r.opinions.length).toBe(1);
        expect(r.participants.length).toBe(1);
        expect(r.degraded).toBe(true);
    });

    it('전원 실패면 참여자를 비우고 조기 종료한다', async () => {
        const { engine } = makeEngine(() => true);
        const r = await engine.startDiscussion('테스트 주제');
        expect(r.opinions).toEqual([]);
        expect(r.participants).toEqual([]);
    });
});
