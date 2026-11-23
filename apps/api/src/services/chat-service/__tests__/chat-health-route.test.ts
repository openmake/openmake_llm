jest.mock('../../../config/model-health-routing', () => {
    const actual = jest.requireActual('../../../config/model-health-routing');
    return { ...actual, MODEL_HEALTH_ROUTING: { ...actual.MODEL_HEALTH_ROUTING, ENABLED: true, ALTERNATES: [], MIN_SAMPLES: 5, ERROR_RATE: 0.5, TTFT_P90_MS: 60_000 } };
});
const rates: Record<string, number> = { 'llm.external|openrouter:cheap|token_in': 1, 'llm.external|gemini:pricey|token_in': 9 };
jest.mock('../../cost/cost-ledger-service', () => ({ resolveRate: async (k: string, key: string, u: string) => rates[`${k}|${key}|${u}`] ?? 0 }));
const gate = jest.fn();
jest.mock('../provider-gate', () => ({ runProviderGate: (...a: unknown[]) => gate(...a) }));

import { routeAroundUnhealthyModel } from '../chat-health-route';
import { __setModelHealthSnapshot } from '../../routing/model-health';
import { MODEL_HEALTH_ROUTING } from '../../../config/model-health-routing';
import type { ProviderRouter, ResolvedProvider } from '../../../providers/provider-router';

const R = (fullId: string): ResolvedProvider => {
    const i = fullId.indexOf(':');
    return { fullId, providerId: fullId.slice(0, i), modelId: fullId.slice(i + 1), provider: {} as ResolvedProvider['provider'] };
};
const router = {} as ProviderRouter;
const bad = { samples: 10, errors: 8, ttftP90Ms: 1000, totalP50Ms: 1000 };
const good = { samples: 10, errors: 0, ttftP90Ms: 1000, totalP50Ms: 1000 };

beforeEach(() => {
    gate.mockReset();
    gate.mockImplementation(async (_r: unknown, o: { requestedModel?: string; fallbackModel: string }) => R(o.requestedModel ?? `local-llm:${o.fallbackModel}`));
});

describe('routeAroundUnhealthyModel — 상태 기반 라우팅(하네스 P2-7)', () => {
    it('건강하거나 표본이 부족하면 그대로', async () => {
        __setModelHealthSnapshot(new Map([['gemini-2.5-flash', good]]));
        const r = R('gemini:gemini-2.5-flash');
        expect(await routeAroundUnhealthyModel(router, r, { fallbackModel: 'local-llm:qwen' })).toBe(r);
        __setModelHealthSnapshot(new Map());
        expect(await routeAroundUnhealthyModel(router, r, { fallbackModel: 'local-llm:qwen' })).toBe(r);
        expect(gate).not.toHaveBeenCalled();
    });

    it('비정상이면 건강한 대체 후보 중 단가가 싼 쪽으로 바꾸고 고지한다', async () => {
        __setModelHealthSnapshot(new Map([['flaky', bad], ['cheap', good], ['pricey', good], ['qwen', good]]));
        const events: Array<{ metadata?: Record<string, unknown> }> = [];
        const out = await routeAroundUnhealthyModel(router, R('openrouter:flaky'), {
            fallbackModel: 'local-llm:qwen', alternates: ['gemini:pricey', 'openrouter:cheap'], onSystemEvent: (e) => { events.push(e as never); },
        });
        // 로컬(qwen) 단가 0 이 가장 싸다
        expect(out.fullId).toBe('local-llm:qwen');
        expect(events[0].metadata).toMatchObject({ from: 'openrouter:flaky', to: 'local-llm:qwen', code: 'MODEL_UNHEALTHY' });
    });

    it('정책에 막힌 후보는 건너뛴다, 비정상 후보는 고르지 않는다', async () => {
        __setModelHealthSnapshot(new Map([['flaky', bad], ['cheap', good], ['qwen', bad]]));
        gate.mockImplementation(async (_r: unknown, o: { requestedModel?: string }) => {
            if (o.requestedModel === 'gemini:pricey') throw new Error('EXTERNAL_MODEL_POLICY');
            return R(o.requestedModel as string);
        });
        const out = await routeAroundUnhealthyModel(router, R('openrouter:flaky'), { fallbackModel: 'local-llm:qwen', alternates: ['gemini:pricey', 'openrouter:cheap'] });
        expect(out.fullId).toBe('openrouter:cheap');
    });

    it('쓸 후보가 없으면 원래 모델 그대로(fail-open), 꺼져 있으면 판정 자체를 안 한다', async () => {
        __setModelHealthSnapshot(new Map([['flaky', bad], ['qwen', bad]]));
        const r = R('openrouter:flaky');
        expect(await routeAroundUnhealthyModel(router, r, { fallbackModel: 'local-llm:qwen' })).toBe(r);
        const flag = jest.replaceProperty(MODEL_HEALTH_ROUTING, 'ENABLED', false);
        try {
            __setModelHealthSnapshot(new Map([['flaky', bad], ['qwen', good]]));
            expect(await routeAroundUnhealthyModel(router, r, { fallbackModel: 'local-llm:qwen' })).toBe(r);
        } finally { flag.restore(); }
    });
});
