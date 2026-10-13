/** 근거 게이트(기록 전용) — 판정 입력 구성, 실행 조건, 기록 값 고정 (실제 모델 호출·DB 없음) */
import { GROUNDING_GATE } from '../../../config/decision';
import { buildGroundingState, logGroundingShadow, runGroundingGate } from '../grounding-gate';

const src = (n: number, title: string, snippet: string) => ({ n, title, url: `https://e.x/${n}`, snippet });

describe('buildGroundingState', () => {
    it('출처는 번호·제목·요약으로, 답은 그 뒤에 싣는다', () => {
        const s = buildGroundingState([src(1, '벤처확인제도', '확인기관은 벤처기업협회'), src(2, '법령', '제25조의3')], '확인기관은 벤처기업협회입니다.');
        expect(s).toBe('Search results:\n[1] 벤처확인제도 — 확인기관은 벤처기업협회\n[2] 법령 — 제25조의3\nAnswer: "확인기관은 벤처기업협회입니다."');
    });

    it('출처와 답을 각자의 상한에서 자른다 — 긴 출처가 답을 밀어내지 않는다', () => {
        const s = buildGroundingState([src(1, 't', '가'.repeat(GROUNDING_GATE.SOURCES_MAX_CHARS * 2))], '나'.repeat(GROUNDING_GATE.ANSWER_MAX_CHARS * 2));
        expect(s.length).toBeLessThan(GROUNDING_GATE.SOURCES_MAX_CHARS + GROUNDING_GATE.ANSWER_MAX_CHARS + 60);
        expect(s).toContain(`Answer: "${'나'.repeat(20)}`);
    });
});

describe('runGroundingGate', () => {
    const sources = [src(1, 't', 's')];

    it('출처가 없는 답, 꺼진 게이트, 카탈로그에 없는 모델은 호출하지 않는다', async () => {
        let called = 0;
        const decide = async () => { called++; return { pTrue: 1, ms: 1 }; };
        expect(await runGroundingGate({ sources: [], answer: 'a' }, { enabled: true, modelAvailable: () => true, decide })).toBeUndefined();
        expect(await runGroundingGate({ sources, answer: '  ' }, { enabled: true, modelAvailable: () => true, decide })).toBeUndefined();
        expect(await runGroundingGate({ sources, answer: 'a' }, { enabled: false, modelAvailable: () => true, decide })).toBeUndefined();
        expect(await runGroundingGate({ sources, answer: 'a' }, { enabled: true, modelAvailable: () => false, decide })).toBeUndefined();
        expect(called).toBe(0);
    });

    it('판정 결과와 실패 사유를 기록용으로 돌려준다 — 예외를 올리지 않는다', async () => {
        const ok = await runGroundingGate({ sources, answer: 'a' }, { enabled: true, modelAvailable: () => true, decide: async (i) => { expect(i.question).toBe(GROUNDING_GATE.QUESTION); return { pTrue: 0.02, ms: 190 }; } });
        expect(ok).toMatchObject({ pTrue: 0.02, ms: 190 });
        const bad = await runGroundingGate({ sources, answer: 'a' }, { enabled: true, modelAvailable: () => true, decide: async () => ({ pTrue: null, ms: 3000, error: 'timeout' }) });
        expect(bad).toMatchObject({ ms: 3000, error: 'timeout' });
        expect(bad?.pTrue).toBeUndefined();
    });
});

describe('logGroundingShadow', () => {
    const base = { userId: 'u1', sessionId: 's1', messageId: '42', sources: [src(1, 't', 's'), src(2, 't2', 's2')], answer: '답입니다' };

    it('판정을 한 행으로 남긴다 — 본문은 저장하지 않고 길이만 남긴다', async () => {
        const saved: unknown[] = [];
        await logGroundingShadow(base, { run: async () => ({ pTrue: 0.9, ms: 200, model: 'jev-decision' }), save: async (e) => { saved.push(e); } });
        expect(saved).toEqual([{ userId: 'u1', sessionId: 's1', messageId: 42, pTrue: 0.9, gateError: null, gateMs: 200, gateModel: 'jev-decision', sourceCount: 2, answerChars: 4 }]);
    });

    it('판정하지 않은 답은 남기지 않는다, 판정·저장의 실패는 밖으로 나가지 않는다', async () => {
        const saved: unknown[] = [];
        await logGroundingShadow(base, { run: async () => undefined, save: async (e) => { saved.push(e); } });
        expect(saved).toEqual([]);
        await expect(logGroundingShadow(base, { run: async () => { throw new Error('x'); }, save: async () => undefined })).resolves.toBeUndefined();
        await expect(logGroundingShadow(base, { run: async () => ({ pTrue: 0.5, ms: 1, model: 'm' }), save: async () => { throw new Error('db'); } })).resolves.toBeUndefined();
    });
});
