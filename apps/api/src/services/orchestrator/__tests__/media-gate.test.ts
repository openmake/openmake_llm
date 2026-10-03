/** 미디어 게이트(셰도우) — 판정 입력 구성과 실행 조건 고정 (실제 모델 호출 없음) */
import { buildMediaGateState, runMediaGateShadow } from '../media-gate';
import { DECISION } from '../../../config/decision';

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
    it('기본값(꺼짐)에서는 판정이 아무리 낮아도 생략하지 않는다', async () => {
        const { shouldSkipPlanner } = await import('../media-gate');
        expect(shouldSkipPlanner({ gateModel: 'm', gatePTrue: 0.0001 }, 0)).toBe(false);
    });

    describe('켰을 때', () => {
        let skip: typeof import('../media-gate').shouldSkipPlanner;
        beforeAll(async () => {
            process.env.ORCHESTRATOR_GATE_SKIP_ENABLED = 'true';
            jest.resetModules();
            skip = (await import('../media-gate')).shouldSkipPlanner;
        });
        afterAll(() => { delete process.env.ORCHESTRATOR_GATE_SKIP_ENABLED; jest.resetModules(); });

        it('임계 미만이고 첨부가 없으면 생략한다', () => {
            expect(skip({ gateModel: 'm', gatePTrue: 0.01 }, 0)).toBe(true);
        });
        it('임계 이상이면 Planner 로 보낸다', () => {
            expect(skip({ gateModel: 'm', gatePTrue: 0.2 }, 0)).toBe(false);
        });
        it('첨부·진행 중 작업이 있으면 항상 Planner 로 보낸다', () => {
            expect(skip({ gateModel: 'm', gatePTrue: 0.001 }, 1)).toBe(false);
        });
        it('판정이 없거나 실패했으면 Planner 로 보낸다', () => {
            expect(skip(undefined, 0)).toBe(false);
            expect(skip({ gateModel: 'm', gateError: 'timeout' }, 0)).toBe(false);
        });
    });
});
