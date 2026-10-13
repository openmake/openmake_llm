/** 근거 게이트(기록 전용, 문장 단위) — 인용 문장 추출, 판정 입력, 실행 조건, 기록 값 고정 (실제 모델 호출·DB 없음) */
import { GROUNDING_GATE } from '../../../config/decision';
import { buildClaimState, citedClaims, logGroundingShadow, runGroundingGate } from '../grounding-gate';

const src = (n: number, title: string, snippet: string) => ({ n, title, url: `https://e.x/${n}`, snippet });

describe('citedClaims — 출처 번호를 인용한 문장만 뽑는다', () => {
    it('"[출처 N]"·"[N]" 표기를 읽고, 문장에서 표기와 강조 기호를 뺀다', () => {
        const claims = citedClaims('최신 LTS는 **v24.21.0** 입니다 [출처 41]. 근거 없는 문장입니다. 유효기간은 3년입니다 [2][3].');
        expect(claims).toEqual([
            { text: '최신 LTS는 v24.21.0 입니다 .', ns: [41] },
            { text: '유효기간은 3년입니다 .', ns: [2, 3] },
        ]);
    });

    it('표·머리글·인용 블록·코드 울타리 줄과 너무 짧은 문장은 뺀다', () => {
        const text = ['## 제목 [1]', '| 구분 | 내용 [1] |', '> 인용 블록의 긴 문장입니다 [1].', '맞음 [1].', '- 확인기관은 벤처기업협회 한 곳입니다 [1].'].join('\n');
        expect(citedClaims(text).map((c) => c.text)).toEqual(['- 확인기관은 벤처기업협회 한 곳입니다 .']);
    });
});

describe('buildClaimState', () => {
    it('출처 하나(제목·요약)와 문장 하나를 싣고, 긴 요약은 상한에서 자른다', () => {
        expect(buildClaimState(src(1, '벤처확인제도', '확인기관은  벤처기업협회'), '확인기관은 벤처기업협회입니다.'))
            .toBe('Source: "벤처확인제도 — 확인기관은 벤처기업협회"\nClaim: "확인기관은 벤처기업협회입니다."');
        const long = buildClaimState(src(1, 't', '가'.repeat(GROUNDING_GATE.SNIPPET_MAX_CHARS * 2)), '문장');
        expect(long.length).toBeLessThan(GROUNDING_GATE.SNIPPET_MAX_CHARS + 60);
    });
});

