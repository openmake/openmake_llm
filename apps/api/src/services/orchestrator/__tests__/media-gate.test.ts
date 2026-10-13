/** 미디어 게이트(셰도우) — 판정 입력 구성과 실행 조건 고정 (실제 모델 호출 없음) */
import { buildMediaGateState, gatesWithin, runMediaGateShadow, runSearchGateShadow } from '../media-gate';
import { DECISION, SEARCH_GATE } from '../../../config/decision';

describe('buildMediaGateState', () => {
    it('사용자 메시지와 첨부 종류를 싣는다', () => {
        expect(buildMediaGateState('노래 만들어줘', ['image', 'audio'])).toBe('User message: "노래 만들어줘"\nAttachments: image, audio');
    });

    it('첨부가 없으면 none 으로 적는다', () => {
        expect(buildMediaGateState('안녕', [])).toBe('User message: "안녕"\nAttachments: none');
    });

    it('긴 메시지는 상한에서 자른다', () => {
        const s = buildMediaGateState('가'.repeat(DECISION.STATE_MAX_CHARS + 500), []);
        expect(s.length).toBeLessThan(DECISION.STATE_MAX_CHARS + 60);
    });
});

describe('runMediaGateShadow', () => {
    const decide = async () => ({ pTrue: 0.93, ms: 12 });

    it('결정 모델이 카탈로그에 없으면 호출하지 않는다(undefined)', async () => {
        let called = 0;
        const r = await runMediaGateShadow({ message: 'x', attachmentKinds: [] }, { modelAvailable: () => false, decide: async () => { called++; return { pTrue: 1, ms: 1 }; } });
        expect(r).toBeUndefined();
        expect(called).toBe(0);
    });

    it('있으면 판정 결과를 기록용 필드로 돌려준다', async () => {
        const r = await runMediaGateShadow({ message: '그림 그려줘', attachmentKinds: [] }, { modelAvailable: () => true, decide });
        expect(r).toEqual({ gateModel: DECISION.MODEL, gatePTrue: 0.93, gateMs: 12 });
    });

    it('판정 실패는 사유만 싣는다 — 예외를 올리지 않는다', async () => {
        const r = await runMediaGateShadow({ message: 'x', attachmentKinds: [] }, { modelAvailable: () => true, decide: async () => ({ pTrue: null, ms: 3000, error: 'timeout' }) });
        expect(r).toEqual({ gateModel: DECISION.MODEL, gateMs: 3000, gateError: 'timeout' });
    });
});

describe('shouldSkipPlanner', () => {
    const media = (p: number) => ({ gateModel: 'm', gatePTrue: p });
    const search = (p: number) => ({ searchGatePTrue: p });

    it('기본값(꺼짐)에서는 판정이 아무리 낮아도 생략하지 않는다', async () => {
        // 로컬 .env 가 켜 둔 값(2026-10-13 이후 세 환경 모두 true)이 jest.setup 으로 들어오므로 기본값은 명시적으로 비운다
        delete process.env.ORCHESTRATOR_GATE_SKIP_ENABLED;
        jest.resetModules();
        const { shouldSkipPlanner } = await import('../media-gate');
        expect(shouldSkipPlanner(media(0.0001), search(0.0001), 0)).toBe(false);
    });

    describe('켰을 때', () => {
        let skip: typeof import('../media-gate').shouldSkipPlanner;
        beforeAll(async () => {
            process.env.ORCHESTRATOR_GATE_SKIP_ENABLED = 'true';
            jest.resetModules();
            skip = (await import('../media-gate')).shouldSkipPlanner;
        });
        afterAll(() => { delete process.env.ORCHESTRATOR_GATE_SKIP_ENABLED; jest.resetModules(); });

        it('미디어·검색 판정이 둘 다 임계 미만이고 첨부가 없으면 생략한다', () => {
            expect(skip(media(0.01), search(0.05), 0)).toBe(true);
        });
        it('미디어가 임계 이상이면 Planner 로 보낸다', () => {
            expect(skip(media(0.2), search(0.01), 0)).toBe(false);
        });
        it('검색이 임계 이상이면 Planner 로 보낸다 — Planner 가 실제로 정하는 것은 대부분 검색 여부다', () => {
            expect(skip(media(0.001), search(0.15), 0)).toBe(false);
        });
        it('둘 중 하나라도 판정이 없으면(꺼짐·실패) Planner 로 보낸다', () => {
            expect(skip(media(0.001), undefined, 0)).toBe(false);
            expect(skip(media(0.001), { searchGateMs: 3000, searchGateError: 'timeout' }, 0)).toBe(false);
            expect(skip(undefined, search(0.01), 0)).toBe(false);
        });
        it('첨부·진행 중 작업이 있으면 항상 Planner 로 보낸다', () => {
            expect(skip(media(0.001), search(0.001), 1)).toBe(false);
        });
    });
});

describe('runSearchGateShadow — "웹 검색이 필요한가" 기록 전용 판정', () => {
    it('결정 모델이 카탈로그에 없으면 호출하지 않는다(undefined)', async () => {
        let called = 0;
        const r = await runSearchGateShadow({ message: 'x', attachmentKinds: [] }, { modelAvailable: () => false, decide: async () => { called++; return { pTrue: 1, ms: 1 }; } });
        expect(r).toBeUndefined();
        expect(called).toBe(0);
    });

    it('미디어 게이트와 같은 상태 문자열에 검색 질문을 묻고, 결과를 검색 게이트 필드로 돌려준다', async () => {
        const asked: Array<{ state: string; question: string }> = [];
        const r = await runSearchGateShadow({ message: '오늘 환율 알려줘', attachmentKinds: [] }, { modelAvailable: () => true, decide: async (i) => { asked.push(i); return { pTrue: 0.91, ms: 180 }; } });
        expect(asked).toEqual([{ state: buildMediaGateState('오늘 환율 알려줘', []), question: SEARCH_GATE.QUESTION }]);
        expect(r).toEqual({ searchGatePTrue: 0.91, searchGateMs: 180 });
    });

    it('판정 실패는 사유만 싣는다 — 예외를 올리지 않는다', async () => {
        const r = await runSearchGateShadow({ message: 'x', attachmentKinds: [] }, { modelAvailable: () => true, decide: async () => ({ pTrue: null, ms: 3000, error: 'timeout' }) });
        expect(r).toEqual({ searchGateMs: 3000, searchGateError: 'timeout' });
    });
});

describe('gatesWithin — Planner 생략을 위해 판정을 기다리는 시간의 상한', () => {
    const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

    it('두 판정이 시간 안에 끝나면 그대로 돌려준다', async () => {
        const r = await gatesWithin(later({ gateModel: 'm', gatePTrue: 0.01 }, 5), later({ searchGatePTrue: 0.02 }, 5), 200);
        expect(r).toEqual([{ gateModel: 'm', gatePTrue: 0.01 }, { searchGatePTrue: 0.02 }]);
    });

    it('하나라도 늦으면 기다리지 않고 둘 다 없음으로 돌려준다 — 엔진이 긴 입력을 읽는 동안 판정이 수 초 밀린다(실측 2026-10-13)', async () => {
        const started = Date.now();
        const r = await gatesWithin(later({ gateModel: 'm', gatePTrue: 0.01 }, 5), later({ searchGatePTrue: 0.02 }, 2000), 50);
        expect(r).toEqual([undefined, undefined]);
        expect(Date.now() - started).toBeLessThan(500);
    });
});