describe('runGroundingGate', () => {
    const sources = [src(1, 't1', 's1'), src(2, 't2', 's2')];
    const answer = '첫째 주장은 이렇습니다 [1]. 둘째 주장은 저렇습니다 [2]. 셋째 주장은 없는 번호를 댑니다 [9].';
    const on = { enabled: true, modelAvailable: () => true };

    it('출처가 없는 답, 꺼진 게이트, 카탈로그에 없는 모델은 판정하지 않는다(undefined)', async () => {
        let called = 0;
        const decide = async () => { called++; return { pTrue: 1, ms: 1 }; };
        expect(await runGroundingGate({ sources: [], answer }, { ...on, decide })).toBeUndefined();
        expect(await runGroundingGate({ sources, answer }, { ...on, enabled: false, decide })).toBeUndefined();
        expect(await runGroundingGate({ sources, answer }, { ...on, modelAvailable: () => false, decide })).toBeUndefined();
        expect(called).toBe(0);
    });

    it('인용 문장이 없는 답은 모델을 부르지 않고 "확인할 문장 0"으로 돌려준다', async () => {
        let called = 0;
        const r = await runGroundingGate({ sources, answer: '출처 번호를 달지 않은 답입니다.' }, { ...on, decide: async () => { called++; return { pTrue: 1, ms: 1 }; } });
        expect(called).toBe(0);
        expect(r).toEqual({ model: expect.any(String), claimCount: 0, lowCount: 0, ms: 0, claims: [] });
    });

    it('문장마다 인용한 출처와 짝지어 묻고, 가장 낮은 확률과 기준 미만 건수를 돌려준다 — 없는 번호의 문장은 건너뛴다', async () => {
        const asked: string[] = [];
        const r = await runGroundingGate({ sources, answer }, { ...on, decide: async (i) => {
            expect(i.question).toBe(GROUNDING_GATE.QUESTION);
            asked.push(i.state);
            return i.state.includes('t1') ? { pTrue: 0.8, ms: 100 } : { pTrue: 0.02, ms: 150 };
        } });
        expect(asked).toEqual([buildClaimState(sources[0], '첫째 주장은 이렇습니다 .'), buildClaimState(sources[1], '둘째 주장은 저렇습니다 .')]);
        expect(r).toEqual({ model: expect.any(String), claimCount: 2, minP: 0.02, lowCount: 1, ms: 250, claims: [{ n: 1, p: 0.8 }, { n: 2, p: 0.02 }] });
    });

    it('한 문장이 여러 출처를 인용하면 가장 높은 확률을 그 문장의 값으로 본다, 실패한 판정은 사유만 남긴다', async () => {
        let i = 0;
        const r = await runGroundingGate({ sources, answer: '두 출처를 함께 인용한 주장입니다 [1][2].' }, { ...on, decide: async () => (i++ === 0 ? { pTrue: 0.05, ms: 10 } : { pTrue: 0.9, ms: 10 }) });
        expect(r).toMatchObject({ claimCount: 1, minP: 0.9, lowCount: 0 });
        const bad = await runGroundingGate({ sources, answer: '첫째 주장은 이렇습니다 [1].' }, { ...on, decide: async () => ({ pTrue: null, ms: 3000, error: 'timeout' }) });
        expect(bad).toMatchObject({ claimCount: 1, lowCount: 0, ms: 3000, error: 'timeout', claims: [{ n: 1, p: null }] });
        expect(bad?.minP).toBeUndefined();
    });

    it('문장 수 상한까지만 묻는다', async () => {
        let called = 0;
        const many = Array.from({ length: GROUNDING_GATE.MAX_CLAIMS + 5 }, (_, k) => `${k}번째 주장은 이렇게 적혀 있습니다 [1].`).join(' ');
        const r = await runGroundingGate({ sources, answer: many }, { ...on, decide: async () => { called++; return { pTrue: 0.5, ms: 1 }; } });
        expect(called).toBe(GROUNDING_GATE.MAX_CLAIMS);
        expect(r?.claimCount).toBe(GROUNDING_GATE.MAX_CLAIMS);
    });
});

describe('logGroundingShadow', () => {
    const base = { userId: 'u1', sessionId: 's1', messageId: '42', sources: [src(1, 't', 's'), src(2, 't2', 's2')], answer: '답입니다' };

    it('판정을 한 행으로 남긴다 — 본문은 저장하지 않고 번호·확률·길이만 남긴다', async () => {
        const saved: unknown[] = [];
        await logGroundingShadow(base, {
            run: async () => ({ model: 'jev-decision', claimCount: 2, minP: 0.02, lowCount: 1, ms: 250, claims: [{ n: 1, p: 0.8 }, { n: 2, p: 0.02 }] }),
            save: async (e) => { saved.push(e); },
        });
        expect(saved).toEqual([{
            userId: 'u1', sessionId: 's1', messageId: 42, pTrue: 0.02, gateError: null, gateMs: 250, gateModel: 'jev-decision',
            sourceCount: 2, answerChars: 4, method: 'claim', claimCount: 2, lowCount: 1, claims: [{ n: 1, p: 0.8 }, { n: 2, p: 0.02 }],
        }]);
    });

    it('판정하지 않은 답은 남기지 않는다, 판정·저장의 실패는 밖으로 나가지 않는다', async () => {
        const saved: unknown[] = [];
        await logGroundingShadow(base, { run: async () => undefined, save: async (e) => { saved.push(e); } });
        expect(saved).toEqual([]);
        await expect(logGroundingShadow(base, { run: async () => { throw new Error('x'); }, save: async () => undefined })).resolves.toBeUndefined();
        await expect(logGroundingShadow(base, { run: async () => ({ model: 'm', claimCount: 0, lowCount: 0, ms: 0, claims: [] }), save: async () => { throw new Error('db'); } })).resolves.toBeUndefined();
    });
});
